/**
 * Vbird ESI — Excel 导出核心逻辑 v3
 * 严格对照 other/表格模板.xlsx 实现格式
 *
 * Sheet 结构（每个分部）:
 *   封面页 → 分部工程表(L2) → 分项点检表(L1) × N
 * 第一个 Sheet 是 L3 检查结果计算表
 *
 * ========================
 * LAYOUT_CONFIG — 集中调参区（开发者微调入口）
 * 修改此处的参数后重新导出即可，无需查找散落的魔法数字
 * ========================
 *
 * 自动切割规则：
 * - 每段最多 6 个地点
 * - 优先上下排列，超 A4 高度则左右换列
 * - 所有 gridRow 排数对齐（占位表填充）
 * - 仅全局最后一段有汇总列
 */

import ExcelJS from 'exceljs'
import { invoke } from '@tauri-apps/api/core'
import { save } from '@tauri-apps/plugin-dialog'
import type { Project, ProjectSubdivision, InspectionTableData } from '@/types/project'
import type { L1Template, L2Template, DeductionItem } from '@/types/template'
import { isEffectiveValue, isPassed } from '@/utils/numericRule'
import {
  calcTotalPassRate,
  countValidCheckpoints,
  countFaults,
  calcSubdivisionScore,
} from '@/utils/projectCalc'
import {
  buildL1PrintPages,
  buildL1WorksheetLayout,
  estimateWrappedRowHeight,
  L1_PRINT_LAYOUT,
  L1_WORKSHEET_PAGE_SETUP,
  pxToPoints,
} from '@/utils/l1PrintLayout'

// ============================================================
// 🔧 LAYOUT_CONFIG — 所有可微调参数集中在此处
// ============================================================
const LAYOUT_CONFIG = {
  font: {
    name: '宋体',
    headerSize: 10,
    dataSize: 9,
    l1HeaderSize: 10,
    l2TitleSize: 18,
    l2CompanySize: 12,
    l3TitleSize: 36,
    coverSize: 36,
  },

  l1: {
    seqColW: L1_PRINT_LAYOUT.seqColW,
    itemColW: L1_PRINT_LAYOUT.itemColW,
    reqColW: L1_PRINT_LAYOUT.reqColW,
    locColW_WithSum: L1_PRINT_LAYOUT.locColWWithSum,
    locColW_NoSum: L1_PRINT_LAYOUT.locColWNoSum,
    summaryColW: L1_PRINT_LAYOUT.summaryColW,
    titleRowH: L1_PRINT_LAYOUT.titleRowH,
    headerRow1H: L1_PRINT_LAYOUT.headerRow1H,
    headerRow2H: L1_PRINT_LAYOUT.headerRow2H,
    dataRowH: L1_PRINT_LAYOUT.dataRowH,
    faultRowH: L1_PRINT_LAYOUT.faultRowH,
    passRateRowH: L1_PRINT_LAYOUT.passRateRowH,
    notesRowH: L1_PRINT_LAYOUT.notesRowH,
    pageGap: L1_PRINT_LAYOUT.pageGapPt,
    maxLocPerSeg: L1_PRINT_LAYOUT.maxLocPerSeg,
  },

  l2: {
    colWidths: [11.63, 14.75, 7.25, 14.13, 8.25, 8.25, 7.38, 11.88],
    rowH: {
      company: 20,
      title: 30,
      info: 30,
      subInfo: 27.6,
      tableHeader: 27.6,
      dataRow: 20,
      scoring: 20,
    },
    dataStartRow: 7,
    scoringBlankRows: 8,
  },

  l3: {
    colWidths: [10.63, 35.63, 10.63, 10.63, 14.41, 14.41],
    titleMergeRows: 8,
    subNameBgArgb: 'FFFFC000',
    tableHeaderRow: 9,
  },

  cover: {
    textRow: 20,
    textStartCol: 1,
    textEndCol: 10,
  },

  colors: {
    calcBg: 'FFE8E8E8',
    white: 'FFFFFFFF',
    black: 'FF000000',
    subNameBg: 'FFFFC000',
  },

  borders: {
    all: 'thin' as ExcelJS.BorderStyle,
    headerBottom: 'medium' as ExcelJS.BorderStyle,
    thick: 'medium' as ExcelJS.BorderStyle,
  },
} as const

// ============================================================
// 主导出函数
// ============================================================

