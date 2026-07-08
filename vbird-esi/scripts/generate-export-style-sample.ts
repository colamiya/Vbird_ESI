import fs from 'node:fs/promises'
import path from 'node:path'
import ExcelJS from 'exceljs'
import { buildProjectWorkbook } from '../src/utils/excelExport'
import type { DeviceItem } from '../src/types/device'
import type { Project, InspectionTableData } from '../src/types/project'
import type { L1Template, L2Template, L3Template } from '../src/types/template'

const outDir = path.resolve('outputs/excel-style-check')
const generatedPath = path.join(outDir, 'generated-sample.xlsx')
const reportPath = path.join(outDir, 'compare-report.json')
const clientPath = path.resolve('D:/Wechat_File/xwechat_files/wxid_ihok3u9ehasr22_4d23/msg/file/2026-07/2.xlsx')

const now = '2026-07-05T00:00:00.000Z'

function baseL1(id: string, name: string, facilityName: string, items: L1Template['inspectionItems']): L1Template {
  return {
    id,
    name,
    facilityName,
    createdAt: now,
    updatedAt: now,
    columns: {
      fixedColumns: [
        { id: 'seq', label: '序号', width: 60 },
        { id: 'item', label: '检查项目', width: 160 },
        { id: 'requirement', label: '技术要求', width: 260 },
      ],
      dataColumnWidth: 90,
      summaryColumnWidth: 100,
    },
    inspectionItems: items,
    faultRow: { enabled: true, label: facilityName },
    styles: {
      mergeRules: [],
      defaultRowHeight: 30,
      headerRowHeight: 40,
      borderStyle: 'thin',
    },
    autoCutEnabled: true,
  }
}

const l1VideoA = baseL1('l1-video-a', '视频监控外观点检', '摄像机', [
  {
    id: 'video-a-1',
    groupId: 'appearance',
    groupName: '外观检查',
    requirement: '安装牢固，外观无破损，镜头无遮挡',
    inspectionMethod: '目测检查',
    validationType: 'text',
    textOptions: ['符合', '不符合'],
    deviceId: 'dev-camera',
    rowHeight: 30,
  },
  {
    id: 'video-a-2',
    groupId: 'appearance',
    groupName: '外观检查',
    requirement: '',
    inspectionMethod: '现场核对',
    validationType: 'numeric',
    numericRule: { clauses: [{ op: '>=', value: 90 }] },
    numericRange: { min: 90, max: 100 },
    rowHeight: 30,
  },
  {
    id: 'video-a-3',
    groupId: 'function',
    groupName: '功能检查',
    requirement: '图像清晰，云台控制正常',
    inspectionMethod: '通电测试',
    validationType: 'manual',
    rowHeight: 30,
  },
])

const l1VideoB = baseL1('l1-video-b', '视频监控功能点检', '录像设备', [
  {
    id: 'video-b-1',
    groupId: 'record',
    groupName: '录像检查',
    requirement: '录像保存时间满足项目要求',
    inspectionMethod: '抽查回放',
    validationType: 'text',
    textOptions: ['符合', '不符合'],
    deviceId: 'dev-nvr',
    rowHeight: 30,
  },
  {
    id: 'video-b-2',
    groupId: 'record',
    groupName: '录像检查',
    requirement: '',
    inspectionMethod: '系统读取',
    validationType: 'numeric',
    numericRule: { clauses: [{ op: '>=', value: 30 }] },
    numericRange: { min: 30, max: 365 },
    rowHeight: 30,
  },
])

const l1Fire = baseL1('l1-fire', '消防设施点检', '灭火器', [
  {
    id: 'fire-1',
    groupId: 'pressure',
    groupName: '压力检查',
    requirement: '',
    inspectionMethod: '压力表读数',
    validationType: 'numeric',
    numericRule: { clauses: [{ op: '>=', value: 1.2 }, { join: 'AND', op: '<=', value: 1.6 }] },
    numericRange: { min: 1.2, max: 1.6 },
    deviceId: 'dev-extinguisher',
    rowHeight: 30,
  },
  {
    id: 'fire-2',
    groupId: 'validity',
    groupName: '有效期检查',
    requirement: '在有效期内，铅封完好',
    inspectionMethod: '查看铭牌',
    validationType: 'manual',
    rowHeight: 30,
  },
])

const l1Templates = [l1VideoA, l1VideoB, l1Fire]

