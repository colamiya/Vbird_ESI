/**
 * Excel 导出版式集中配置。
 *
 * 调整列宽、打印页边距、缩放、行高和 L1 前三列比例时，优先改这个文件。
 * 注意：列宽使用 ExcelJS 的列宽单位，行高使用 point，页边距使用 cm。
 */

const L1_PAGE_MARGINS_CM = {
  top: 1.91,
  bottom: 1.91,
  left: 1.78,
  right: 1.78,
  header: 0.76,
  footer: 0.76,
} as const

export const L1_PRINT_LAYOUT = {
  paperSize: 9,
  orientation: 'portrait' as const,
  pageOrder: 'overThenDown' as const,
  scale: 100,
  fitToPage: false,
  a4WidthCm: 21,
  a4HeightCm: 29.7,
  marginsCm: L1_PAGE_MARGINS_CM,
  paginationSafetyReservePt: 8,
  maxLocPerSeg: 6,
  seqColW: 5,
  itemColW: 10,
  reqColW: 15,
  locColWWithSum: 8,
  locColWNoSum: 10,
  summaryColW: 10,
  fixedColumnRatio: {
    seq: 1.6,
    item: 3,
    req: 5.4,
  },
  titleRowH: 20,
  headerRow1H: 22,
  headerRow2H: 22,
  dataRowH: 18,
  faultRowH: 20,
  passRateRowH: 18,
  notesRowH: 20,
  pageGapPt: 5,
  dataFontSize: 9,
  rowHeightPaddingPt: 4,
  textCellPaddingPx: 6,
} as const

export const EXCEL_LAYOUT_CONFIG = {
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
    fixedColumnRatio: L1_PRINT_LAYOUT.fixedColumnRatio,
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
    colWidths: [9.5, 31, 9.5, 9.5, 10, 13],
    titleMergeRows: 8,
    subNameBgArgb: 'FFFFC000',
    tableHeaderRow: 9,
  },

  list: {
    pageSetup: {
      paperSize: 9,
      orientation: 'landscape' as const,
      fitToPage: true,
      scale: 100,
      fitToWidth: 1,
      fitToHeight: 0,
      showGridLines: false,
      horizontalCentered: true,
      verticalCentered: true,
      marginsCm: {
        left: 2,
        right: 2,
        top: 2,
        bottom: 2,
        header: 1.3,
        footer: 1.3,
      },
    },
    rowH: {
      company: 20.1,
      title: 30,
      header: 25,
      data: 25,
    },
    locationColWidths: [11.63, 14.75, 8.91, 8.25, 8.5, 9, 9, 9, 9, 9],
    resultColWidths: [11.63, 14.75, 13.38, 8.88, 8.88, 18.25, 12.5],
    inspectionSystemColWidths: [11.63, 14.75, 12.63, 32.38, 31.5],
    deviceColWidths: [11.63, 14.75, 13.38, 8.88, 12.5, 13, 22.75],
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
    yellow: 'FFFFFF00',
    subNameBg: 'FFFFC000',
  },

  borders: {
    all: 'thin',
    headerBottom: 'medium',
    thick: 'medium',
  },
} as const