export async function exportProjectToExcel(
  project: Project,
  l1Templates: L1Template[],
  l2Templates: L2Template[],
): Promise<boolean> {
  const filePath = await save({
    title: '导出 Excel',
    defaultPath: `${project.name}.xlsx`,
    filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }],
  })
  if (!filePath) return false

  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'ESI'
  workbook.created = new Date()

  buildL3Sheet(workbook, project, l1Templates)

  project.subdivisions.forEach((sub, subIdx) => {
    const l2 = l2Templates.find(t => t.id === sub.l2TemplateId)
    const subName = sub.l2TemplateName || l2?.name || `分部${subIdx + 1}`

    buildCoverSheet(workbook, subName, subIdx)
    buildL2Sheet(workbook, project, sub, l1Templates, l2Templates, subName)

    for (const l1Id of sub.selectedL1Ids) {
      const l1Tpl = l1Templates.find(t => t.id === l1Id)
      const l1Data = sub.inspectionData[l1Id]
      if (l1Tpl && l1Data) {
        buildL1Sheet(workbook, l1Tpl, l1Data, project.info.companyName)
      }
    }
  })

  const buffer = await workbook.xlsx.writeBuffer()
  const uint8 = new Uint8Array(buffer as ArrayBuffer)
  await invoke('write_binary_file', {
    path: filePath,
    data: Array.from(uint8),
  })

  return true
}

// ============================================================
// L1 点检表 Sheet
// ============================================================

/**
 * 构建 L1 Sheet（自动切割版本）
 *
 * 规则：
 * - 先按真实打印区高度做逻辑分页
 * - 再把各逻辑页作为横向页块渲染到同一张 Sheet
 * - 同位次表格共享同一组行号与备注行高，缺失位次用占位表补齐
 * - 仅最后一页显示汇总列（非末段仍以 `/` 占位）
 */
function buildL1Sheet(
  workbook: ExcelJS.Workbook,
  template: L1Template,
  data: InspectionTableData,
  companyName?: string,
) {
  const sheet = workbook.addWorksheet(uniqueSheetName(workbook, template.name), {
    pageSetup: { ...L1_WORKSHEET_PAGE_SETUP },
  })
  const items = template.inspectionItems
  const pages = buildL1PrintPages(template, data)

  if (pages.length === 0) return

  const worksheetLayout = buildL1WorksheetLayout(template, data, pages)

  worksheetLayout.slotGapRows.forEach(row => {
    sheet.getRow(row).height = L1_PRINT_LAYOUT.pageGapPt
  })

  pages.forEach((page, pageIndex) => {
    const startCol = worksheetLayout.pageStartCols[pageIndex]
    const hasSummaryCol = pageIndex === pages.length - 1

    for (let slotIndex = 0; slotIndex < worksheetLayout.maxSegmentsPerPage; slotIndex++) {
      const seg = page.segments[slotIndex]
      const cpIndices = Array.from({ length: LAYOUT_CONFIG.l1.maxLocPerSeg }, (_, i) => {
        if (!seg) return -1
        const idx = seg.startCol + i
        return idx <= seg.endCol ? idx : -1
      })

      writeL1SegmentBody(
        sheet,
        template,
        items,
        data,
        cpIndices,
        startCol,
        worksheetLayout.slotStartRows[slotIndex],
        companyName,
        hasSummaryCol,
        seg?.isLastEffectiveSeg ?? false,
        worksheetLayout.slotNotesRowHeights[slotIndex],
      )
    }
  })

  setL1ColWidths(sheet, worksheetLayout.pageBlockSpecs)
  sheet.pageSetup.printArea = `A1:${columnNumberToName(Math.max(1, worksheetLayout.totalCols))}${Math.max(1, worksheetLayout.totalRows)}`
}

function setL1ColWidths(
  sheet: ExcelJS.Worksheet,
  pageBlockSpecs: ReturnType<typeof buildL1WorksheetLayout>['pageBlockSpecs'],
) {
  let currentCol = 1

  pageBlockSpecs.forEach(spec => {
    const blockWidths = [
      spec.seqColW,
      spec.itemColW,
      spec.reqColW,
      ...Array.from({ length: LAYOUT_CONFIG.l1.maxLocPerSeg }, () => spec.locColW),
      ...(spec.summaryColW > 0 ? [spec.summaryColW] : []),
    ]

    blockWidths.forEach((width, idx) => {
      sheet.getColumn(currentCol + idx).width = width
    })

    currentCol += spec.colCount
  })
}

/**
 * 写入 L1 段主体（双行表头 + 数据行 + 故障行 + 合格率行 + 备注行）
 *
 * @param isLastSeg 是否为全局最后一段——只有最后一段才输出汇总列和合格率/备注行
 * @returns 下一个可用行号
 */