const l2Templates: L2Template[] = [
  {
    id: 'l2-security',
    name: '安全防范设施',
    createdAt: now,
    updatedAt: now,
    availableL1Ids: ['l1-video-a', 'l1-video-b'],
    headerInfo: {
      title: '分部工程质量检验评定表',
      fields: {
        companyName: '',
        subdivisionName: '',
        implementUnit: '',
        ownerUnit: '',
        supervisorUnit: '',
      },
    },
    scoring: {
      deductionItems: [{ id: 'deduct-appearance', label: '外观缺陷扣分' }],
      gradeThresholds: [
        { label: '优良', minScore: 85 },
        { label: '合格', minScore: 70 },
        { label: '不合格', minScore: 0 },
      ],
    },
  },
  {
    id: 'l2-fire',
    name: '消防设施',
    createdAt: now,
    updatedAt: now,
    availableL1Ids: ['l1-fire'],
    headerInfo: {
      title: '分部工程质量检验评定表',
      fields: {
        companyName: '',
        subdivisionName: '',
        implementUnit: '',
        ownerUnit: '',
        supervisorUnit: '',
      },
    },
    scoring: {
      deductionItems: [],
      gradeThresholds: [
        { label: '优良', minScore: 85 },
        { label: '合格', minScore: 70 },
        { label: '不合格', minScore: 0 },
      ],
    },
  },
]

const l3Templates: L3Template[] = [
  {
    id: 'l3-main',
    name: '单位工程总表',
    createdAt: now,
    updatedAt: now,
    availableL2Ids: ['l2-security', 'l2-fire'],
    subdivisionWeights: [
      { l2TemplateId: 'l2-security', weight: 70 },
      { l2TemplateId: 'l2-fire', weight: 30 },
    ],
    headerInfo: {
      title: '检查结果计算表',
      fields: { companyName: '', projectName: '' },
    },
    styles: {
      mergeRules: [],
      defaultRowHeight: 30,
      headerRowHeight: 40,
      borderStyle: 'thin',
    },
  },
]

const devices: DeviceItem[] = [
  {
    id: 'dev-camera',
    name: '摄像机',
    model: 'DS-2CD3T47',
    unit: '台',
    serialNumber: 'CAM-20260705-001',
    purpose: '视频采集',
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'dev-nvr',
    name: '网络录像机',
    model: 'NVR-32CH',
    unit: '台',
    serialNumber: 'NVR-20260705-001',
    purpose: '视频存储',
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'dev-extinguisher',
    name: '灭火器',
    model: 'MFZ/ABC4',
    unit: '具',
    serialNumber: 'FE-20260705-001',
    purpose: '消防应急',
    createdAt: now,
    updatedAt: now,
  },
]

function checkpoints(prefix: string, count: number) {
  return Array.from({ length: count }, (_, idx) => ({ id: `${prefix}-${idx + 1}`, name: `${prefix}${idx + 1}` }))
}

function data(
  l1TemplateId: string,
  l1TemplateName: string,
  checkpointPrefix: string,
  quantity: number,
  values: InspectionTableData['values'],
  faultValues: InspectionTableData['faultValues'],
  options: Partial<InspectionTableData> = {},
): InspectionTableData {
  return {
    l1TemplateId,
    l1TemplateName,
    checkpoints: checkpoints(checkpointPrefix, quantity),
    values,
    faultValues,
    notes: options.notes ?? '测试备注：仅最后页应承载完整备注内容。',
    segmentBreaks: Array.from(
      { length: Math.max(0, Math.ceil(quantity / 6) - 1) },
      (_, idx) => (idx + 1) * 6,
    ),
    rowBreaks: [],
    requirementOverrides: options.requirementOverrides ?? {},
    manualJudgements: options.manualJudgements ?? {},
    resultGroupName: options.resultGroupName,
    resultWeight: options.resultWeight,
  }
}

const videoACount = 32

