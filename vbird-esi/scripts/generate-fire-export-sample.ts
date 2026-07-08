import fs from 'node:fs/promises'
import path from 'node:path'
import { buildProjectWorkbook } from '../src/utils/excelExport'
import type { DeviceItem } from '../src/types/device'
import type { InspectionTableData, Project } from '../src/types/project'
import type { L1Template, L2Template, L3Template } from '../src/types/template'

const outDir = path.resolve('outputs/excel-style-check')
const outputPath = path.join(outDir, '消防设施效果确认.xlsx')
const now = '2026-07-08T00:00:00.000Z'
const fireCount = 32

const fireTemplate: L1Template = {
  id: 'l1-fire-confirm',
  name: '消防设施点检',
  facilityName: '灭火器',
  isCritical: true,
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
  inspectionItems: [
    {
      id: 'fire-pressure',
      groupId: 'pressure',
      groupName: '压力检查',
      requirement: '',
      inspectionMethod: '压力表读数',
      validationType: 'numeric',
      numericRule: {
        clauses: [
          { op: '>=', value: 1.2 },
          { join: 'AND', op: '<=', value: 1.6 },
        ],
      },
      numericRange: { min: 1.2, max: 1.6 },
      deviceId: 'dev-extinguisher',
      rowHeight: 30,
    },
    {
      id: 'fire-seal',
      groupId: 'validity',
      groupName: '有效期检查',
      requirement: '在有效期内，铅封完好，瓶体无明显锈蚀',
      inspectionMethod: '查看铭牌与铅封',
      validationType: 'manual',
      rowHeight: 30,
    },
    {
      id: 'fire-position',
      groupId: 'position',
      groupName: '摆放检查',
      requirement: '摆放位置明显，通道无遮挡，标识清晰',
      inspectionMethod: '现场目测',
      validationType: 'text',
      textOptions: ['符合', '不符合'],
      rowHeight: 30,
    },
  ],
  faultRow: { enabled: true, label: '灭火器' },
  styles: {
    mergeRules: [],
    defaultRowHeight: 30,
    headerRowHeight: 40,
    borderStyle: 'thin',
  },
  autoCutEnabled: true,
}

const fireL2: L2Template = {
  id: 'l2-fire-confirm',
  name: '消防设施',
  createdAt: now,
  updatedAt: now,
  availableL1Ids: [fireTemplate.id],
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
    deductionItems: [{ id: 'fire-deduction', label: '消防设施问题扣分' }],
    gradeThresholds: [
      { label: '0', minScore: 100 },
      { label: '1', minScore: 95 },
      { label: '2', minScore: 89 },
      { label: '3', minScore: 0 },
    ],
  },
}

const fireL3: L3Template = {
  id: 'l3-fire-confirm',
  name: '消防设施确认总表',
  createdAt: now,
  updatedAt: now,
  availableL2Ids: [fireL2.id],
  subdivisionWeights: [{ l2TemplateId: fireL2.id, weight: 100 }],
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
}

const devices: DeviceItem[] = [
  {
    id: 'dev-extinguisher',
    name: '灭火器',
    model: 'MFZ/ABC4',
    unit: '具',
    serialNumber: 'XF-MHQ-20260708-001',
    purpose: '消防应急',
    createdAt: now,
    updatedAt: now,
  },
]

function checkpoints(prefix: string, count: number) {
  return Array.from({ length: count }, (_, idx) => ({ id: `${prefix}-${idx + 1}`, name: `${prefix}${idx + 1}` }))
}

function segmentBreaks(quantity: number): number[] {
  return Array.from(
    { length: Math.max(0, Math.ceil(quantity / 6) - 1) },
    (_, idx) => (idx + 1) * 6,
  )
}

const fireData: InspectionTableData = {
  l1TemplateId: fireTemplate.id,
  l1TemplateName: fireTemplate.name,
  locationItemId: 'loc-fire-confirm',
  checkpoints: checkpoints('灭火器', fireCount),
  values: [
    Array.from({ length: fireCount }, (_, idx) => idx % 9 === 2 ? 1.1 : Number((1.25 + ((idx % 5) * 0.07)).toFixed(2))),
    Array.from({ length: fireCount }, (_, idx) => idx % 11 === 4 ? '铅封破损' : '有效'),
    Array.from({ length: fireCount }, (_, idx) => idx % 10 === 6 ? '不符合' : '符合'),
  ],
  requirementOverrides: {
    'fire-pressure': {
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
  manualJudgements: {
    '1-4': 'fail',
    '1-15': 'fail',
    '1-26': 'fail',
  },
  faultValues: Array.from({ length: fireCount }, (_, idx) => idx % 12 === 3 ? '是' : '否'),
  notes: '消防设施确认样例：仅最终点位段保留备注，并填充到该打印页块末尾。',
  segmentBreaks: segmentBreaks(fireCount),
  rowBreaks: [],
}

const project: Project = {
  id: 'project-fire-confirm',
  name: '消防设施效果确认',
  createdAt: now,
  updatedAt: now,
  dataVersion: 2,
  l3TemplateId: fireL3.id,
  info: {
    companyName: '检查公司',
    ownerUnit: '建设单位',
    implementUnit: '实施单位',
    supervisorUnit: '监理单位',
  },
  locationItems: [
    {
      id: 'loc-fire-confirm',
      l2TemplateId: fireL2.id,
      l2TemplateName: fireL2.name,
      l1TemplateId: fireTemplate.id,
      l1TemplateName: fireTemplate.name,
      unit: '具',
      quantity: fireCount,
      checkpointNames: checkpoints('灭火器', fireCount).map(item => item.name),
    },
  ],
  subdivisions: [
    {
      l2TemplateId: fireL2.id,
      l2TemplateName: fireL2.name,
      selectedL1Ids: [fireTemplate.id],
      inspectionData: {
        [fireTemplate.id]: fireData,
      },
      scoringData: { 'fire-deduction': 1 },
      summaryWeight: 100,
    },
  ],
}

async function main() {
  await fs.mkdir(outDir, { recursive: true })
  const workbook = buildProjectWorkbook(project, [fireTemplate], [fireL2], devices, [fireL3])
  await workbook.xlsx.writeFile(outputPath)
  console.log(outputPath)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
