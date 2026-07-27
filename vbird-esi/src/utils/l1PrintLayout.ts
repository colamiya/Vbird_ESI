import type { InspectionTableData } from '@/types/project'
import type { L1Template } from '@/types/template'
import { L1_PRINT_LAYOUT } from '@/config/excelLayout'

export { L1_PRINT_LAYOUT } from '@/config/excelLayout'

const FINAL_NOTES_INLINE_LINE_LIMIT = 3

export const L1_WORKSHEET_PAGE_SETUP = {
  paperSize: L1_PRINT_LAYOUT.paperSize,
  orientation: L1_PRINT_LAYOUT.orientation,
  pageOrder: L1_PRINT_LAYOUT.pageOrder,
  fitToPage: L1_PRINT_LAYOUT.fitToPage,
  scale: L1_PRINT_LAYOUT.scale,
  showGridLines: false,
  margins: {
    left: cmToInch(L1_PRINT_LAYOUT.marginsCm.left),
    right: cmToInch(L1_PRINT_LAYOUT.marginsCm.right),
    top: cmToInch(L1_PRINT_LAYOUT.marginsCm.top),
    bottom: cmToInch(L1_PRINT_LAYOUT.marginsCm.bottom),
    header: cmToInch(L1_PRINT_LAYOUT.marginsCm.header),
    footer: cmToInch(L1_PRINT_LAYOUT.marginsCm.footer),
  },
} as const

export interface L1PrintSegmentLayout {
  index: number
  startCol: number
  endCol: number
  cpIndices: number[]
  hasSummarySlot: boolean
  isNotesOnly: boolean
  pageIndex: number
  notesRowHeight: number
  baseNotesRowHeight: number
  totalHeight: number
  isLastEffectiveSeg: boolean
  writeNotesInline: boolean
}

export interface L1PrintPageLayout {
  pageIndex: number
  segments: L1PrintSegmentLayout[]
  availableHeight: number
  usedHeight: number
  extraHeight: number
}

export interface L1PageBlockSpec {
  colCount: number
  seqColW: number
  itemColW: number
  reqColW: number
  locColW: number
  summaryColW: number
}

/** 单个点位段内按检查项目行切分的纵向打印页。 */
export interface L1VerticalRowSlice {
  startIndex: number
  endIndex: number
  dataHeight: number
  isLast: boolean
}

interface SegmentMetric {
  index: number
  startCol: number
  endCol: number
  cpIndices: number[]
  hasSummarySlot: boolean
  isNotesOnly: boolean
  baseHeight: number
  baseNotesRowHeight: number
  isLastEffectiveSeg: boolean
  writeNotesInline: boolean
  forceSeparateNotes: boolean
}

export function buildL1PrintPages(
  template: L1Template,
  data: InspectionTableData,
): L1PrintPageLayout[] {
  return buildL1PrintPagesCore(template, data, false)
}

export function buildL1ExportPrintPages(
  template: L1Template,
  data: InspectionTableData,
): L1PrintPageLayout[] {
  return buildL1PrintPagesCore(template, data, true)
}

