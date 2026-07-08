/**
 * Vbird ESI — Excel 导出核心逻辑 v3
 * 严格对照 other/表格模板.xlsx 实现格式
 *
 * Sheet 结构（每个分部）:
 *   封面页 → 分部工程表(L2) → 分项点检表(L1) × N
 * 第一个 Sheet 是 L3 检查结果计算表
 *
 * ========================
 * Excel 版式参数集中在 src/config/excelLayout.ts。
 * 修改配置后重新导出即可，无需查找散落的魔法数字。
 * ========================
 *
 * 自动切割规则：
 * - UI 分段每段最多 6 个地点；导出最后页非最终块可使用第 7 槽承接后续点位
 * - 优先上下排列，超 A4 高度则左右换列
 * - 所有 gridRow 排数对齐（占位表填充）
 * - 仅导出最终块有单项检测结果汇总列
 */

import ExcelJS from 'exceljs'
import { EXCEL_LAYOUT_CONFIG as LAYOUT_CONFIG } from '@/config/excelLayout'
import type { Project, ProjectLocationItem, ProjectSubdivision, InspectionTableData } from '@/types/project'
import type { DeviceItem } from '@/types/device'
import type { L1Template, L2Template, L3Template, DeductionItem } from '@/types/template'
import { isEffectiveValue, isPassed } from '@/utils/numericRule'
import {
  buildDeviceListRows,
  buildProjectCalcPreview,
  buildSubdivisionL1Rows,
  calcGradeByThresholds,
  calcTotalPassRate,
  calcSubdivisionScore,
} from '@/utils/projectCalc'
import {
  buildL1ExportPrintPages,
  buildL1WorksheetLayout,
  estimateWrappedRowHeight,
  L1_PRINT_LAYOUT,
  L1_WORKSHEET_PAGE_SETUP,
  pxToPoints,
} from '@/utils/l1PrintLayout'
import { getL3SubdivisionWeight } from '@/utils/projectStructure'
import {
  buildEffectiveInspectionItems,
  findMissingProjectRequirements,
  formatMissingProjectRequirements,
} from '@/utils/projectRequirement'

// Excel 列宽、页边距、缩放、行高和比例统一配置在 src/config/excelLayout.ts。

// ============================================================
// 主导出函数
// ============================================================

export async function exportProjectToExcel(
  project: Project,
  l1Templates: L1Template[],
  l2Templates: L2Template[],
  deviceItems: DeviceItem[] = [],
  l3Templates: L3Template[] = [],
): Promise<boolean> {
  const missingRequirements = findMissingProjectRequirements(project, l1Templates)
  if (missingRequirements.length > 0) {
    throw new Error(`以下项目技术要求未填写，补齐后才能导出：\n${formatMissingProjectRequirements(missingRequirements)}`)
  }
  const [{ invoke }, { save }] = await Promise.all([
    import('@tauri-apps/api/core'),
    import('@tauri-apps/plugin-dialog'),
  ])

  const filePath = await save({
    title: '导出 Excel',
    defaultPath: `${project.name}.xlsx`,
    filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }],
  })
  if (!filePath) return false

  const workbook = buildProjectWorkbook(project, l1Templates, l2Templates, deviceItems, l3Templates)
  const buffer = await workbook.xlsx.writeBuffer()
  const uint8 = new Uint8Array(buffer as ArrayBuffer)
  await invoke('write_binary_file', {
    path: filePath,
    data: Array.from(uint8),
  })

  return true
}

export function buildProjectWorkbook(
  project: Project,
  l1Templates: L1Template[],
  l2Templates: L2Template[],
  deviceItems: DeviceItem[] = [],
  l3Templates: L3Template[] = [],
): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'ESI'
  workbook.created = new Date()

  const l3Template = l3Templates.find(t => t.id === project.l3TemplateId)

  buildL3Sheet(workbook, project, l1Templates, l3Template)
  buildLocationListSheet(workbook, project)
  buildInspectionSystemSheet(workbook, project, l1Templates)
  buildResultListSheet(workbook, project, l1Templates, l2Templates, l3Template)
  buildDeviceListSheet(workbook, project, l1Templates, deviceItems)

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

  sanitizeWorkbookPageSetup(workbook)

  return workbook
}