function writeL1SegmentBody(
  sheet: ExcelJS.Worksheet,
  template: L1Template,
  items: typeof template.inspectionItems,
  data: InspectionTableData,
  cpIndices: number[],
  startCol: number,
  startRow: number,
  _companyName?: string,
  hasSummaryCol = false,
  isLastEffectiveSeg = false,
  notesRowHeight: number = LAYOUT_CONFIG.l1.notesRowH,
): number {
  const cfg = LAYOUT_CONFIG.l1
  const sc = startCol
  const ic = startCol + 1
  const rc = startCol + 2
  const dc = startCol + 3
  const summaryCol = dc + cfg.maxLocPerSeg

  let r = startRow

  const fnt = LAYOUT_CONFIG.font
  const bdr = LAYOUT_CONFIG.borders
  const allCpIndices = Array.from({ length: data.checkpoints.length }, (_, i) => i)
  const segmentEndCol = hasSummaryCol ? summaryCol : (dc + cfg.maxLocPerSeg - 1)

  const titleCell = sheet.getCell(r, sc)
  titleCell.value = `设施名称：${template.facilityName || template.name}`
  titleCell.font = { name: fnt.name, size: fnt.l1HeaderSize, bold: true, color: { argb: LAYOUT_CONFIG.colors.black } }
  titleCell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true }
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LAYOUT_CONFIG.colors.white } }
  titleCell.border = {}
  sheet.mergeCells(r, sc, r, rc)
  sheet.getCell(r, ic).border = {}
  sheet.getCell(r, rc).border = {}
  for (let col = dc; col <= segmentEndCol; col++) {
    const cell = sheet.getCell(r, col)
    cell.value = ''
    cell.font = { name: fnt.name, size: fnt.dataSize, bold: false, color: { argb: LAYOUT_CONFIG.colors.black } }
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LAYOUT_CONFIG.colors.white } }
    cell.border = {}
  }
  sheet.getRow(r).height = cfg.titleRowH
  r++

  setCell(sheet, r, sc,  '序号',       true, fnt.l1HeaderSize, 'center')
  setCell(sheet, r, ic,  '检查项目',   true, fnt.l1HeaderSize, 'center')
  setCell(sheet, r, rc,  '技术要求',   true, fnt.l1HeaderSize, 'center')
  setCell(sheet, r, dc, '测试点单项结果', true, fnt.l1HeaderSize, 'center')
  sheet.mergeCells(r, dc, r, dc + cfg.maxLocPerSeg - 1)
  if (hasSummaryCol) setCell(sheet, r, summaryCol, '汇总列', true, fnt.l1HeaderSize, 'center')

  sheet.mergeCells(r, sc, r + 1, sc)
  sheet.mergeCells(r, ic, r + 1, ic)
  sheet.mergeCells(r, rc, r + 1, rc)
  if (hasSummaryCol) sheet.mergeCells(r, summaryCol, r + 1, summaryCol)
  sheet.getRow(r).height = cfg.headerRow1H
  r++

  for (let i = 0; i < cfg.maxLocPerSeg; i++) {
    const cpIdx = cpIndices[i]
    const cell = sheet.getCell(r, dc + i)
    cell.value = cpIdx >= 0 ? (data.checkpoints[cpIdx]?.name ?? `检查点${cpIdx + 1}`) : '/'
    applyL1Cell(cell, false, fnt.dataSize, 'center')
    cell.border = {
      top: { style: bdr.all },
      bottom: { style: bdr.headerBottom },
      left: { style: bdr.all },
      right: { style: bdr.all },
    }
  }

  ;[sc, ic, rc].concat(hasSummaryCol ? [summaryCol] : []).forEach(c => {
    const cell = sheet.getCell(r, c)
    if (!cell.font) applyL1Cell(cell, true, fnt.l1HeaderSize, 'center')
    cell.border = {
      top: { style: bdr.all },
      bottom: { style: bdr.headerBottom },
      left: { style: bdr.all },
      right: { style: bdr.all },
    }
  })
  sheet.getRow(r).height = cfg.headerRow2H
  r++

  const groupMerges = computeGroupMerges(items)
  const dataStartRow = r

  items.forEach((item, rowIdx) => {
    setCell(sheet, r, sc, rowIdx + 1, false, fnt.l1HeaderSize, 'center')
    setCell(sheet, r, ic, item.groupName, false, fnt.dataSize, 'left')
    setCell(sheet, r, rc, item.requirement, false, fnt.dataSize, 'left')
    for (let i = 0; i < cfg.maxLocPerSeg; i++) {
      const cpIdx = cpIndices[i]
      let val: any = '/'
      if (cpIdx >= 0) {
        val = data.values[rowIdx]?.[cpIdx] ?? '/'
        if (val === null || val === '') val = '/'
      }
      setCell(sheet, r, dc + i, val, false, fnt.dataSize, 'center')
    }

    if (hasSummaryCol) {
      const rateStr = isLastEffectiveSeg
        ? calcRowPassRate(items[rowIdx], data.values[rowIdx], allCpIndices)
        : '/'
      setCell(sheet, r, summaryCol, rateStr, false, fnt.dataSize, 'center')
    }

    const manualRowHeight = Math.max(
      pxToPoints(item.rowHeight),
      pxToPoints(data.rowHeights?.[rowIdx]),
    )
    sheet.getRow(r).height = estimateWrappedRowHeight(
      item.requirement,
      cfg.reqColW,
      fnt.dataSize,
      Math.max(cfg.dataRowH, manualRowHeight),
    )
    r++
  })

  groupMerges.forEach(merge => {
    if (merge.count > 1) {
      sheet.mergeCells(dataStartRow + merge.start, sc, dataStartRow + merge.start + merge.count - 1, sc)
      sheet.mergeCells(dataStartRow + merge.start, ic, dataStartRow + merge.start + merge.count - 1, ic)
    }
  })

  const deviceName = template.faultRow?.label || template.name || template.facilityName
  const tailStartRow = r

  if (template.faultRow?.enabled) {
    setCell(sheet, r, rc, '是否故障', false, fnt.dataSize, 'center')
    for (let i = 0; i < cfg.maxLocPerSeg; i++) {
      const cpIdx = cpIndices[i]
      let val = '/'
      if (cpIdx >= 0) {
        val = data.faultValues[cpIdx] ?? '/'
        if (val === null || val === '') val = '/'
      }
      setCell(sheet, r, dc + i, val, false, fnt.dataSize, 'center')
    }
    if (hasSummaryCol) setCell(sheet, r, summaryCol, '/', false, fnt.dataSize, 'center')
    sheet.getRow(r).height = cfg.faultRowH
    r++
  }

  setCell(sheet, r, rc, '合格率', false, fnt.dataSize, 'center')
  setCell(sheet, r, dc, '合格率', false, fnt.dataSize, 'center')
  sheet.mergeCells(r, dc, r, dc + cfg.maxLocPerSeg - 1)
  if (hasSummaryCol) {
    const totalRate = isLastEffectiveSeg ? calcTotalPassRate(data, allCpIndices, items.length) : '/'
    setCell(sheet, r, summaryCol, totalRate, false, fnt.dataSize, 'center')
  }
  sheet.getRow(r).height = cfg.passRateRowH
  r++

  const notes = isLastEffectiveSeg ? (data.notes ?? '') : '/'
  const notesEndCol = hasSummaryCol ? summaryCol : (dc + cfg.maxLocPerSeg - 1)
  setCell(sheet, r, rc, '备注', false, fnt.dataSize, 'center')
  setCell(sheet, r, dc, notes, false, fnt.dataSize, 'center')
  sheet.mergeCells(r, dc, r, notesEndCol)
  sheet.getRow(r).height = notesRowHeight
  r++

  const tailEndRow = r - 1
  const leftStartRow = template.faultRow?.enabled ? tailStartRow : (tailStartRow + 0)
  for (let rr = leftStartRow; rr <= tailEndRow; rr++) {
    for (let cc = sc; cc <= ic; cc++) {
      const cell = sheet.getCell(rr, cc)
      cell.value = ''
      applyL1Cell(cell, false, fnt.dataSize, 'center')
    }
  }
  const topLeft = sheet.getCell(leftStartRow, sc)
  topLeft.value = deviceName
  applyL1Cell(topLeft, false, fnt.dataSize, 'center')
  sheet.mergeCells(leftStartRow, sc, tailEndRow, ic)

  return r
}

