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
 * - 结果区固定 6 个槽位；普通点位段最多 6 个地点，最终段最多 5 个地点 + 汇总列
 * - 优先上下排列，超 A4 高度则左右换列
 * - 每个点位段内部按检查项目行分页，每个打印区域独立受 A4 高度约束
 * - 最后一个有效点位段的所有行页均保留汇总列
 */

import ExcelJS from 'exceljs'
import JSZip from 'jszip'
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
  getDisplayL1Name,
} from '@/utils/projectCalc'
import {
  buildL1ExportSegments,
  buildL1VerticalRowSlices,
  estimateWrappedLineCount,
  estimateWrappedRowHeight,
  getL1LocationSlotCount,
  getL1NotesContentWidth,
  getL1PageBlockSpec,
  getUsablePageHeightPt,
  L1_PRINT_LAYOUT,
  L1_WORKSHEET_PAGE_SETUP,
  pxToPoints,
} from '@/utils/l1PrintLayout'
import { getL3SubdivisionWeight } from '@/utils/projectStructure'
import { getOrderedL1Ids, getOrderedLocationItems, getOrderedProjectSubdivisions } from '@/utils/projectOrder'
import { getOrMigrateLayout } from '@/utils/segmentLayout'
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
  const buffer = await writeWorkbookBuffer(workbook)
  const uint8 = new Uint8Array(buffer as ArrayBuffer)
  await invoke('write_binary_file', {
    path: filePath,
    data: Array.from(uint8),
  })

  return true
}