const project: Project = {
  id: 'project-style-sample',
  name: 'Excel样式对比测试项目',
  createdAt: now,
  updatedAt: now,
  dataVersion: 2,
  l3TemplateId: 'l3-main',
  info: {
    companyName: '测试检查公司',
    ownerUnit: '测试建设单位',
    implementUnit: '测试实施单位',
    supervisorUnit: '测试监理单位',
  },
  locationItems: [
    {
      id: 'loc-video-a',
      l2TemplateId: 'l2-security',
      l2TemplateName: '安全防范设施',
      l1TemplateId: 'l1-video-a',
      l1TemplateName: '视频监控外观点检',
      unit: '台',
      quantity: videoACount,
      checkpointNames: checkpoints('摄像机', videoACount).map(item => item.name),
      resultGroupName: '视频监控系统',
      resultWeight: 60,
    },
    {
      id: 'loc-video-b',
      l2TemplateId: 'l2-security',
      l2TemplateName: '安全防范设施',
      l1TemplateId: 'l1-video-b',
      l1TemplateName: '视频监控功能点检',
      unit: '套',
      quantity: 4,
      checkpointNames: checkpoints('录像设备', 4).map(item => item.name),
      resultGroupName: '视频监控系统',
      resultWeight: 40,
    },
    {
      id: 'loc-fire',
      l2TemplateId: 'l2-fire',
      l2TemplateName: '消防设施',
      l1TemplateId: 'l1-fire',
      l1TemplateName: '消防设施点检',
      unit: '具',
      quantity: 5,
      checkpointNames: checkpoints('灭火器', 5).map(item => item.name),
    },
  ],
  subdivisions: [
    {
      l2TemplateId: 'l2-security',
      l2TemplateName: '安全防范设施',
      selectedL1Ids: ['l1-video-a', 'l1-video-b'],
      scoringData: { 'deduct-appearance': 1 },
      summaryWeight: 70,
      inspectionData: {
        'l1-video-a': data(
          'l1-video-a',
          '视频监控外观点检',
          '摄像机',
          videoACount,
          [
            Array.from({ length: videoACount }, (_, idx) => idx % 11 === 3 ? '不符合' : '符合'),
            Array.from({ length: videoACount }, (_, idx) => idx % 10 === 4 ? 88 : 90 + (idx % 9)),
            Array.from({ length: videoACount }, (_, idx) => idx % 13 === 5 ? '遮挡' : idx % 3 === 0 ? '正常' : '清晰'),
          ],
          Array.from({ length: videoACount }, (_, idx) => idx % 13 === 3 ? '是' : '否'),
          {
            locationItemId: 'loc-video-a',
            resultGroupName: '视频监控系统',
            resultWeight: 60,
            requirementOverrides: {
              'video-a-2': {
                requirement: '项目现场照度评分不低于 90 分',
                validationType: 'numeric',
                numericRule: { clauses: [{ op: '>=', value: 90 }] },
                numericRange: { min: 90, max: 100 },
              },
            },
            manualJudgements: { '2-3': 'fail', '2-18': 'fail', '2-27': 'fail' },
          },
        ),
        'l1-video-b': data(
          'l1-video-b',
          '视频监控功能点检',
          '录像设备',
          4,
          [
            ['符合', '符合', '符合', '符合'],
            [31, 29, 45, 60],
          ],
          ['否', '是', '否', '否'],
          {
            locationItemId: 'loc-video-b',
            resultGroupName: '视频监控系统',
            resultWeight: 40,
            requirementOverrides: {
              'video-b-2': {
                requirement: '项目要求录像保存不少于 30 天',
                validationType: 'numeric',
                numericRule: { clauses: [{ op: '>=', value: 30 }] },
                numericRange: { min: 30, max: 365 },
              },
            },
          },
        ),
      },
    },
    {
      l2TemplateId: 'l2-fire',
      l2TemplateName: '消防设施',
      selectedL1Ids: ['l1-fire'],
      scoringData: {},
      summaryWeight: 30,
      inspectionData: {
        'l1-fire': data(
          'l1-fire',
          '消防设施点检',
          '灭火器',
          5,
          [
            [1.3, 1.4, 1.1, 1.5, 1.6],
            ['有效', '有效', '过期', '有效', '有效'],
          ],
          ['否', '否', '是', '否', '否'],
          {
            locationItemId: 'loc-fire',
            requirementOverrides: {
              'fire-1': {
                requirement: '项目要求压力值 1.2MPa 至 1.6MPa',
                validationType: 'numeric',
                numericRule: {
                  clauses: [
                    { op: '>=', value: 1.2 },
                    { join: 'AND', op: '<=', value: 1.6 },
                  ],
                },
                numericRange: { min: 1.2, max: 1.6 },
              },
            },
            manualJudgements: { '1-2': 'fail' },
          },
        ),
      },
    },
  ],
}