function buildL1PrintPagesCore(
  template: L1Template,
  data: InspectionTableData,
  splitOverflowNotes: boolean,
): L1PrintPageLayout[] {
  const totalCols = data.checkpoints.length
  if (totalCols <= 0) return []

  const segments = splitOverflowNotes
    ? buildL1ExportSegments(totalCols)
    : buildPreviewSegments(totalCols)
  const breaks = segments
    .slice(1)
    .map(seg => seg.startCol)
    .filter(startCol => startCol < totalCols)
  data.segmentBreaks = breaks

  if (segments.length === 0) return []

  const lastSegIndex = segments[segments.length - 1]?.index ?? -1
  const staticHeight = getL1StaticSegmentHeight(template, data)

  const metrics: SegmentMetric[] = segments.map(seg => {
    const isLastEffectiveSeg = seg.index === lastSegIndex
    const isSummaryOnlySeg = seg.startCol > seg.endCol
    const notesText = isLastEffectiveSeg ? (data.notes ?? '') : '/'
    const notesWidth = getL1NotesContentWidth(isLastEffectiveSeg)
    const notesLineCount = estimateWrappedLineCount(
      notesText,
      notesWidth,
      L1_PRINT_LAYOUT.dataFontSize,
    )
    const minNotesHeight = isLastEffectiveSeg
      ? L1_PRINT_LAYOUT.notesRowH * FINAL_NOTES_INLINE_LINE_LIMIT
      : L1_PRINT_LAYOUT.notesRowH
    const baseNotesRowHeight = estimateWrappedRowHeight(
      notesText,
      notesWidth,
      L1_PRINT_LAYOUT.dataFontSize,
      minNotesHeight,
    )

    return {
      index: seg.index,
      startCol: seg.startCol,
      endCol: seg.endCol,
      cpIndices: range(seg.startCol, seg.endCol),
      hasSummarySlot: isLastEffectiveSeg,
      isNotesOnly: false,
      baseHeight: staticHeight + baseNotesRowHeight,
      baseNotesRowHeight,
      isLastEffectiveSeg,
      writeNotesInline: isLastEffectiveSeg,
      forceSeparateNotes: splitOverflowNotes &&
        isLastEffectiveSeg &&
        !isSummaryOnlySeg &&
        notesLineCount > FINAL_NOTES_INLINE_LINE_LIMIT,
    }
  })

  const availableHeight = getUsablePageHeightPt()
  const pages: SegmentMetric[][] = []
  let currentPage: SegmentMetric[] = []
  let currentHeight = 0

  for (const metric of metrics) {
    if (splitOverflowNotes && metric.isLastEffectiveSeg) {
      const finalBodyMetric: SegmentMetric = {
        ...metric,
        baseHeight: staticHeight,
        baseNotesRowHeight: L1_PRINT_LAYOUT.notesRowH,
        writeNotesInline: false,
        forceSeparateNotes: metric.forceSeparateNotes,
      }
      const gap = currentPage.length > 0 ? L1_PRINT_LAYOUT.pageGapPt : 0
      const projectedBodyHeight = currentHeight + gap + finalBodyMetric.baseHeight

      if (currentPage.length > 0 && projectedBodyHeight > availableHeight) {
        pages.push(currentPage)
        currentPage = [finalBodyMetric]
        currentHeight = finalBodyMetric.baseHeight
      } else {
        currentPage.push(finalBodyMetric)
        currentHeight = projectedBodyHeight
      }

      const finalNotesHeight = metric.baseNotesRowHeight
      if (!metric.forceSeparateNotes && availableHeight - currentHeight >= finalNotesHeight) {
        finalBodyMetric.baseHeight += finalNotesHeight
        finalBodyMetric.baseNotesRowHeight = finalNotesHeight
        finalBodyMetric.writeNotesInline = true
        currentHeight += finalNotesHeight
      } else {
        pages.push(currentPage)
        currentPage = []
        currentHeight = 0
        pages.push([{
          index: metric.index + 1,
          startCol: metric.endCol + 1,
          endCol: metric.endCol,
          cpIndices: [],
          hasSummarySlot: true,
          isNotesOnly: true,
          baseHeight: finalNotesHeight,
          baseNotesRowHeight: finalNotesHeight,
          isLastEffectiveSeg: false,
          writeNotesInline: true,
          forceSeparateNotes: false,
        }])
      }
      continue
    }

    const gap = currentPage.length > 0 ? L1_PRINT_LAYOUT.pageGapPt : 0
    const projectedHeight = currentHeight + gap + metric.baseHeight

    if (currentPage.length > 0 && projectedHeight > availableHeight) {
      pages.push(currentPage)
      currentPage = [metric]
      currentHeight = metric.baseHeight
      continue
    }

    currentPage.push(metric)
    currentHeight = projectedHeight
  }

  if (currentPage.length > 0) {
    pages.push(currentPage)
  }

  return pages.map((pageMetrics, pageIndex) => {
    const gapTotal = pageMetrics.length > 1 ? (pageMetrics.length - 1) * L1_PRINT_LAYOUT.pageGapPt : 0
    const baseHeightSum = pageMetrics.reduce((sum, metric) => sum + metric.baseHeight, 0)
    const remainingHeight = Math.max(0, availableHeight - baseHeightSum - gapTotal)
    const segmentsOnPage = pageMetrics.map((metric, idx) => {
      // 表块之间的间隔固定，余高只补到页面最底部的备注区。
      const extra = idx === pageMetrics.length - 1 ? remainingHeight : 0

      return {
        index: metric.index,
        startCol: metric.startCol,
        endCol: metric.endCol,
        cpIndices: metric.cpIndices,
        hasSummarySlot: metric.hasSummarySlot,
        isNotesOnly: metric.isNotesOnly,
        pageIndex,
        notesRowHeight: metric.baseNotesRowHeight + extra,
        baseNotesRowHeight: metric.baseNotesRowHeight,
        totalHeight: metric.baseHeight + extra,
        isLastEffectiveSeg: metric.isLastEffectiveSeg,
        writeNotesInline: metric.writeNotesInline,
      }
    })

    return {
      pageIndex,
      segments: segmentsOnPage,
      availableHeight,
      usedHeight: baseHeightSum + gapTotal,
      extraHeight: remainingHeight,
    }
  })
}