export async function writeWorkbookBuffer(workbook: ExcelJS.Workbook): Promise<ArrayBuffer> {
  const rawBuffer = await workbook.xlsx.writeBuffer()
  return applyWorkbookColumnPageBreaks(rawBuffer as ArrayBuffer, workbook)
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

  buildL3Sheet(workbook, project, l1Templates, l2Templates, l3Template)
  buildLocationListSheet(workbook, project, l1Templates, l2Templates, l3Template)
  buildInspectionSystemSheet(workbook, project, l1Templates, l2Templates, l3Template)
  buildResultListSheet(workbook, project, l1Templates, l2Templates, l3Template)
  buildDeviceListSheet(workbook, project, l1Templates, deviceItems, l2Templates, l3Template)

  getOrderedProjectSubdivisions(project, l3Template).forEach((sub, subIdx) => {
    const l2 = l2Templates.find(t => t.id === sub.l2TemplateId)
    const subName = sub.l2TemplateName || l2?.name || `分部${subIdx + 1}`

    buildCoverSheet(workbook, subName, subIdx)
    buildL2Sheet(workbook, project, sub, l1Templates, l2Templates, subName)

    for (const l1Id of getOrderedL1Ids(sub, l2)) {
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
 * 构建 L1 Sheet（统一 A4 分页版本）
 *
 * 规则：
 * - 点位段复用录入界面的上下/左右自动布局，满 6 点位后的附加汇总块放到右侧
 * - 每个点位段按真实行高独立分页，禁止一个打印区域超出 A4 可用高度
 * - 最终点位段保留汇总列；备注只填充最终行页，不影响其他打印区域
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
  buildL1PaginatedSheet(sheet, effectiveTemplate, items, data, companyName)
}

const FINAL_NOTES_INLINE_LINE_LIMIT = 3

/**
 * 所有 L1 表统一使用同一分页器：点位段位置复用录入界面的上下/左右网格，
 * 检查项目过长时在每个点位段内部按行分页；每个打印区域均独立受 A4 高度约束。
 */
function buildL1PaginatedSheet(
  sheet: ExcelJS.Worksheet,
  template: L1Template,
  items: L1Template['inspectionItems'],
  data: InspectionTableData,
  companyName?: string,
) {
  const notesLineCount = estimateWrappedLineCount(
    data.notes ?? '',
    getL1NotesContentWidth(true),
    L1_PRINT_LAYOUT.dataFontSize,
  )
  const writeNotesInline = notesLineCount <= FINAL_NOTES_INLINE_LINE_LIMIT
  const finalNotesBaseHeight = writeNotesInline
    ? Math.max(L1_PRINT_LAYOUT.notesRowH * FINAL_NOTES_INLINE_LINE_LIMIT, L1_PRINT_LAYOUT.notesRowH)
    : 0
  const segments = buildL1ExportSegments(data.checkpoints.length)
  const layout = getOrMigrateLayout(data)
  const positionByStartCol = new Map(layout.map(position => [position.startCol, position]))
  const gridRowCount = Math.max(1, ...layout.map(position => position.gridRow + 1))
  const gridSegments = segments.map((segment, segmentIndex) => {
    const position = positionByStartCol.get(segment.startCol) ?? {
      gridRow: segmentIndex % gridRowCount,
      gridCol: Math.floor(segmentIndex / gridRowCount),
    }
    const isLastSegment = segmentIndex === segments.length - 1
    const tailHeight =
      (template.faultRow?.enabled ? L1_PRINT_LAYOUT.faultRowH : 0) +
      (isLastSegment ? L1_PRINT_LAYOUT.passRateRowH + finalNotesBaseHeight : 0)
    return {
      segment,
      gridRow: position.gridRow,
      gridCol: position.gridCol,
      rowSlices: buildL1VerticalRowSlices(template, data, tailHeight),
    }
  })
  const renderedBlocks: L1RenderedPrintBlock[] = []
  const maxGridCol = Math.max(...gridSegments.map(item => item.gridCol))
  setL1ColWidths(
    sheet,
    Array.from({ length: maxGridCol + 1 }, () => getL1PageBlockSpec(true)),
  )

  const rowStarts = new Map<string, number>()
  const notesLayouts = new Map<string, { areaHeight: number; rowCount: number }>()
  const nextRowByGridCol = new Map<number, number>()
  const segmentsByGridCol = new Map<number, typeof gridSegments>()
  gridSegments.forEach(item => {
    const columnSegments = segmentsByGridCol.get(item.gridCol) ?? []
    columnSegments.push(item)
    segmentsByGridCol.set(item.gridCol, columnSegments)
  })

  // Excel 的行高在整行共享。左右列块必须各自顺序排版，否则末段备注会把另一列拉出空白。
  ;[...segmentsByGridCol.entries()]
    .sort(([leftCol], [rightCol]) => leftCol - rightCol)
    .forEach(([gridCol, columnSegments]) => {
      let nextRow = 1
      let usedHeight = 0
      let hasBlockOnPage = false

      columnSegments
        .sort((left, right) => left.gridRow - right.gridRow || left.segment.index - right.segment.index)
        .forEach(item => {
          item.rowSlices.forEach((slice, sliceIndex) => {
            const key = item.segment.index + ':' + sliceIndex
            const isFinalPage = item.segment.index === segments.length - 1 && slice.isLast
            const fixedHeight = getL1VerticalSliceFixedHeight(template, slice, isFinalPage)
            const minimumNotesHeight = isFinalPage && writeNotesInline ? finalNotesBaseHeight : 0
            const candidateGap = hasBlockOnPage ? L1_PRINT_LAYOUT.pageGapPt : 0

            if (hasBlockOnPage && usedHeight + candidateGap + fixedHeight + minimumNotesHeight > getUsablePageHeightPt()) {
              usedHeight = 0
              hasBlockOnPage = false
            }

            const gap = hasBlockOnPage ? L1_PRINT_LAYOUT.pageGapPt : 0
            if (nextRow > 1) {
              sheet.getRow(nextRow).height = L1_PRINT_LAYOUT.pageGapPt
              nextRow++
            }
            const notesLayout = getL1InlineNotesLayout(
              template,
              slice,
              isFinalPage,
              writeNotesInline,
              finalNotesBaseHeight,
              isFinalPage && writeNotesInline
                ? getUsablePageHeightPt() - usedHeight - gap - fixedHeight
                : undefined,
            )
            const blockHeight = fixedHeight + (isFinalPage && writeNotesInline ? notesLayout.areaHeight : 0)

            rowStarts.set(key, nextRow)
            notesLayouts.set(key, notesLayout)
            nextRow += getL1VerticalSliceRowCount(template, slice, isFinalPage, notesLayout.rowCount)
            usedHeight += gap + blockHeight
            hasBlockOnPage = true
          })
        })
      nextRowByGridCol.set(gridCol, nextRow)
    })

  gridSegments
    .sort((a, b) => a.segment.index - b.segment.index)
    .forEach(item => {
      item.rowSlices.forEach((slice, sliceIndex) => {
        const isLastRowSlice = slice.isLast
        const isLastEffectiveSegment = item.segment.index === segments.length - 1
        const isFinalPage = isLastEffectiveSegment && isLastRowSlice
        // 汇总列属于最后一个有效点位段，而非该点位段拆分后的最后一张物理页。
        const hasSummarySlot = isLastEffectiveSegment &&
          item.segment.endCol - item.segment.startCol + 1 <= getL1LocationSlotCount(true)
        const locationSlotCount = getL1LocationSlotCount(hasSummarySlot)
        const startCol = 1 + (item.gridCol * getL1PageBlockSpec(true).colCount)
        const startRow = rowStarts.get(item.segment.index + ':' + sliceIndex) ?? 1
        const notesLayout = notesLayouts.get(item.segment.index + ':' + sliceIndex) ??
          getL1InlineNotesLayout(
            template,
            slice,
            isFinalPage,
            writeNotesInline,
            finalNotesBaseHeight,
          )
        const notesStartRow = startRow + 3 +
          (slice.endIndex - slice.startIndex) +
          (template.faultRow?.enabled && isLastRowSlice ? 1 : 0) +
          (isFinalPage ? 1 : 0)
        const notesMergeEndRow = notesLayout.rowCount > 0
          ? notesStartRow + notesLayout.rowCount - 1
          : undefined
        const endRow = writeL1SegmentBody(
          sheet,
          template,
          items,
          data,
          Array.from({ length: item.segment.endCol - item.segment.startCol + 1 }, (_, offset) => item.segment.startCol + offset),
          locationSlotCount,
          startCol,
          startRow,
          companyName,
          hasSummarySlot,
          isLastEffectiveSegment,
          notesLayout.areaHeight,
          notesMergeEndRow,
          isFinalPage && writeNotesInline,
          slice.startIndex,
          slice.endIndex,
          isLastRowSlice,
          isFinalPage,
        ) - 1
        renderedBlocks.push({
          startCol,
          endCol: startCol + getL1PageBlockSpec(true).colCount - 1,
          startRow,
          endRow,
          isFinalPage,
        })
      })
    })

  const printAreas = buildL1PrintAreas(sheet, renderedBlocks)

  if (!writeNotesInline && (data.notes ?? '').trim()) {
    const finalSegment = gridSegments.find(item => item.segment.index === segments.length - 1)
    const notesStartCol = 1 + ((finalSegment?.gridCol ?? 0) * getL1PageBlockSpec(true).colCount)
    const notesStartRow = (nextRowByGridCol.get(finalSegment?.gridCol ?? 0) ?? 1) + 1
    const notesRowCount = getL1NotesFillRowCount(getUsablePageHeightPt())
    const notesEndRow = notesStartRow + notesRowCount - 1
    writeL1NotesOnlyPage(
      sheet,
      data,
      notesStartCol,
      notesStartRow,
      notesEndRow,
      getUsablePageHeightPt(),
    )
    printAreas.push(
      columnNumberToName(notesStartCol) + notesStartRow + ':' +
      columnNumberToName(notesStartCol + getL1PageBlockSpec(true).colCount - 1) + notesEndRow,
    )
  }

  sheet.pageSetup.printArea = printAreas[0] ?? 'A1:I1'
  ;(sheet as ExcelJS.Worksheet & { __esiPrintAreas?: string[] }).__esiPrintAreas = printAreas
}

interface L1RenderedPrintBlock {
  startCol: number
  endCol: number
  startRow: number
  endRow: number
  isFinalPage: boolean
}

function buildL1PrintAreas(
  sheet: ExcelJS.Worksheet,
  blocks: L1RenderedPrintBlock[],
): string[] {
  const areas: string[] = []
  const blocksByColumn = new Map<number, L1RenderedPrintBlock[]>()
  blocks.forEach(block => {
    const columnBlocks = blocksByColumn.get(block.startCol) ?? []
    columnBlocks.push(block)
    blocksByColumn.set(block.startCol, columnBlocks)
  })

  ;[...blocksByColumn.entries()]
    .sort(([leftCol], [rightCol]) => leftCol - rightCol)
    .forEach(([, columnBlocks]) => {
      let current: L1RenderedPrintBlock | undefined
      const flush = () => {
        if (!current) return
        areas.push(
          columnNumberToName(current.startCol) + current.startRow + ':' +
          columnNumberToName(current.endCol) + current.endRow,
        )
        current = undefined
      }

      columnBlocks
        .sort((left, right) => left.startRow - right.startRow)
        .forEach(block => {
          if (!current) {
            current = { ...block }
            return
          }
          const mergedHeight = getWorksheetRowsHeight(sheet, current.startRow, block.endRow)
          if (mergedHeight <= getUsablePageHeightPt()) {
            current.endRow = block.endRow
          } else {
            flush()
            current = { ...block }
          }
        })
      flush()
    })

  return areas
}

function getWorksheetRowsHeight(sheet: ExcelJS.Worksheet, startRow: number, endRow: number): number {
  let height = 0
  for (let row = startRow; row <= endRow; row++) {
    height += sheet.getRow(row).height ?? 15
  }
  return height
}

function getL1VerticalSliceRowCount(
  template: L1Template,
  slice: ReturnType<typeof buildL1VerticalRowSlices>[number],
  isFinalPage: boolean,
  notesRowCount: number,
): number {
  return 3 +
    (slice.endIndex - slice.startIndex) +
    (slice.isLast && template.faultRow?.enabled ? 1 : 0) +
    (isFinalPage ? 1 : 0) +
    notesRowCount
}

function getL1VerticalSliceFixedHeight(
  template: L1Template,
  slice: ReturnType<typeof buildL1VerticalRowSlices>[number],
  isFinalPage: boolean,
): number {
  return L1_PRINT_LAYOUT.titleRowH +
    L1_PRINT_LAYOUT.headerRow1H +
    L1_PRINT_LAYOUT.headerRow2H +
    slice.dataHeight +
    (slice.isLast && template.faultRow?.enabled ? L1_PRINT_LAYOUT.faultRowH : 0) +
    (isFinalPage ? L1_PRINT_LAYOUT.passRateRowH : 0)
}

function getL1InlineNotesLayout(
  template: L1Template,
  slice: ReturnType<typeof buildL1VerticalRowSlices>[number],
  isFinalPage: boolean,
  writeNotesInline: boolean,
  minimumNotesHeight: number,
  availableNotesHeight?: number,
): { areaHeight: number; rowCount: number } {
  if (!isFinalPage || !writeNotesInline) {
    return { areaHeight: L1_PRINT_LAYOUT.notesRowH, rowCount: 0 }
  }
  const fixedTailHeight =
    (template.faultRow?.enabled && slice.isLast ? L1_PRINT_LAYOUT.faultRowH : 0) +
    L1_PRINT_LAYOUT.passRateRowH
  const areaHeight = Math.max(
    minimumNotesHeight,
    availableNotesHeight ?? (getUsablePageHeightPt() - (
      L1_PRINT_LAYOUT.titleRowH +
      L1_PRINT_LAYOUT.headerRow1H +
      L1_PRINT_LAYOUT.headerRow2H +
      slice.dataHeight +
      fixedTailHeight
    )),
  )
  return { areaHeight, rowCount: getL1NotesFillRowCount(areaHeight) }
}

function getL1NotesFillRowCount(areaHeight: number): number {
  return Math.max(1, Math.ceil(areaHeight / L1_PRINT_LAYOUT.notesRowH))
}

function setL1ColWidths(
  sheet: ExcelJS.Worksheet,
  pageBlockSpecs: ReturnType<typeof getL1PageBlockSpec>[],
) {
  let currentCol = 1

  pageBlockSpecs.forEach(spec => {
    const hasSummaryCol = spec.summaryColW > 0
    const blockWidths = [
      spec.seqColW,
      spec.itemColW,
      spec.reqColW,
      ...Array.from({ length: getL1LocationSlotCount(hasSummaryCol) }, () => spec.locColW),
      ...(hasSummaryCol ? [spec.summaryColW] : []),
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
  writeNotesInline = isLastEffectiveSeg,
  rowStartIndex = 0,
  rowEndIndex = items.length,
  includeFaultRow = Boolean(template.faultRow?.enabled),
  renderFinalTail = isLastEffectiveSeg,
): number {
  const cfg = LAYOUT_CONFIG.l1
  const sc = startCol
  const ic = startCol + 1
  const rc = startCol + 2
  const dc = startCol + 3
  const maxLocationSlotCount = getL1LocationSlotCount(hasSummarySlot)
  const summaryCol = dc + maxLocationSlotCount
  const normalizedLocationSlotCount = Math.max(0, Math.min(locationSlotCount, maxLocationSlotCount))

  let r = startRow

  const fnt = LAYOUT_CONFIG.font
  const bdr = LAYOUT_CONFIG.borders
  const allCpIndices = Array.from({ length: data.checkpoints.length }, (_, i) => i)
  const segmentEndCol = hasSummarySlot
    ? summaryCol
    : (dc + normalizedLocationSlotCount - 1)
  const dataHeaderEndCol = hasSummarySlot ? summaryCol - 1 : segmentEndCol
  const finalSummaryCol = hasSummarySlot

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

  const visibleItems = items.slice(rowStartIndex, rowEndIndex)
  const groupMerges = computeGroupMerges(visibleItems)
  const sourceGroupMerges = computeGroupMerges(items)
  const sourceGroupNumbers = items.map((_, itemIndex) =>
    sourceGroupMerges.findIndex(merge =>
      itemIndex >= merge.start && itemIndex < merge.start + merge.count,
    ) + 1,
  )
  const dataStartRow = r

  visibleItems.forEach((item, visibleRowIndex) => {
    const rowIdx = rowStartIndex + visibleRowIndex
    setCell(sheet, r, sc, sourceGroupNumbers[rowIdx] || 1, false, fnt.l1HeaderSize, 'center')
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

  if (includeFaultRow && template.faultRow?.enabled) {
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

  if (renderFinalTail) {
    setCell(sheet, r, rc, '设备完好率', false, fnt.dataSize, 'center')
    setCell(sheet, r, dc, '设备完好率', false, fnt.dataSize, 'center')
    if (finalSummaryCol) {
      sheet.mergeCells(r, dc, r, dataHeaderEndCol)
      const totalRate = calcTotalPassRate(data, allCpIndices, items.length)
      setCell(sheet, r, summaryCol, totalRate, false, fnt.dataSize, 'center')
    } else {
      // 最后真实点位段刚好有 6 个地点时，不再创建空汇总表；总完好率写入最后一个结果槽。
      sheet.mergeCells(r, dc, r, Math.max(dc, dataHeaderEndCol - 1))
      const totalRate = calcTotalPassRate(data, allCpIndices, items.length)
      setCell(sheet, r, dataHeaderEndCol, totalRate, false, fnt.dataSize, 'center')
    }
    sheet.getRow(r).height = cfg.passRateRowH
    r++
  }

  if (renderFinalTail && writeNotesInline) {
    const notes = data.notes ?? ''
    const notesEndCol = hasSummarySlot ? summaryCol : segmentEndCol
    const notesStartRow = r
    const notesEndRow = Math.max(notesStartRow, notesMergeEndRow ?? notesStartRow)
    setCell(sheet, r, rc, '备注', false, fnt.dataSize, 'center')
    setCell(sheet, r, dc, notes, false, fnt.dataSize, 'center')
    sheet.mergeCells(notesStartRow, rc, notesEndRow, rc)
    sheet.mergeCells(notesStartRow, dc, notesEndRow, notesEndCol)
    applyNotesAreaRowHeights(sheet, notesStartRow, notesEndRow, notesRowHeight)
    r = notesEndRow + 1
  }

  const tailEndRow = r - 1
  if (tailEndRow >= tailStartRow) {
    const leftStartRow = tailStartRow
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
  }

  return r
}

async function applyWorkbookColumnPageBreaks(
  rawBuffer: ArrayBuffer,
  workbook: ExcelJS.Workbook,
): Promise<ArrayBuffer> {
  const worksheetSpecs = workbook.worksheets
    .map((sheet, index) => {
      const printAreas = ((sheet as ExcelJS.Worksheet & { __esiPrintAreas?: string[] }).__esiPrintAreas ?? [])
        .filter(area => typeof area === 'string' && area.trim().length > 0)
      return {
        worksheetPath: `xl/worksheets/sheet${index + 1}.xml`,
        localSheetId: index,
        sheetName: sheet.name,
        printAreas,
        breakCols: ((sheet as ExcelJS.Worksheet & { __esiColumnPageBreaks?: number[] }).__esiColumnPageBreaks ?? [])
          .filter(col => Number.isFinite(col) && col > 0),
      }
    })

  const breakSpecs = worksheetSpecs.filter(spec => spec.breakCols.length > 0)
  const printAreaSpecs = worksheetSpecs.filter(spec => spec.printAreas.length > 1)

  if (breakSpecs.length === 0 && printAreaSpecs.length === 0) return rawBuffer

  const zip = await JSZip.loadAsync(rawBuffer)
  await Promise.all(breakSpecs.map(async spec => {
    const file = zip.file(spec.worksheetPath)
    if (!file) return
    const xml = await file.async('string')
    zip.file(spec.worksheetPath, injectColumnPageBreaks(xml, spec.breakCols))
  }))

  if (printAreaSpecs.length > 0) {
    const workbookFile = zip.file('xl/workbook.xml')
    if (workbookFile) {
      const workbookXml = await workbookFile.async('string')
      zip.file('xl/workbook.xml', injectWorkbookPrintAreas(workbookXml, printAreaSpecs))
    }
  }

  const patched = await zip.generateAsync({ type: 'arraybuffer' })
  return patched
}

function injectColumnPageBreaks(xml: string, breakCols: number[]): string {
  const uniqueBreaks = [...new Set(breakCols)].sort((a, b) => a - b)
  if (uniqueBreaks.length === 0) return xml

  const colBreaksXml = [
    `<colBreaks count="${uniqueBreaks.length}" manualBreakCount="${uniqueBreaks.length}">`,
    ...uniqueBreaks.map(col => `<brk id="${col}" min="0" max="1048575" man="1"/>`),
    '</colBreaks>',
  ].join('')
  const withoutExistingBreaks = xml.replace(/<colBreaks[\s\S]*?<\/colBreaks>/, '')

  if (withoutExistingBreaks.includes('<rowBreaks')) {
    return withoutExistingBreaks.replace(/(<\/rowBreaks>)/, `$1${colBreaksXml}`)
  }
  if (withoutExistingBreaks.includes('<drawing')) {
    return withoutExistingBreaks.replace(/(<drawing\b)/, `${colBreaksXml}$1`)
  }
  if (withoutExistingBreaks.includes('<legacyDrawing')) {
    return withoutExistingBreaks.replace(/(<legacyDrawing\b)/, `${colBreaksXml}$1`)
  }
  return withoutExistingBreaks.replace('</worksheet>', `${colBreaksXml}</worksheet>`)
}

function injectWorkbookPrintAreas(
  xml: string,
  specs: Array<{ localSheetId: number; sheetName: string; printAreas: string[] }>,
): string {
  const newDefinedNames = specs.map(spec => {
    const areaFormula = spec.printAreas
      .map(area => `${formatPrintSheetName(spec.sheetName)}!${formatAbsoluteRange(area)}`)
      .join(',')
    return `<definedName name="_xlnm.Print_Area" localSheetId="${spec.localSheetId}">${escapeXmlText(areaFormula)}</definedName>`
  }).join('')

  let nextXml = xml
  specs.forEach(spec => {
    const existingPrintArea = new RegExp(
      `<definedName\\b(?=[^>]*\\bname="_xlnm\\.Print_Area")(?=[^>]*\\blocalSheetId="${spec.localSheetId}")[^>]*>[\\s\\S]*?<\\/definedName>`,
      'g',
    )
    nextXml = nextXml.replace(existingPrintArea, '')
  })

  if (nextXml.includes('<definedNames>')) {
    return nextXml.replace('</definedNames>', `${newDefinedNames}</definedNames>`)
  }
  return nextXml.replace('</workbook>', `<definedNames>${newDefinedNames}</definedNames></workbook>`)
}

function formatPrintSheetName(sheetName: string): string {
  return `'${sheetName.replace(/'/g, "''")}'`
}

function formatAbsoluteRange(range: string): string {
  return range
    .split(':')
    .map(part => {
      const match = part.match(/^\$?([A-Z]+)\$?(\d+)$/i)
      if (!match) return part
      return `$${match[1].toUpperCase()}$${match[2]}`
    })
    .join(':')
}

function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function writeL1NotesOnlyPage(
  sheet: ExcelJS.Worksheet,
  data: InspectionTableData,
  startCol: number,
  startRow: number,
  endRow: number,
  notesAreaHeight: number,
) {
  const fnt = LAYOUT_CONFIG.font
  const bdr = LAYOUT_CONFIG.borders
  const sc = startCol
  const rc = startCol + 2
  const dc = startCol + 3
  const summaryCol = dc + getL1LocationSlotCount(true)
  const notesEndRow = Math.max(startRow, endRow)
  const notes = data.notes ?? ''

  for (let row = startRow; row <= notesEndRow; row++) {
    for (let col = sc; col <= summaryCol; col++) {
      const cell = sheet.getCell(row, col)
      applyL1Cell(cell, false, fnt.dataSize, 'center')
      cell.border = {
        top: { style: bdr.all },
        bottom: { style: bdr.all },
        left: { style: bdr.all },
        right: { style: bdr.all },
      }
    }
  }

  const labelCell = sheet.getCell(startRow, sc)
  labelCell.value = '备注'
  labelCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
  sheet.mergeCells(startRow, sc, notesEndRow, rc)

  const contentCell = sheet.getCell(startRow, dc)
  contentCell.value = notes
  contentCell.alignment = { horizontal: 'left', vertical: 'top', wrapText: true }
  sheet.mergeCells(startRow, dc, notesEndRow, summaryCol)
  applyNotesAreaRowHeights(sheet, startRow, notesEndRow, notesAreaHeight)
}

function applyNotesAreaRowHeights(
  sheet: ExcelJS.Worksheet,
  startRow: number,
  endRow: number,
  totalHeight: number,
) {
  const rowCount = Math.max(1, endRow - startRow + 1)
  const normalHeight = L1_PRINT_LAYOUT.notesRowH
  // Excel 行高在整行所有列间共享；将余高分摊到合并区域，避免单个超高行拉伸其他表块。
  for (let offset = 0; offset < rowCount; offset++) {
    const isLastRow = offset === rowCount - 1
    const rowHeight = isLastRow
      ? Math.max(1, totalHeight - (normalHeight * (rowCount - 1)))
      : normalHeight
    sheet.getRow(startRow + offset).height = rowHeight
  }
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
  buildSubdivisionL1Rows(sub, l1Templates, l2Templates.find(template => template.id === sub.l2TemplateId)).forEach((row, idx) => {

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

  const avgScore = calcSubdivisionScore(sub, l1Templates, l2Templates.find(template => template.id === sub.l2TemplateId))
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
  l2Templates: L2Template[],
  l3Template?: L3Template,
) {
  const sheet = workbook.addWorksheet(uniqueSheetName(workbook, '检查结果计算表'))
  const cfg = LAYOUT_CONFIG.l3
  const preview = buildProjectCalcPreview(project, l1Templates, {
    l2Templates,
    l3Template,
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

function buildLocationListSheet(
  workbook: ExcelJS.Workbook,
  project: Project,
  l1Templates: L1Template[],
  l2Templates: L2Template[],
  l3Template?: L3Template,
) {
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
  const groups = getLocationGroups(project, l1Templates, l2Templates, l3Template)
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
  l2Templates: L2Template[],
  l3Template?: L3Template,
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
  getOrderedProjectSubdivisions(project, l3Template).forEach(sub => {
    mergeAndSetCell(sheet, row, 1, row, colEnd, sub.l2TemplateName || '分部工程', true, 10, 'center')
    sheet.getRow(row).height = LAYOUT_CONFIG.list.rowH.data
    row++

    const l2Template = l2Templates.find(template => template.id === sub.l2TemplateId)
    getInspectionExportGroups(sub, l1Templates, l2Template).forEach((group, groupIndex) => {
      const itemRows = group.sources.flatMap(source => buildEffectiveInspectionItems(source.template, source.data))
      if (itemRows.length === 0) return
      const startRow = row
      const groupMerges = computeGroupMerges(itemRows)
      itemRows.forEach(item => {
        setCell(sheet, row, 4, item.requirement || '/', false, 10, 'center')
        setCell(sheet, row, 5, item.inspectionMethod || '/', false, 10, 'center')
        sheet.getRow(row).height = LAYOUT_CONFIG.list.rowH.data
        row++
      })
      const endRow = row - 1

      setCell(sheet, startRow, 1, groupIndex + 1, false, 10, 'center')
      setCell(sheet, startRow, 2, group.name, false, 10, 'center')
      mergeCellsAndStyle(sheet, startRow, 1, endRow, 1)
      mergeCellsAndStyle(sheet, startRow, 2, endRow, 2)

      groupMerges.forEach(merge => {
        const mergeStart = startRow + merge.start
        const mergeEnd = mergeStart + merge.count - 1
        setCell(sheet, mergeStart, 3, itemRows[merge.start]?.groupName || '/', false, 10, 'center')
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
    l2Templates,
    l3Template,
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
  l2Templates: L2Template[],
  l3Template?: L3Template,
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
  buildDeviceListRows(project, l1Templates, deviceItems, l2Templates, l3Template).forEach((rowItem, idx) => {
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

function getLocationGroups(
  project: Project,
  l1Templates: L1Template[],
  l2Templates: L2Template[],
  l3Template?: L3Template,
): { name: string; items: ProjectLocationItem[] }[] {
  const orderedItems = getOrderedLocationItems(project, l2Templates, l3Template)
  const usedIds = new Set<string>()
  const groups: { name: string; items: ProjectLocationItem[] }[] = []

  for (const sub of getOrderedProjectSubdivisions(project, l3Template)) {
    const sourceItems = orderedItems.filter(item => item.l2TemplateId === sub.l2TemplateId)
    if (sourceItems.length === 0) continue
    sourceItems.forEach(item => usedIds.add(item.id))
    groups.push({
      name: sub.l2TemplateName || sourceItems[0].l2TemplateName || '分部工程',
      items: combineLocationItems(sourceItems, l1Templates),
    })
  }

  const remaining = orderedItems.filter(item => !usedIds.has(item.id))
  const remainingGroups = new Map<string, ProjectLocationItem[]>()
  remaining.forEach(item => {
    const key = item.l2TemplateId || item.l2TemplateName
    const current = remainingGroups.get(key) ?? []
    current.push(item)
    remainingGroups.set(key, current)
  })
  remainingGroups.forEach(items => groups.push({
    name: items[0]?.l2TemplateName || '分部工程',
    items: combineLocationItems(items, l1Templates),
  }))

  return groups
}

function combineLocationItems(
  items: ProjectLocationItem[],
  l1Templates: L1Template[],
): ProjectLocationItem[] {
  const groups = new Map<string, ProjectLocationItem[]>()
  for (const item of items) {
    const resultGroupName = item.resultGroupName?.trim()
    const key = resultGroupName ? `group:${resultGroupName}` : `single:${item.id}`
    const current = groups.get(key) ?? []
    current.push(item)
    groups.set(key, current)
  }

  return [...groups.entries()].map(([key, sources]) => {
    const isCritical = sources.every(item => l1Templates.find(template => template.id === item.l1TemplateId)?.isCritical)
    if (key.startsWith('single:')) {
      return {
        ...sources[0],
        l1TemplateName: getDisplayL1Name(sources[0].l1TemplateName, isCritical),
      }
    }
    const first = sources[0]
    const resultGroupName = key.replace(/^group:/, '')
    return {
      ...first,
      l1TemplateName: getDisplayL1Name(resultGroupName, isCritical),
      unit: sources.find(item => item.unit.trim())?.unit ?? '',
      quantity: sources.reduce((sum, item) => sum + item.quantity, 0),
      checkpointNames: sources.flatMap(item => item.checkpointNames),
      resultGroupName,
      resultWeight: sources.reduce((sum, item) => sum + (item.resultWeight ?? 1), 0),
    }
  })
}

function getInspectionExportGroups(
  sub: ProjectSubdivision,
  l1Templates: L1Template[],
  l2Template?: L2Template,
): { name: string; sources: { template: L1Template; data: InspectionTableData }[] }[] {
  const groups = new Map<string, { name: string; sources: { template: L1Template; data: InspectionTableData }[] }>()
  for (const l1Id of getOrderedL1Ids(sub, l2Template)) {
    const template = l1Templates.find(item => item.id === l1Id)
    const data = sub.inspectionData[l1Id]
    if (!template || !data) continue
    const resultGroupName = data.resultGroupName?.trim()
    const name = resultGroupName || data.l1TemplateName || template.name
    const key = resultGroupName ? `group:${resultGroupName}` : `single:${l1Id}`
    const group = groups.get(key) ?? { name, sources: [] }
    group.sources.push({ template, data })
    groups.set(key, group)
  }
  return [...groups.values()].map(group => ({
    ...group,
    name: getDisplayL1Name(group.name, group.sources.every(source => source.template.isCritical)),
  }))
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