function worksheetSnapshot(sheet: ExcelJS.Worksheet) {
  const merges = sheet.model.merges ?? []
  const rowHeights: Record<string, number | undefined> = {}
  for (let i = 1; i <= Math.min(sheet.rowCount, 25); i++) {
    const height = sheet.getRow(i).height
    if (height !== undefined) rowHeights[String(i)] = height
  }
  return {
    name: sheet.name,
    rowCount: sheet.rowCount,
    columnCount: sheet.columnCount,
    actualRowCount: sheet.actualRowCount,
    actualColumnCount: sheet.actualColumnCount,
    printArea: sheet.pageSetup.printArea,
    pageSetup: {
      paperSize: sheet.pageSetup.paperSize,
      orientation: sheet.pageSetup.orientation,
      fitToPage: sheet.pageSetup.fitToPage,
      scale: sheet.pageSetup.scale,
      fitToWidth: sheet.pageSetup.fitToWidth,
      fitToHeight: sheet.pageSetup.fitToHeight,
      horizontalCentered: sheet.pageSetup.horizontalCentered,
      verticalCentered: sheet.pageSetup.verticalCentered,
      margins: sheet.pageSetup.margins,
    },
    columnWidths: Array.from({ length: Math.min(sheet.columnCount, 18) }, (_, idx) => sheet.getColumn(idx + 1).width),
    rowHeights,
    merges,
    firstRows: Array.from({ length: Math.min(sheet.rowCount, 12) }, (_, rowIdx) =>
      Array.from({ length: Math.min(sheet.columnCount, 12) }, (_, colIdx) => {
        const value = sheet.getCell(rowIdx + 1, colIdx + 1).value
        if (value && typeof value === 'object' && 'richText' in value) {
          return value.richText?.map(part => part.text).join('')
        }
        return value
      }),
    ),
    keyStyles: ['A1', 'A2', 'A3', 'B3', 'C3', 'D3', 'E3', 'F3'].map(addr => {
      const cell = sheet.getCell(addr)
      return {
        cell: addr,
        value: cell.value,
        font: cell.font,
        alignment: cell.alignment,
        fill: cell.fill,
        border: cell.border,
      }
    }),
  }
}

function workbookSnapshot(workbook: ExcelJS.Workbook) {
  return {
    sheets: workbook.worksheets.map(worksheetSnapshot),
  }
}

function compareCommonSheets(client: ReturnType<typeof workbookSnapshot>, generated: ReturnType<typeof workbookSnapshot>) {
  const generatedByName = new Map(generated.sheets.map(sheet => [sheet.name, sheet]))
  return client.sheets.map(clientSheet => {
    const generatedSheet = generatedByName.get(clientSheet.name)
    if (!generatedSheet) {
      return {
        sheet: clientSheet.name,
        status: 'missing-in-generated',
        client: {
          rowCount: clientSheet.rowCount,
          columnCount: clientSheet.columnCount,
          columnWidths: clientSheet.columnWidths,
          rowHeights: clientSheet.rowHeights,
          printArea: clientSheet.printArea,
        },
      }
    }
    return {
      sheet: clientSheet.name,
      status: 'matched',
      rowCount: { client: clientSheet.rowCount, generated: generatedSheet.rowCount },
      columnCount: { client: clientSheet.columnCount, generated: generatedSheet.columnCount },
      printArea: { client: clientSheet.printArea, generated: generatedSheet.printArea },
      pageSetup: { client: clientSheet.pageSetup, generated: generatedSheet.pageSetup },
      columnWidths: { client: clientSheet.columnWidths, generated: generatedSheet.columnWidths },
      rowHeights: { client: clientSheet.rowHeights, generated: generatedSheet.rowHeights },
      mergesCount: { client: clientSheet.merges.length, generated: generatedSheet.merges.length },
      clientFirstRows: clientSheet.firstRows,
      generatedFirstRows: generatedSheet.firstRows,
    }
  })
}

async function main() {
  await fs.mkdir(outDir, { recursive: true })

  const generatedWorkbook = buildProjectWorkbook(project, l1Templates, l2Templates, devices, l3Templates)
  await generatedWorkbook.xlsx.writeFile(generatedPath)

  const generatedLoaded = new ExcelJS.Workbook()
  await generatedLoaded.xlsx.readFile(generatedPath)

  const clientWorkbook = new ExcelJS.Workbook()
  await clientWorkbook.xlsx.readFile(clientPath)

  const report = {
    generatedPath,
    clientPath,
    generatedSheetNames: generatedLoaded.worksheets.map(sheet => sheet.name),
    clientSheetNames: clientWorkbook.worksheets.map(sheet => sheet.name),
    generated: workbookSnapshot(generatedLoaded),
    client: workbookSnapshot(clientWorkbook),
    comparison: compareCommonSheets(workbookSnapshot(clientWorkbook), workbookSnapshot(generatedLoaded)),
  }

  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8')

  console.log(JSON.stringify({
    generatedPath,
    reportPath,
    generatedSheetNames: report.generatedSheetNames,
    clientSheetNames: report.clientSheetNames,
  }, null, 2))
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