// ============================================================
// L2 分部工程 Sheet
// ============================================================

function buildL2Sheet(
  workbook: ExcelJS.Workbook,
  project: Project,
  sub: ProjectSubdivision,
  l1Templates: L1Template[],
  l2Templates: L2Template[],
  subName: string,
) {
  const sheet = workbook.addWorksheet(uniqueSheetName(workbook, `分部工程-${subName}`))
  const cfg = LAYOUT_CONFIG.l2
  const colEnd = 8

  cfg.colWidths.forEach((w, i) => { sheet.getColumn(i + 1).width = w })

  let r = 1

  const companyCell = setCell(sheet, r, 1, project.info.companyName || '检查公司', true, LAYOUT_CONFIG.font.l2CompanySize, 'center')
  sheet.mergeCells(r, 1, r, colEnd)
  companyCell.border = makeBorder()
  sheet.getRow(r).height = cfg.rowH.company
  r++

  const titleCell = sheet.getCell(r, 1)
  titleCell.value = {
    richText: [
      { font: { bold: true, size: LAYOUT_CONFIG.font.l2TitleSize, name: LAYOUT_CONFIG.font.name }, text: '分部工程质量检验评定表' },
    ],
  }
  titleCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
  titleCell.border = makeBorder()
  sheet.mergeCells(r, 1, r, colEnd)
  sheet.getRow(r).height = cfg.rowH.title
  r++

  setCell(sheet, r, 1, `分部工程名称：${subName}`, false, LAYOUT_CONFIG.font.headerSize, 'left')
  sheet.mergeCells(r, 1, r, 3)
  applyBorderOnly(sheet.getCell(r, 2))
  applyBorderOnly(sheet.getCell(r, 3))
  setCell(sheet, r, 4, '', false, LAYOUT_CONFIG.font.headerSize, 'left')
  setCell(sheet, r, 5, `实施单位：${project.info.implementUnit || ''}`, false, LAYOUT_CONFIG.font.headerSize, 'left')
  sheet.mergeCells(r, 5, r, colEnd)
  for (let c = 6; c <= colEnd; c++) applyBorderOnly(sheet.getCell(r, c))
  sheet.getRow(r).height = cfg.rowH.info
  r++

  setCell(sheet, r, 1, `建设单位：${project.info.ownerUnit || ''}`, false, LAYOUT_CONFIG.font.headerSize, 'left')
  sheet.mergeCells(r, 1, r, 4)
  for (let c = 2; c <= 4; c++) applyBorderOnly(sheet.getCell(r, c))
  setCell(sheet, r, 5, `监理单位：${project.info.supervisorUnit || ''}`, false, LAYOUT_CONFIG.font.headerSize, 'left')
  sheet.mergeCells(r, 5, r, colEnd)
  for (let c = 6; c <= colEnd; c++) applyBorderOnly(sheet.getCell(r, c))
  sheet.getRow(r).height = cfg.rowH.subInfo
  r++

  const r5cell = sheet.getCell(r, 1)
  r5cell.value = {
    richText: [
      { font: { size: LAYOUT_CONFIG.font.headerSize, name: LAYOUT_CONFIG.font.name }, text: '分     项    工     程' },
    ],
  }
  r5cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
  r5cell.border = makeBorder()
  sheet.mergeCells(r, 1, r, 7)
  for (let c = 2; c <= 7; c++) applyBorderOnly(sheet.getCell(r, c))
  setCell(sheet, r, 8, '备  注', false, LAYOUT_CONFIG.font.headerSize, 'center')
  sheet.mergeCells(r, 8, r + 1, 8)
  sheet.getRow(r).height = cfg.rowH.tableHeader
  r++

  setCell(sheet, r, 1, '分项工程编号', false, LAYOUT_CONFIG.font.headerSize, 'center')
  setCell(sheet, r, 2, '分项工程工程名称', false, LAYOUT_CONFIG.font.headerSize, 'center')
  sheet.mergeCells(r, 2, r, 3)
  applyBorderOnly(sheet.getCell(r, 3))
  setCell(sheet, r, 4, '检查项目数', false, LAYOUT_CONFIG.font.headerSize, 'center')
  setCell(sheet, r, 5, '合格率', false, LAYOUT_CONFIG.font.headerSize, 'center')
  sheet.mergeCells(r, 5, r, 7)
  for (let c = 6; c <= 7; c++) applyBorderOnly(sheet.getCell(r, c))
  sheet.getRow(r).height = cfg.rowH.tableHeader
  r++

  const dataRowStart = r
  sub.selectedL1Ids.forEach((l1Id, idx) => {
    const l1Tpl = l1Templates.find(t => t.id === l1Id)
    const l1Data = sub.inspectionData[l1Id]
    const l1Name = l1Tpl?.name ?? l1Data?.l1TemplateName ?? '(未知)'
    const itemCount = l1Tpl?.inspectionItems.length ?? 0

    setCell(sheet, r, 1, idx + 1, false, LAYOUT_CONFIG.font.headerSize, 'center')
    setCell(sheet, r, 2, l1Name, false, LAYOUT_CONFIG.font.headerSize, 'left')
    sheet.mergeCells(r, 2, r, 3)
    applyBorderOnly(sheet.getCell(r, 3))
    setCell(sheet, r, 4, itemCount, false, LAYOUT_CONFIG.font.headerSize, 'center')

    if (l1Data && l1Tpl) {
      const allCpIndices = l1Data.checkpoints.map((_, i) => i)
      const rate = calcTotalPassRate(l1Data, allCpIndices, l1Tpl.inspectionItems.length)
      setCell(sheet, r, 5, rate, false, LAYOUT_CONFIG.font.headerSize, 'center')
    } else {
      setCell(sheet, r, 5, '/', false, LAYOUT_CONFIG.font.headerSize, 'center')
    }
    sheet.mergeCells(r, 5, r, 7)
    for (let c = 6; c <= 7; c++) applyBorderOnly(sheet.getCell(r, c))
    setCell(sheet, r, 8, '', false, LAYOUT_CONFIG.font.headerSize, 'center')
    sheet.getRow(r).height = cfg.rowH.dataRow
    r++
  })

  const minScoreRow = dataRowStart + cfg.scoringBlankRows
  while (r <= minScoreRow) {
    setCell(sheet, r, 1, '', false, LAYOUT_CONFIG.font.headerSize, 'center')
    setCell(sheet, r, 2, '', false, LAYOUT_CONFIG.font.headerSize, 'left')
    sheet.mergeCells(r, 2, r, 3)
    applyBorderOnly(sheet.getCell(r, 3))
    setCell(sheet, r, 4, '', false, LAYOUT_CONFIG.font.headerSize, 'center')
    setCell(sheet, r, 5, '', false, LAYOUT_CONFIG.font.headerSize, 'center')
    sheet.mergeCells(r, 5, r, 7)
    for (let c = 6; c <= 7; c++) applyBorderOnly(sheet.getCell(r, c))
    setCell(sheet, r, 8, '', false, LAYOUT_CONFIG.font.headerSize, 'center')
    sheet.getRow(r).height = cfg.rowH.dataRow
    r++
  }

  const avgScore = calcSubdivisionScore(sub, l1Templates)
  setCell(sheet, r, 1, '分部工程实测得分', false, LAYOUT_CONFIG.font.headerSize, 'left')
  sheet.mergeCells(r, 1, r, 4)
  for (let c = 2; c <= 4; c++) applyBorderOnly(sheet.getCell(r, c))
  setCell(sheet, r, 5, avgScore !== null ? `${avgScore.toFixed(2)}` : '/', false, LAYOUT_CONFIG.font.headerSize, 'center')
  sheet.mergeCells(r, 5, r, 7)
  for (let c = 6; c <= 7; c++) applyBorderOnly(sheet.getCell(r, c))
  setCell(sheet, r, 8, '', false, LAYOUT_CONFIG.font.headerSize, 'center')
  sheet.getRow(r).height = cfg.rowH.scoring
  r++

  const l2Tpl = l2Templates.find(t => t.id === sub.l2TemplateId)
  const deductionItems: DeductionItem[] = l2Tpl?.scoring.deductionItems ?? []
  let totalDeduction = 0

  for (let i = 0; i < deductionItems.length; i += 2) {
    const left = deductionItems[i]
    const leftVal = sub.scoringData[left.id] ?? 0
    totalDeduction += leftVal

    setCell(sheet, r, 1, left.label, false, LAYOUT_CONFIG.font.headerSize, 'left')
    sheet.mergeCells(r, 1, r, 3)
    for (let c = 2; c <= 3; c++) applyBorderOnly(sheet.getCell(r, c))
    setCell(sheet, r, 4, leftVal, false, LAYOUT_CONFIG.font.headerSize, 'center')

    if (i + 1 < deductionItems.length) {
      const right = deductionItems[i + 1]
      const rightVal = sub.scoringData[right.id] ?? 0
      totalDeduction += rightVal
      setCell(sheet, r, 5, right.label, false, LAYOUT_CONFIG.font.headerSize, 'left')
      sheet.mergeCells(r, 5, r, 7)
      for (let c = 6; c <= 7; c++) applyBorderOnly(sheet.getCell(r, c))
      setCell(sheet, r, 8, rightVal, false, LAYOUT_CONFIG.font.headerSize, 'center')
    } else {
      for (let c = 5; c <= colEnd; c++) setCell(sheet, r, c, '', false, LAYOUT_CONFIG.font.headerSize, 'center')
    }
    sheet.getRow(r).height = cfg.rowH.scoring
    r++
  }

  const finalScore = avgScore !== null ? avgScore - totalDeduction : null
  const thresholds = (l2Tpl?.scoring.gradeThresholds ?? []).slice().sort((a, b) => b.minScore - a.minScore)
  let grade = '/'
  if (finalScore !== null && thresholds.length > 0) {
    const matched = thresholds.find(t => finalScore >= t.minScore)
    grade = matched?.label ?? thresholds[thresholds.length - 1].label
  } else if (finalScore !== null) {
    grade = finalScore >= 85 ? '优良' : finalScore >= 70 ? '合格' : '不合格'
  }

  setCell(sheet, r, 1, '分部工程评分', false, LAYOUT_CONFIG.font.headerSize, 'left')
  sheet.mergeCells(r, 1, r, 3)
  for (let c = 2; c <= 3; c++) applyBorderOnly(sheet.getCell(r, c))
  setCell(sheet, r, 4, finalScore !== null ? `${finalScore.toFixed(2)}` : '/', false, LAYOUT_CONFIG.font.headerSize, 'center')
  setCell(sheet, r, 5, '质量等级', false, LAYOUT_CONFIG.font.headerSize, 'left')
  sheet.mergeCells(r, 5, r, 7)
  for (let c = 6; c <= 7; c++) applyBorderOnly(sheet.getCell(r, c))
  setCell(sheet, r, 8, grade, false, LAYOUT_CONFIG.font.headerSize, 'center')
  sheet.getRow(r).height = cfg.rowH.scoring
}