export function estimateWrappedRowHeight(
  value: string | number | null | undefined,
  width: number,
  fontSize: number,
  minHeight: number,
): number {
  const text = `${value ?? ''}`.replace(/\r\n/g, '\n').trim()
  const normalizedMinHeight = Math.ceil(minHeight)
  if (!text) return normalizedMinHeight

  const lineCount = estimateWrappedLineCount(text, width, fontSize)
  const lineHeight = Math.max(Math.ceil(fontSize * 1.7), 14)
  return Math.max(
    normalizedMinHeight,
    Math.ceil((lineCount * lineHeight) + L1_PRINT_LAYOUT.rowHeightPaddingPt),
  )
}

export function estimateWrappedLineCount(
  value: string | number | null | undefined,
  width: number,
  fontSize: number,
): number {
  const text = `${value ?? ''}`.replace(/\r\n/g, '\n').trim()
  if (!text) return 1

  const usableWidthPx = Math.max(
    1,
    excelWidthToPixels(width) - L1_PRINT_LAYOUT.textCellPaddingPx,
  )

  return text
    .split('\n')
    .reduce((sum, line) => sum + Math.max(1, Math.ceil(getTextDisplayPixels(line, fontSize) / usableWidthPx)), 0)
}

export function cmToPt(value: number): number {
  return (value / 2.54) * 72
}

export function cmToInch(value: number): number {
  return value / 2.54
}

export function pxToPoints(value?: number | null): number {
  if (!value || value <= 0) return 0
  return value * 0.75
}

export function getPrintableHeightPt(): number {
  return cmToPt(L1_PRINT_LAYOUT.a4HeightCm)
    - cmToPt(L1_PRINT_LAYOUT.marginsCm.top)
    - cmToPt(L1_PRINT_LAYOUT.marginsCm.bottom)
}

export function getPrintableWidthPt(): number {
  return cmToPt(L1_PRINT_LAYOUT.a4WidthCm)
    - cmToPt(L1_PRINT_LAYOUT.marginsCm.left)
    - cmToPt(L1_PRINT_LAYOUT.marginsCm.right)
}

export function getUsablePageHeightPt(): number {
  return Math.max(0, getPrintableHeightPt() - L1_PRINT_LAYOUT.paginationSafetyReservePt)
}