function sanitizeWorkbookPageSetup(workbook: ExcelJS.Workbook) {
  workbook.worksheets.forEach(sheet => {
    const pageSetup = sheet.pageSetup as ExcelJS.Worksheet['pageSetup'] & {
      horizontalDpi?: number
      verticalDpi?: number
      scale?: number
      fitToWidth?: number
      fitToHeight?: number
      usePrinterDefaults?: boolean
    }
    delete pageSetup.horizontalDpi
    delete pageSetup.verticalDpi
    delete pageSetup.usePrinterDefaults

    if (pageSetup.fitToPage) {
      delete pageSetup.scale
      if (pageSetup.fitToWidth === 1) delete pageSetup.fitToWidth
    } else {
      delete pageSetup.scale
      delete pageSetup.fitToWidth
      delete pageSetup.fitToHeight
    }
  })
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
 * - 最后一页非最终块使用原汇总/占位列作为第 7 个点位槽，最终块保留 6 点位 + 汇总列
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
  const effectiveTemplate: L1Template = {
    ...template,
    inspectionItems: buildEffectiveInspectionItems(template, data),
  }
  const items = effectiveTemplate.inspectionItems
  const pages = buildL1ExportPrintPages(effectiveTemplate, data)

  if (pages.length === 0) return

  const worksheetLayout = buildL1WorksheetLayout(effectiveTemplate, data, pages)

  worksheetLayout.slotGapRows.forEach(row => {
    sheet.getRow(row).height = L1_PRINT_LAYOUT.pageGapPt
  })

  pages.forEach((page, pageIndex) => {
    const startCol = worksheetLayout.pageStartCols[pageIndex]
    const isLastPage = pageIndex === pages.length - 1

    for (let slotIndex = 0; slotIndex < worksheetLayout.maxSegmentsPerPage; slotIndex++) {
      const seg = page.segments[slotIndex]
      if (!seg) continue

      const hasSummarySlot = seg?.hasSummarySlot ?? false
      const locationSlotCount = isLastPage && !hasSummarySlot
        ? LAYOUT_CONFIG.l1.maxLocPerSeg + 1
        : LAYOUT_CONFIG.l1.maxLocPerSeg
      const notesMergeEndRow = seg.isLastEffectiveSeg
        ? worksheetLayout.totalRows
        : undefined

      writeL1SegmentBody(
        sheet,
        effectiveTemplate,
        items,
        data,
        seg?.cpIndices ?? [],
        locationSlotCount,
        startCol,
        worksheetLayout.slotStartRows[slotIndex],
        companyName,
        hasSummarySlot,
        seg?.isLastEffectiveSeg ?? false,
        worksheetLayout.slotNotesRowHeights[slotIndex],
        notesMergeEndRow,
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
 * 写入 L1 段主体（双行表头 + 数据行 + 故障行 + 设备完好率行 + 备注行）
 *
 * @param isLastSeg 是否为全局最后一段——只有最后一段才输出单项检测结果汇总和真实设备完好率/备注
 * @returns 下一个可用行号
 */
function writeL1SegmentBody(
  sheet: ExcelJS.Worksheet,
  template: L1Template,
  items: typeof template.inspectionItems,
  data: InspectionTableData,
  cpIndices: number[],
  locationSlotCount: number,
  startCol: number,
  startRow: number,
  _companyName?: string,
  hasSummarySlot = false,
  isLastEffectiveSeg = false,
  notesRowHeight: number = LAYOUT_CONFIG.l1.notesRowH,
  notesMergeEndRow?: number,
): number {
  const cfg = LAYOUT_CONFIG.l1
  const sc = startCol
  const ic = startCol + 1
  const rc = startCol + 2
  const dc = startCol + 3
  const summaryCol = dc + cfg.maxLocPerSeg
  const normalizedLocationSlotCount = Math.max(0, locationSlotCount)

  let r = startRow

  const fnt = LAYOUT_CONFIG.font
  const bdr = LAYOUT_CONFIG.borders
  const allCpIndices = Array.from({ length: data.checkpoints.length }, (_, i) => i)
  const segmentEndCol = hasSummarySlot
    ? summaryCol
    : (dc + normalizedLocationSlotCount - 1)
  const dataHeaderEndCol = hasSummarySlot ? summaryCol - 1 : segmentEndCol
  const finalSummaryCol = hasSummarySlot && isLastEffectiveSeg

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
  sheet.mergeCells(r, dc, r, dataHeaderEndCol)
  if (finalSummaryCol) setCell(sheet, r, summaryCol, '汇总列', true, fnt.l1HeaderSize, 'center')

  sheet.mergeCells(r, sc, r + 1, sc)
  sheet.mergeCells(r, ic, r + 1, ic)
  sheet.mergeCells(r, rc, r + 1, rc)
  if (hasSummarySlot) sheet.mergeCells(r, summaryCol, r + 1, summaryCol)
  sheet.getRow(r).height = cfg.headerRow1H
  r++

  for (let i = 0; i < normalizedLocationSlotCount; i++) {
    const cpIdx = cpIndices[i] ?? -1
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

  ;[sc, ic, rc].concat(hasSummarySlot ? [summaryCol] : []).forEach(c => {
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
    for (let i = 0; i < normalizedLocationSlotCount; i++) {
      const cpIdx = cpIndices[i] ?? -1
      let val: any = '/'
      if (cpIdx >= 0) {
        val = data.values[rowIdx]?.[cpIdx] ?? '/'
        if (val === null || val === '') val = '/'
      }
      setCell(sheet, r, dc + i, val, false, fnt.dataSize, 'center')
    }

    if (hasSummarySlot) {
      const rateStr = isLastEffectiveSeg
        ? calcRowPassRate(items[rowIdx], data.values[rowIdx], allCpIndices, data, rowIdx)
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
    for (let i = 0; i < normalizedLocationSlotCount; i++) {
      const cpIdx = cpIndices[i] ?? -1
      let val = '/'
      if (cpIdx >= 0) {
        val = data.faultValues[cpIdx] ?? '/'
        if (val === null || val === '') val = '/'
      }
      setCell(sheet, r, dc + i, val, false, fnt.dataSize, 'center')
    }
    if (hasSummarySlot) setCell(sheet, r, summaryCol, '/', false, fnt.dataSize, 'center')
    sheet.getRow(r).height = cfg.faultRowH
    r++
  }

  if (isLastEffectiveSeg) {
    setCell(sheet, r, rc, '设备完好率', false, fnt.dataSize, 'center')
    setCell(sheet, r, dc, '设备完好率', false, fnt.dataSize, 'center')
    sheet.mergeCells(r, dc, r, dataHeaderEndCol)
    if (finalSummaryCol) {
      const totalRate = calcTotalPassRate(data, allCpIndices, items.length)
      setCell(sheet, r, summaryCol, totalRate, false, fnt.dataSize, 'center')
    }
    sheet.getRow(r).height = cfg.passRateRowH
    r++
  }

  if (isLastEffectiveSeg) {
    const notes = data.notes ?? ''
    const notesEndCol = hasSummarySlot ? summaryCol : segmentEndCol
    const notesStartRow = r
    const notesEndRow = Math.max(notesStartRow, notesMergeEndRow ?? notesStartRow)
    setCell(sheet, r, rc, '备注', false, fnt.dataSize, 'center')
    setCell(sheet, r, dc, notes, false, fnt.dataSize, 'center')
    sheet.mergeCells(notesStartRow, rc, notesEndRow, rc)
    sheet.mergeCells(notesStartRow, dc, notesEndRow, notesEndCol)
    sheet.getRow(r).height = notesRowHeight
    r = notesEndRow + 1
  }

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
  setCell(sheet, r, 5, '设备完好率', false, LAYOUT_CONFIG.font.headerSize, 'center')
  sheet.mergeCells(r, 5, r, 7)
  for (let c = 6; c <= 7; c++) applyBorderOnly(sheet.getCell(r, c))
  sheet.getRow(r).height = cfg.rowH.tableHeader
  r++

  const dataRowStart = r
  buildSubdivisionL1Rows(sub, l1Templates).forEach((row, idx) => {

    setCell(sheet, r, 1, idx + 1, false, LAYOUT_CONFIG.font.headerSize, 'center')
    setCell(sheet, r, 2, row.name, false, LAYOUT_CONFIG.font.headerSize, 'left')
    sheet.mergeCells(r, 2, r, 3)
    applyBorderOnly(sheet.getCell(r, 3))
    setCell(sheet, r, 4, row.itemCount, false, LAYOUT_CONFIG.font.headerSize, 'center')
    setCell(sheet, r, 5, row.passRate, false, LAYOUT_CONFIG.font.headerSize, 'center')
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
  l3Template?: L3Template,
) {
  const sheet = workbook.addWorksheet(uniqueSheetName(workbook, '检查结果计算表'))
  const cfg = LAYOUT_CONFIG.l3
  const preview = buildProjectCalcPreview(project, l1Templates, {
    getSubdivisionWeight: sub => l3Template ? getL3SubdivisionWeight(l3Template, sub.l2TemplateId) : sub.summaryWeight,
  })
  const colEnd = 6

  cfg.colWidths.forEach((w, i) => { sheet.getColumn(i + 1).width = w })

  const titleCell = mergeAndSetCell(sheet, 1, 1, cfg.titleMergeRows, colEnd, '检查结果计算表', true, LAYOUT_CONFIG.font.l3TitleSize, 'center')
  titleCell.font = { bold: true, size: LAYOUT_CONFIG.font.l3TitleSize, name: LAYOUT_CONFIG.font.name }
  titleCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
  styleRangeFromCell(sheet, 1, 1, cfg.titleMergeRows, colEnd, titleCell)
  for (let i = 1; i <= cfg.titleMergeRows; i++) {
    sheet.getRow(i).height = cfg.titleMergeRows > 1 ? 18 : 40
  }

  const r9 = cfg.tableHeaderRow
  setCell(sheet, r9, 1, '序号',     true, 11, 'center')
  setCell(sheet, r9, 2, '设施',     true, 11, 'left')
  setCell(sheet, r9, 3, '总量',     true, 11, 'center')
  setCell(sheet, r9, 4, '故障数量', true, 11, 'center')
  setCell(sheet, r9, 5, '权值',     true, 11, 'center')
  setCell(sheet, r9, 6, '设备完好率', true, 11, 'center')
  sheet.getRow(r9).height = 20

  let r = r9 + 1

  preview.subdivisions.forEach((sub, subIdx) => {
    const subName = sub.name || `分部${subIdx + 1}`
    const finalScore = sub.finalScore

    const subNameCell = setCell(sheet, r, 1, `分部名称：${subName}`, true, 11, 'left')
    sheet.mergeCells(r, 1, r, 5)
    styleRangeFromCell(sheet, r, 1, r, 5, subNameCell)
    fillRange(sheet, r, 1, r, colEnd, cfg.subNameBgArgb)
    const scoreCell = setCell(sheet, r, 6, finalScore !== null ? `${finalScore.toFixed(2)}` : '/', true, 11, 'center')
    scoreCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: cfg.subNameBgArgb } }
    sheet.getRow(r).height = 20
    r++

    sub.l1Rows.forEach((row, l1Idx) => {
      setCell(sheet, r, 1, l1Idx + 1, false, 11, 'center')
      setCell(sheet, r, 2, row.name, false, 11, 'left')
      setCell(sheet, r, 3, row.totalCount, false, 11, 'center')
      setCell(sheet, r, 4, row.faultCount, false, 11, 'center')
      setCell(sheet, r, 5, '', false, 11, 'center')
      setCell(sheet, r, 6, row.passRate, false, 11, 'center')
      sheet.getRow(r).height = 20
      r++
    })

    setCell(sheet, r, 1, '合计', false, 11, 'left')
    sheet.mergeCells(r, 1, r, 2)
    applyBorderOnly(sheet.getCell(r, 2))
    setCell(sheet, r, 3, sub.totalCount, false, 11, 'center')
    setCell(sheet, r, 4, sub.faultCount, false, 11, 'center')
    setCell(sheet, r, 5, sub.summaryWeight, false, 11, 'center')
    setCell(sheet, r, 6, sub.passRate, false, 11, 'center')
    sheet.getRow(r).height = 20
    r++
  })

  setCell(sheet, r, 1, '合计', false, 11, 'left')
  sheet.mergeCells(r, 1, r, 5)
  for (let c = 2; c <= 5; c++) applyBorderOnly(sheet.getCell(r, c))
  setCell(sheet, r, 6, preview.weightedPassRateDisplay, false, 11, 'center')
  sheet.getRow(r).height = 20
  r++

  setCell(sheet, r, 1, '总体质量等级', true, 11, 'left')
  sheet.mergeCells(r, 1, r, 5)
  for (let c = 2; c <= 5; c++) applyBorderOnly(sheet.getCell(r, c))
  setCell(sheet, r, 6, preview.overallGrade, true, 11, 'center')
  sheet.getRow(r).height = 20

  sheet.pageSetup.printArea = `A1:F${r}`
}

function buildLocationListSheet(workbook: ExcelJS.Workbook, project: Project) {
  const sheet = workbook.addWorksheet(uniqueSheetName(workbook, '点位清单表'))
  const colEnd = 10
  LAYOUT_CONFIG.list.locationColWidths.forEach((w, idx) => { sheet.getColumn(idx + 1).width = w })
  buildListSheetTitle(sheet, '检查点位清单', colEnd, project.info.companyName)

  setCell(sheet, 3, 1, '序号', true, 9, 'center')
  setCell(sheet, 3, 2, '设施名称', true, 9, 'center')
  setCell(sheet, 3, 3, '单位', true, 9, 'center')
  setCell(sheet, 3, 4, '数量', true, 9, 'center')
  mergeAndSetCell(sheet, 3, 5, 3, colEnd, '检测部位', true, 9, 'center')
  sheet.getRow(3).height = LAYOUT_CONFIG.list.rowH.header

  let row = 4
  const groups = getLocationGroups(project)
  groups.forEach(group => {
    mergeAndSetCell(sheet, row, 1, row, colEnd, group.name, true, 9, 'center')
    sheet.getRow(row).height = LAYOUT_CONFIG.list.rowH.data
    row++

    group.items.forEach((item, itemIdx) => {
      const chunks = chunkLocationNames(item.checkpointNames, item.quantity)
      const itemStartRow = row

      chunks.forEach(chunk => {
        chunk.forEach((name, idx) => {
          setCell(sheet, row, 5 + idx, name, false, 9, 'center')
        })
        sheet.getRow(row).height = LAYOUT_CONFIG.list.rowH.data
        row++
      })

      const itemEndRow = row - 1
      setCell(sheet, itemStartRow, 1, itemIdx + 1, false, 9, 'center')
      setCell(sheet, itemStartRow, 2, item.l1TemplateName, false, 9, 'center')
      setCell(sheet, itemStartRow, 3, item.unit || '/', false, 9, 'center')
      setCell(sheet, itemStartRow, 4, item.quantity, false, 9, 'center')
      for (let col = 1; col <= 4; col++) {
        mergeCellsAndStyle(sheet, itemStartRow, col, itemEndRow, col)
      }
    })
  })

  applyListSheetPageSetup(sheet, colEnd, Math.max(3, row - 1))
}

function buildInspectionSystemSheet(
  workbook: ExcelJS.Workbook,
  project: Project,
  l1Templates: L1Template[],
) {
  const sheet = workbook.addWorksheet(uniqueSheetName(workbook, '检查体系结构'))
  const colEnd = 5
  LAYOUT_CONFIG.list.inspectionSystemColWidths.forEach((w, idx) => { sheet.getColumn(idx + 1).width = w })
  buildListSheetTitle(sheet, '检查内容及方法清单', colEnd, project.info.companyName)

  ;['序号', '设施名称', '检查项目', '主要检测内容', '检测方法'].forEach((header, idx) => {
    setCell(sheet, 3, idx + 1, header, true, 10, 'center')
  })
  sheet.getRow(3).height = LAYOUT_CONFIG.list.rowH.header

  let row = 4
  project.subdivisions.forEach(sub => {
    mergeAndSetCell(sheet, row, 1, row, colEnd, sub.l2TemplateName || '分部工程', true, 10, 'center')
    sheet.getRow(row).height = LAYOUT_CONFIG.list.rowH.data
    row++

    sub.selectedL1Ids.forEach((l1Id, l1Idx) => {
      const template = l1Templates.find(t => t.id === l1Id)
      const data = sub.inspectionData[l1Id]
      if (!template || !data) return
      const items = buildEffectiveInspectionItems(template, data)
      if (items.length === 0) return

      const startRow = row
      const groupMerges = computeGroupMerges(items)
      items.forEach(item => {
        setCell(sheet, row, 4, item.requirement || '/', false, 10, 'center')
        setCell(sheet, row, 5, item.inspectionMethod || '/', false, 10, 'center')
        sheet.getRow(row).height = LAYOUT_CONFIG.list.rowH.data
        row++
      })
      const endRow = row - 1

      setCell(sheet, startRow, 1, l1Idx + 1, false, 10, 'center')
      setCell(sheet, startRow, 2, data.l1TemplateName || template.name, false, 10, 'center')
      mergeCellsAndStyle(sheet, startRow, 1, endRow, 1)
      mergeCellsAndStyle(sheet, startRow, 2, endRow, 2)

      groupMerges.forEach(merge => {
        const mergeStart = startRow + merge.start
        const mergeEnd = mergeStart + merge.count - 1
        setCell(sheet, mergeStart, 3, items[merge.start]?.groupName || '/', false, 10, 'center')
        mergeCellsAndStyle(sheet, mergeStart, 3, mergeEnd, 3)
      })
    })
  })

  applyListSheetPageSetup(sheet, colEnd, Math.max(3, row - 1))
}

function buildResultListSheet(
  workbook: ExcelJS.Workbook,
  project: Project,
  l1Templates: L1Template[],
  l2Templates: L2Template[],
  l3Template?: L3Template,
) {
  const sheet = workbook.addWorksheet(uniqueSheetName(workbook, '结果清单'))
  const colEnd = 7
  LAYOUT_CONFIG.list.resultColWidths.forEach((w, idx) => { sheet.getColumn(idx + 1).width = w })
  buildListSheetTitle(sheet, '检查结果清单', colEnd, project.info.companyName)

  ;['序号', '分部工程', '分项工程', '设备总数', '故障台数', '设备完好率', '标度'].forEach((header, idx) => {
    const cell = setCell(sheet, 3, idx + 1, header, true, 10, 'center')
    if (idx === 3 || idx === 6) applyYellowFill(cell)
  })
  sheet.getRow(3).height = LAYOUT_CONFIG.list.rowH.header

  let row = 4
  const preview = buildProjectCalcPreview(project, l1Templates, {
    getSubdivisionWeight: sub => l3Template ? getL3SubdivisionWeight(l3Template, sub.l2TemplateId) : sub.summaryWeight,
  })
  preview.subdivisions.forEach(sub => {
    const startRow = row
    const l2Template = l2Templates.find(t => t.id === sub.l2TemplateId)
    sub.l1Rows.forEach((item, idx) => {
      setCell(sheet, row, 1, idx + 1, false, 10, 'center')
      setCell(sheet, row, 2, sub.name, false, 10, 'center')
      setCell(sheet, row, 3, item.name, false, 10, 'center')
      const totalCell = setCell(sheet, row, 4, item.totalCount, false, 10, 'center')
      applyYellowFill(totalCell)
      setCell(sheet, row, 5, item.faultCount, false, 10, 'center')
      setCell(sheet, row, 6, item.passRate, false, 10, 'center')
      const gradeCell = setCell(sheet, row, 7, calcGradeByThresholds(item.passRateValue, l2Template?.scoring.gradeThresholds), false, 10, 'center')
      applyYellowFill(gradeCell)
      sheet.getRow(row).height = LAYOUT_CONFIG.list.rowH.data
      row++
    })
    if (row - 1 > startRow) mergeCellsAndStyle(sheet, startRow, 2, row - 1, 2)
  })

  applyListSheetPageSetup(sheet, colEnd, Math.max(3, row - 1))
}

function buildDeviceListSheet(
  workbook: ExcelJS.Workbook,
  project: Project,
  l1Templates: L1Template[],
  deviceItems: DeviceItem[],
) {
  const sheet = workbook.addWorksheet(uniqueSheetName(workbook, '设备清单'))
  const colEnd = 7
  LAYOUT_CONFIG.list.deviceColWidths.forEach((w, idx) => { sheet.getColumn(idx + 1).width = w })
  buildListSheetTitle(sheet, '设备清单', colEnd, project.info.companyName)

  ;['序号', '设备名称', '设备型号', '单位', '设备编号', '数量', '设备用途'].forEach((header, idx) => {
    setCell(sheet, 3, idx + 1, header, true, 10, 'center')
  })
  sheet.getRow(3).height = LAYOUT_CONFIG.list.rowH.header

  let row = 4
  buildDeviceListRows(project, l1Templates, deviceItems).forEach((rowItem, idx) => {
    setCell(sheet, row, 1, idx + 1, false, 11, 'center')
    setCell(sheet, row, 2, rowItem.device.name, false, 11, 'center')
    setCell(sheet, row, 3, rowItem.device.model || '/', false, 11, 'center')
    setCell(sheet, row, 4, rowItem.device.unit || '/', false, 11, 'center')
    setCell(sheet, row, 5, rowItem.device.serialNumber || '/', false, 11, 'center')
    setCell(sheet, row, 6, 1, false, 11, 'center')
    setCell(sheet, row, 7, rowItem.device.purpose || '/', false, 11, 'center')
    sheet.getRow(row).height = LAYOUT_CONFIG.list.rowH.data
    row++
  })

  applyListSheetPageSetup(sheet, colEnd, Math.max(3, row - 1))
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

function mergeAndSetCell(
  sheet: ExcelJS.Worksheet,
  startRow: number,
  startCol: number,
  endRow: number,
  endCol: number,
  value: string | number,
  bold: boolean,
  size: number,
  align: 'left' | 'center' | 'right' = 'center',
): ExcelJS.Cell {
  const cell = setCell(sheet, startRow, startCol, value, bold, size, align)
  if (startRow !== endRow || startCol !== endCol) {
    sheet.mergeCells(startRow, startCol, endRow, endCol)
  }
  styleRangeFromCell(sheet, startRow, startCol, endRow, endCol, cell)
  return cell
}

function mergeCellsAndStyle(
  sheet: ExcelJS.Worksheet,
  startRow: number,
  startCol: number,
  endRow: number,
  endCol: number,
) {
  const cell = sheet.getCell(startRow, startCol)
  if (startRow !== endRow || startCol !== endCol) {
    sheet.mergeCells(startRow, startCol, endRow, endCol)
  }
  styleRangeFromCell(sheet, startRow, startCol, endRow, endCol, cell)
}

function styleRangeFromCell(
  sheet: ExcelJS.Worksheet,
  startRow: number,
  startCol: number,
  endRow: number,
  endCol: number,
  source: ExcelJS.Cell,
) {
  for (let row = startRow; row <= endRow; row++) {
    for (let col = startCol; col <= endCol; col++) {
      const cell = sheet.getCell(row, col)
      cell.font = source.font
      cell.alignment = source.alignment
      cell.fill = source.fill
      cell.border = makeBorder()
    }
  }
}

function fillRange(
  sheet: ExcelJS.Worksheet,
  startRow: number,
  startCol: number,
  endRow: number,
  endCol: number,
  argb: string,
) {
  for (let row = startRow; row <= endRow; row++) {
    for (let col = startCol; col <= endCol; col++) {
      sheet.getCell(row, col).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } }
    }
  }
}

function applyYellowFill(cell: ExcelJS.Cell) {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LAYOUT_CONFIG.colors.yellow } }
}

function buildListSheetTitle(
  sheet: ExcelJS.Worksheet,
  title: string,
  colEnd: number,
  companyName?: string,
) {
  const companyCell = mergeAndSetCell(sheet, 1, 1, 1, colEnd, companyName || '检查公司', true, 12, 'center')
  companyCell.font = { bold: true, size: 12, name: '仿宋_GB2312' }
  styleRangeFromCell(sheet, 1, 1, 1, colEnd, companyCell)
  sheet.getRow(1).height = LAYOUT_CONFIG.list.rowH.company

  const titleCell = mergeAndSetCell(sheet, 2, 1, 2, colEnd, title, true, 18, 'center')
  titleCell.font = { bold: true, size: 18, name: '仿宋_GB2312' }
  styleRangeFromCell(sheet, 2, 1, 2, colEnd, titleCell)
  sheet.getRow(2).height = LAYOUT_CONFIG.list.rowH.title
}

function applyListSheetPageSetup(
  sheet: ExcelJS.Worksheet,
  colEnd: number,
  lastRow: number,
) {
  const setup = LAYOUT_CONFIG.list.pageSetup
  sheet.pageSetup.paperSize = setup.paperSize
  sheet.pageSetup.orientation = setup.orientation
  sheet.pageSetup.fitToPage = setup.fitToPage
  sheet.pageSetup.scale = setup.scale
  sheet.pageSetup.fitToWidth = setup.fitToWidth
  sheet.pageSetup.fitToHeight = setup.fitToHeight
  sheet.pageSetup.showGridLines = setup.showGridLines
  sheet.pageSetup.horizontalCentered = setup.horizontalCentered
  sheet.pageSetup.verticalCentered = setup.verticalCentered
  sheet.pageSetup.margins = {
    left: setup.marginsCm.left / 2.54,
    right: setup.marginsCm.right / 2.54,
    top: setup.marginsCm.top / 2.54,
    bottom: setup.marginsCm.bottom / 2.54,
    header: setup.marginsCm.header / 2.54,
    footer: setup.marginsCm.footer / 2.54,
  }
  sheet.pageSetup.printArea = `A1:${columnNumberToName(colEnd)}${lastRow}`
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
  let base = name
    .replace(/[\\/?*\[\]:]/g, '_')
    .replace(/^'+|'+$/g, '')
    .trim()
    .slice(0, 31)
  if (!base) base = 'Sheet'
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

function getLocationGroups(project: Project): { name: string; items: ProjectLocationItem[] }[] {
  const allItems = project.locationItems ?? []
  const usedIds = new Set<string>()
  const groups: { name: string; items: ProjectLocationItem[] }[] = []

  project.subdivisions.forEach(sub => {
    const items = allItems.filter(item => item.l2TemplateId === sub.l2TemplateId)
    if (items.length === 0) return
    groups.push({
      name: sub.l2TemplateName || items[0].l2TemplateName || '分部工程',
      items,
    })
    items.forEach(item => usedIds.add(item.id))
  })

  const remaining = allItems.filter(item => !usedIds.has(item.id))
  const remainingGroups = new Map<string, { name: string; items: ProjectLocationItem[] }>()
  remaining.forEach(item => {
    const key = item.l2TemplateId || item.l2TemplateName
    const group = remainingGroups.get(key)
    if (group) {
      group.items.push(item)
    } else {
      remainingGroups.set(key, { name: item.l2TemplateName || '分部工程', items: [item] })
    }
  })

  return groups.concat([...remainingGroups.values()])
}

function chunkLocationNames(names: string[], quantity: number): string[][] {
  const total = Math.max(1, quantity || 0, names.length)
  const chunks: string[][] = []

  for (let start = 0; start < total; start += 6) {
    const chunk: string[] = []
    for (let idx = start; idx < start + 6; idx++) {
      chunk.push(idx < total ? (names[idx]?.trim() || '/') : '/')
    }
    chunks.push(chunk)
  }

  return chunks
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
  data?: InspectionTableData,
  rowIdx?: number,
): string {
  if (!row) return '/'
  let total = 0, passed = 0
  for (const idx of cpIndices) {
    const val = row[idx]
    if (isEffectiveValue(val)) {
      total++
      if (item.validationType === 'manual') {
        const judgement = data?.manualJudgements?.[`${rowIdx}-${idx}`] ?? 'pass'
        if (judgement !== 'fail') passed++
      } else if (isPassed(item, val)) {
        passed++
      }
    }
  }
  if (total === 0) return '/'
  return ((passed / total) * 100).toFixed(1) + '%'
}