// ============================================================
// L3 检查结果计算表 Sheet
// ============================================================

function buildL3Sheet(
  workbook: ExcelJS.Workbook,
  project: Project,
  l1Templates: L1Template[],
) {
  const sheet = workbook.addWorksheet(uniqueSheetName(workbook, '检查结果计算表'))
  const cfg = LAYOUT_CONFIG.l3

  cfg.colWidths.forEach((w, i) => { sheet.getColumn(i + 1).width = w })

  const titleCell = sheet.getCell(1, 1)
  titleCell.value = '检查结果计算'
  titleCell.font = { bold: true, size: LAYOUT_CONFIG.font.l3TitleSize, name: LAYOUT_CONFIG.font.name }
  titleCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
  titleCell.border = makeBorder()
  sheet.mergeCells(1, 1, cfg.titleMergeRows, 6)
  for (let i = 1; i <= cfg.titleMergeRows; i++) {
    sheet.getRow(i).height = cfg.titleMergeRows > 1 ? 18 : 40
  }

  const r9 = cfg.tableHeaderRow
  setCell(sheet, r9, 1, '序号',     true, 11, 'center')
  setCell(sheet, r9, 2, '设施',     true, 11, 'left')
  setCell(sheet, r9, 3, '总量',     true, 11, 'center')
  setCell(sheet, r9, 4, '故障数量', true, 11, 'center')
  setCell(sheet, r9, 5, '合格率',   true, 11, 'center')
  sheet.getRow(r9).height = 20

  let r = r9 + 1

  project.subdivisions.forEach((sub, subIdx) => {
    const subName = sub.l2TemplateName || `分部${subIdx + 1}`
    const subScore = calcSubdivisionScore(sub, l1Templates)
    const subDeduction = Object.values(sub.scoringData).reduce((a, b) => a + (b ?? 0), 0)
    const finalScore = subScore !== null ? subScore - subDeduction : null

    const subNameCell = setCell(sheet, r, 1, `分部名称：${subName}`, true, 11, 'left')
    subNameCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: cfg.subNameBgArgb } }
    sheet.mergeCells(r, 1, r, 4)
    for (let c = 2; c <= 4; c++) {
      const cell = sheet.getCell(r, c)
      cell.border = makeBorder()
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: cfg.subNameBgArgb } }
    }
    const scoreCell = setCell(sheet, r, 5, finalScore !== null ? `${finalScore.toFixed(2)}` : '/', true, 11, 'center')
    scoreCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: cfg.subNameBgArgb } }
    sheet.getRow(r).height = 20
    r++

    sub.selectedL1Ids.forEach((l1Id, l1Idx) => {
      const l1Tpl = l1Templates.find(t => t.id === l1Id)
      const l1Data = sub.inspectionData[l1Id]
      const l1Name = l1Tpl?.name ?? l1Data?.l1TemplateName ?? '(未知)'

      setCell(sheet, r, 1, l1Idx + 1, false, 11, 'center')
      setCell(sheet, r, 2, l1Name, false, 11, 'left')

      if (l1Data && l1Tpl) {
        const allCpIndices = l1Data.checkpoints.map((_, i) => i)
        const totalCount = countValidCheckpoints(l1Data, allCpIndices)
        const faultCount = countFaults(l1Data, allCpIndices)
        const rate = calcTotalPassRate(l1Data, allCpIndices, l1Tpl.inspectionItems.length)
        setCell(sheet, r, 3, totalCount, false, 11, 'center')
        setCell(sheet, r, 4, faultCount, false, 11, 'center')
        setCell(sheet, r, 5, rate, false, 11, 'center')
      } else {
        setCell(sheet, r, 3, '/', false, 11, 'center')
        setCell(sheet, r, 4, '/', false, 11, 'center')
        setCell(sheet, r, 5, '/', false, 11, 'center')
      }
      sheet.getRow(r).height = 20
      r++
    })

    let totalItems = 0
    let totalFaults = 0
    sub.selectedL1Ids.forEach(l1Id => {
      const l1Tpl = l1Templates.find(t => t.id === l1Id)
      const l1Data = sub.inspectionData[l1Id]
      if (l1Data && l1Tpl) {
        const allIdx = l1Data.checkpoints.map((_, i) => i)
        totalItems += countValidCheckpoints(l1Data, allIdx)
        totalFaults += countFaults(l1Data, allIdx)
      }
    })
    const totalRate = totalItems > 0
      ? ((1 - totalFaults / totalItems) * 100).toFixed(1) + '%'
      : '/'
    setCell(sheet, r, 1, '合计', false, 11, 'left')
    sheet.mergeCells(r, 1, r, 2)
    applyBorderOnly(sheet.getCell(r, 2))
    setCell(sheet, r, 3, totalItems, false, 11, 'center')
    setCell(sheet, r, 4, totalFaults, false, 11, 'center')
    setCell(sheet, r, 5, totalRate, false, 11, 'center')
    sheet.getRow(r).height = 20
    r++
  })

  const allFinalScores = project.subdivisions.map(s => {
    const sc = calcSubdivisionScore(s, l1Templates)
    const ded = Object.values(s.scoringData).reduce((a, b) => a + (b ?? 0), 0)
    return sc !== null ? sc - ded : null
  }).filter((s): s is number => s !== null)

  const avgAll = allFinalScores.length > 0
    ? (allFinalScores.reduce((a, b) => a + b, 0) / allFinalScores.length).toFixed(2)
    : '/'

  setCell(sheet, r, 1, '合计', false, 11, 'left')
  sheet.mergeCells(r, 1, r, 4)
  for (let c = 2; c <= 4; c++) applyBorderOnly(sheet.getCell(r, c))
  setCell(sheet, r, 5, avgAll, false, 11, 'center')
  sheet.getRow(r).height = 20
  r++

  const avgNum = avgAll === '/' ? null : parseFloat(avgAll)
  const overallGrade = avgNum !== null
    ? (avgNum >= 85 ? '优良' : avgNum >= 70 ? '合格' : '不合格')
    : '/'
  setCell(sheet, r, 1, '总体质量等级', true, 11, 'left')
  sheet.mergeCells(r, 1, r, 4)
  for (let c = 2; c <= 4; c++) applyBorderOnly(sheet.getCell(r, c))
  setCell(sheet, r, 5, overallGrade, true, 11, 'center')
  sheet.mergeCells(r, 5, r, 6)
  applyBorderOnly(sheet.getCell(r, 6))
  sheet.getRow(r).height = 20
}