export function getL1PageBlockSpec(hasSummaryCol: boolean): L1PageBlockSpec {
  const locColW = hasSummaryCol
    ? L1_PRINT_LAYOUT.locColWWithSum
    : L1_PRINT_LAYOUT.locColWNoSum
  const summaryColW = hasSummaryCol ? L1_PRINT_LAYOUT.summaryColW : 0
  const locationSlotCount = getL1LocationSlotCount(hasSummaryCol)
  const colCount = 3 + locationSlotCount + (hasSummaryCol ? 1 : 0)
  const printableWidthPx = ptToPx(getPrintableWidthPt())
  const fixedWidthPx =
    (locationSlotCount * excelWidthToPixels(locColW)) +
    (hasSummaryCol ? excelWidthToPixels(summaryColW) : 0)
  const remainingWidthPx = Math.max(0, printableWidthPx - fixedWidthPx)
  const seqRatio = L1_PRINT_LAYOUT.fixedColumnRatio.seq
  const itemRatio = L1_PRINT_LAYOUT.fixedColumnRatio.item
  const reqRatio = L1_PRINT_LAYOUT.fixedColumnRatio.req
  const ratioTotal = seqRatio + itemRatio + reqRatio
  const seqColW = pixelsToExcelWidth(remainingWidthPx * (seqRatio / ratioTotal))
  const itemColW = pixelsToExcelWidth(remainingWidthPx * (itemRatio / ratioTotal))
  const reqColW = pixelsToExcelWidth(remainingWidthPx * (reqRatio / ratioTotal))

  return {
    colCount,
    seqColW,
    itemColW,
    reqColW,
    locColW,
    summaryColW,
  }
}

export function getL1PrintColCount(hasSummaryCol = true): number {
  return getL1PageBlockSpec(hasSummaryCol).colCount
}

export function getL1LocationSlotCount(hasSummaryCol: boolean): number {
  return hasSummaryCol
    ? Math.max(1, L1_PRINT_LAYOUT.maxLocPerSeg - 1)
    : L1_PRINT_LAYOUT.maxLocPerSeg
}

export function getL1NotesContentWidth(hasSummaryCol: boolean): number {
  const pageSpec = getL1PageBlockSpec(hasSummaryCol)
  const locWidth = getL1LocationSlotCount(hasSummaryCol) * pageSpec.locColW
  return hasSummaryCol ? locWidth + pageSpec.summaryColW : locWidth
}

function buildPreviewSegments(totalCols: number): Array<{ index: number; startCol: number; endCol: number }> {
  const segments: Array<{ index: number; startCol: number; endCol: number }> = []
  for (let startCol = 0; startCol < totalCols; startCol += L1_PRINT_LAYOUT.maxLocPerSeg) {
    segments.push({
      index: segments.length,
      startCol,
      endCol: Math.min(totalCols - 1, startCol + L1_PRINT_LAYOUT.maxLocPerSeg - 1),
    })
  }
  return segments
}

export function buildL1ExportSegments(totalCols: number): Array<{ index: number; startCol: number; endCol: number }> {
  if (totalCols <= L1_PRINT_LAYOUT.maxLocPerSeg) {
    return [{ index: 0, startCol: 0, endCol: totalCols - 1 }]
  }

  const segments: Array<{ index: number; startCol: number; endCol: number }> = []
  let startCol = 0

  while (totalCols - startCol > L1_PRINT_LAYOUT.maxLocPerSeg) {
    const endCol = Math.min(totalCols - 1, startCol + L1_PRINT_LAYOUT.maxLocPerSeg - 1)
    segments.push({ index: segments.length, startCol, endCol })
    startCol = endCol + 1
  }

  segments.push({
    index: segments.length,
    startCol,
    endCol: totalCols - 1,
  })

  return segments
}

function getL1StaticSegmentHeight(
  template: L1Template,
  data: InspectionTableData,
): number {
  return (
    getL1HeaderHeight() +
    template.inspectionItems.reduce((sum, item, rowIdx) => sum + getInspectionRowHeight(item, data, rowIdx), 0) +
    (template.faultRow?.enabled ? L1_PRINT_LAYOUT.faultRowH : 0) +
    L1_PRINT_LAYOUT.passRateRowH
  )
}

/**
 * 将检查项目按实际行高切成可打印页。普通页从前向后优先填满，
 * 仅最后一页预留尾部行高度；每个检查项目行保持完整，不会被拆开。
 */