// ============================================================
// 封面页 Sheet
// ============================================================

function buildCoverSheet(
  workbook: ExcelJS.Workbook,
  subName: string,
  index: number,
) {
  const CN_NUMBERS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
  const sheet = workbook.addWorksheet(uniqueSheetName(workbook, `封面页---${subName}`))
  const label = CN_NUMBERS[index]
    ? `（${CN_NUMBERS[index]}）${subName}`
    : `（${index + 1}）${subName}`

  const cfg = LAYOUT_CONFIG.cover
  sheet.mergeCells(cfg.textRow, cfg.textStartCol, cfg.textRow, cfg.textEndCol)
  const cell = sheet.getCell(cfg.textRow, cfg.textStartCol)
  cell.value = label
  cell.font = { size: LAYOUT_CONFIG.font.coverSize, bold: false, name: LAYOUT_CONFIG.font.name }
  cell.alignment = { horizontal: 'center', vertical: 'middle' }
}

// ============================================================
// 样式辅助函数
// ============================================================

function applyL1Cell(
  cell: ExcelJS.Cell,
  bold: boolean,
  size: number,
  align: 'left' | 'center' | 'right' = 'center',
) {
  cell.font = { name: LAYOUT_CONFIG.font.name, size, bold, color: { argb: LAYOUT_CONFIG.colors.black } }
  cell.border = makeBorder()
  cell.alignment = { horizontal: align, vertical: 'middle', wrapText: true }
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LAYOUT_CONFIG.colors.white } }
}

function setCell(
  sheet: ExcelJS.Worksheet,
  row: number,
  col: number,
  value: string | number,
  bold: boolean,
  size: number,
  align: 'left' | 'center' | 'right' = 'center',
): ExcelJS.Cell {
  const cell = sheet.getCell(row, col)
  cell.value = value
  cell.font = { name: LAYOUT_CONFIG.font.name, size, bold, color: { argb: LAYOUT_CONFIG.colors.black } }
  cell.border = makeBorder()
  cell.alignment = { horizontal: align, vertical: 'middle', wrapText: true }
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LAYOUT_CONFIG.colors.white } }
  return cell
}

function applyBorderOnly(cell: ExcelJS.Cell) {
  cell.border = makeBorder()
}

function makeBorder(): Partial<ExcelJS.Borders> {
  const s = LAYOUT_CONFIG.borders.all
  return { top: { style: s }, bottom: { style: s }, left: { style: s }, right: { style: s } }
}

// ============================================================
// 辅助计算函数
// ============================================================

function uniqueSheetName(workbook: ExcelJS.Workbook, name: string): string {
  let base = name.slice(0, 31)
  const existing = workbook.worksheets.map(ws => ws.name)
  if (!existing.includes(base)) return base
  for (let i = 2; i < 100; i++) {
    const suffix = `(${i})`
    const candidate = base.slice(0, 31 - suffix.length) + suffix
    if (!existing.includes(candidate)) return candidate
  }
  return base + '_' + Date.now()
}

function columnNumberToName(col: number): string {
  let current = col
  let name = ''

  while (current > 0) {
    const remainder = (current - 1) % 26
    name = String.fromCharCode(65 + remainder) + name
    current = Math.floor((current - 1) / 26)
  }

  return name
}

function computeGroupMerges(items: { groupId: string }[]): { start: number; count: number; groupId: string }[] {
  const merges: { start: number; count: number; groupId: string }[] = []
  let i = 0
  while (i < items.length) {
    const gid = items[i].groupId
    let count = 1
    while (i + count < items.length && items[i + count].groupId === gid) count++
    merges.push({ start: i, count, groupId: gid })
    i += count
  }
  return merges
}

function calcRowPassRate(
  item: L1Template['inspectionItems'][number],
  row: (string | number | null)[] | undefined,
  cpIndices: number[],
): string {
  if (!row) return '/'
  let total = 0, passed = 0
  for (const idx of cpIndices) {
    const val = row[idx]
    if (isEffectiveValue(val)) { total++; if (isPassed(item, val)) passed++ }
  }
  if (total === 0) return '/'
  return ((passed / total) * 100).toFixed(1) + '%'
}