export function buildL1VerticalRowSlices(
  template: L1Template,
  data: InspectionTableData,
  finalTailHeight: number,
): L1VerticalRowSlice[] {
  const itemCount = template.inspectionItems.length
  if (itemCount === 0) return []

  const rowHeights = template.inspectionItems.map((item, index) =>
    getInspectionRowHeight(item, data, index),
  )
  const headerHeight = getL1HeaderHeight()
  const normalCapacity = Math.max(1, getUsablePageHeightPt() - headerHeight)
  const finalCapacity = Math.max(1, normalCapacity - Math.max(0, finalTailHeight))
  const slices: L1VerticalRowSlice[] = []
  let startIndex = 0
  while (startIndex < itemCount) {
    const remainingHeight = sumRowHeights(rowHeights, startIndex, itemCount)
    if (remainingHeight <= finalCapacity) {
      slices.push({
        startIndex,
        endIndex: itemCount,
        dataHeight: remainingHeight,
        isLast: true,
      })
      break
    }

    let endIndex = fitRowPrefix(rowHeights, startIndex, itemCount, normalCapacity)
    if (endIndex === itemCount) {
      // 所有剩余检查项虽能塞进普通页，但无法连同尾部一起放入最终页。
      // 至少留一条检查项给最终页；仅剩单条且尾部仍放不下时，追加空数据尾页。
      if (itemCount - startIndex === 1) {
        slices.push({
          startIndex,
          endIndex,
          dataHeight: rowHeights[startIndex],
          isLast: false,
        })
        slices.push({
          startIndex: itemCount,
          endIndex: itemCount,
          dataHeight: 0,
          isLast: true,
        })
        break
      }
      endIndex--
    }
    slices.push({
      startIndex,
      endIndex,
      dataHeight: sumRowHeights(rowHeights, startIndex, endIndex),
      isLast: false,
    })
    startIndex = endIndex
  }

  return slices
}

function sumRowHeights(rowHeights: number[], startIndex: number, endIndex: number): number {
  return rowHeights
    .slice(startIndex, endIndex)
    .reduce((sum, height) => sum + height, 0)
}

function fitRowPrefix(
  rowHeights: number[],
  startIndex: number,
  endIndex: number,
  capacity: number,
): number {
  let currentIndex = startIndex
  let height = 0
  while (currentIndex < endIndex) {
    const nextHeight = height + rowHeights[currentIndex]
    if (currentIndex > startIndex && nextHeight > capacity) break
    height = nextHeight
    currentIndex++
  }
  return currentIndex
}

function getL1HeaderHeight(): number {
  return L1_PRINT_LAYOUT.titleRowH +
    L1_PRINT_LAYOUT.headerRow1H +
    L1_PRINT_LAYOUT.headerRow2H
}

function getInspectionRowHeight(
  item: L1Template['inspectionItems'][number],
  data: InspectionTableData,
  rowIndex: number,
): number {
  const manualRowHeight = Math.max(
    pxToPoints(item.rowHeight),
    pxToPoints(data.rowHeights?.[rowIndex]),
  )
  return estimateWrappedRowHeight(
    item.requirement,
    L1_PRINT_LAYOUT.reqColW,
    L1_PRINT_LAYOUT.dataFontSize,
    Math.max(L1_PRINT_LAYOUT.dataRowH, manualRowHeight),
  )
}

function range(start: number, end: number): number[] {
  if (end < start) return []
  return Array.from({ length: end - start + 1 }, (_, idx) => start + idx)
}

function excelWidthToPixels(width: number): number {
  if (width <= 0) return 0
  if (width < 1) return Math.floor((width * 12) + 0.5)
  return Math.floor((width * 7) + 5)
}

export function ptToPx(value: number): number {
  return value * (96 / 72)
}

export function pixelsToExcelWidth(value: number): number {
  if (value <= 0) return 0
  if (value < 12) return Number((value / 12).toFixed(2))
  return Number(((value - 5) / 7).toFixed(2))
}

function getTextDisplayPixels(text: string, fontSize: number): number {
  let widthPx = 0

  for (const ch of text) {
    if (/\s/.test(ch)) {
      widthPx += fontSize * 0.35
    } else if (/[\u0000-\u00ff]/.test(ch)) {
      widthPx += fontSize * 0.58
    } else {
      widthPx += fontSize * 1.05
    }
  }

  return widthPx
}
