import fs from 'node:fs/promises'
import path from 'node:path'
import { buildProjectWorkbook, writeWorkbookBuffer } from '../src/utils/excelExport'
import type { DeviceItem } from '../src/types/device'
import type { InspectionTableData, Project, ProjectLocationItem } from '../src/types/project'
import type { InspectionItem, L1Template, L2Template, L3Template } from '../src/types/template'

const outDir = path.resolve('outputs/excel-style-check')
const outputPath = path.join(outDir, '消防安全多点检闭环.xlsx')
const now = '2026-07-09T00:00:00.000Z'

const fixedColumns = [
  { id: 'seq', label: '序号', width: 60 },
  { id: 'item', label: '检查项目', width: 160 },
  { id: 'requirement', label: '技术要求', width: 260 },
]

const styles = {
  mergeRules: [],
  defaultRowHeight: 30,
  headerRowHeight: 40,
  borderStyle: 'thin' as const,
}

const gradeThresholds = [
  { label: '优良', minScore: 90 },
  { label: '合格', minScore: 75 },
  { label: '不合格', minScore: 0 },
]

function makeTextItem(id: string, groupName: string, requirement: string, method: string, deviceId?: string): InspectionItem {
  return {
    id,
    groupId: id,
    groupName,
    requirement,
    inspectionMethod: method,
    validationType: 'text',
    textOptions: ['符合', '不符合', '/'],
    deviceId,
    rowHeight: 30,
  }
}

function makeManualItem(id: string, groupName: string, requirement: string, method: string, deviceId?: string): InspectionItem {
  return {
    id,
    groupId: id,
    groupName,
    requirement,
    inspectionMethod: method,
    validationType: 'manual',
    deviceId,
    rowHeight: 30,
  }
}

function makeNumericItem(
  id: string,
  groupName: string,
  requirement: string,
  method: string,
  min: number,
  max: number,
  deviceId?: string,
): InspectionItem {
  return {
    id,
    groupId: id,
    groupName,
    requirement,
    inspectionMethod: method,
    validationType: 'numeric',
    numericRule: {
      clauses: [
        { op: '>=', value: min },
        { join: 'AND', op: '<=', value: max },
      ],
    },
    numericRange: { min, max },
    deviceId,
    rowHeight: 30,
  }
}

function makeTemplate(
  id: string,
  name: string,
  facilityName: string,
  faultLabel: string,
  inspectionItems: InspectionItem[],
  isCritical = false,
): L1Template {
  return {
    id,
    name,
    facilityName,
    isCritical,
    createdAt: now,
    updatedAt: now,
    columns: {
      fixedColumns,
      dataColumnWidth: 90,
      summaryColumnWidth: 100,
    },
    inspectionItems,
    faultRow: { enabled: true, label: faultLabel },
    styles,
    autoCutEnabled: true,
  }
}

function makeL2(id: string, name: string, availableL1Ids: string[], deductionLabel: string): L2Template {
  return {
    id,
    name,
    createdAt: now,
    updatedAt: now,
    availableL1Ids,
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
      deductionItems: [{ id: `${id}-deduction`, label: deductionLabel }],
      gradeThresholds,
    },
  }
}

function checkpoints(prefix: string, count: number) {
  return Array.from({ length: count }, (_, idx) => ({ id: `${prefix}-${idx + 1}`, name: `${prefix}${idx + 1}` }))
}

function segmentBreaks(quantity: number): number[] {
  return Array.from(
    { length: Math.max(0, Math.ceil(quantity / 6) - 1) },
    (_, idx) => (idx + 1) * 6,
  )
}

function makeValues(template: L1Template, count: number) {
  return template.inspectionItems.map((item, rowIdx) =>
    Array.from({ length: count }, (_, cpIdx) => {
      if (item.validationType === 'numeric') {
        return cpIdx % 11 === 3 ? 0.8 : Number((1.2 + ((rowIdx + cpIdx) % 5) * 0.08).toFixed(2))
      }
      if (item.validationType === 'manual') {
        return cpIdx % 9 === 5 ? '铅封破损' : '正常'
      }
      return cpIdx % 10 === 6 ? '不符合' : '符合'
    }),
  )
}

function makeManualJudgements(template: L1Template, count: number) {
  const result: Record<string, 'pass' | 'fail'> = {}
  template.inspectionItems.forEach((item, rowIdx) => {
    if (item.validationType !== 'manual') return
    for (let cpIdx = 0; cpIdx < count; cpIdx++) {
      if ((rowIdx + cpIdx) % 13 === 4) result[`${rowIdx}-${cpIdx}`] = 'fail'
    }
  })
  return result
}

function makeInspectionData(
  template: L1Template,
  locationItemId: string,
  prefix: string,
  count: number,
  notes: string,
): InspectionTableData {
  return {
    l1TemplateId: template.id,
    l1TemplateName: template.name,
    locationItemId,
    checkpoints: checkpoints(prefix, count),
    values: makeValues(template, count),
    manualJudgements: makeManualJudgements(template, count),
    faultValues: Array.from({ length: count }, (_, idx) => idx % 12 === 3 ? '是' : '否'),
    notes,
    segmentBreaks: segmentBreaks(count),
    rowBreaks: [],
  }
}

const extinguisherTemplate = makeTemplate(
  'l1-extinguisher',
  '灭火器点检',
  '灭火器',
  '灭火器',
  [
    makeNumericItem('pressure', '压力检查', '压力值应处于 1.2MPa 至 1.6MPa 之间', '压力表读数', 1.2, 1.6, 'dev-extinguisher'),
    makeManualItem('seal', '有效期检查', '在有效期内，铅封完好，瓶体无明显锈蚀', '查看铭牌与铅封', 'dev-extinguisher'),
    makeTextItem('position', '摆放检查', '摆放位置明显，通道无遮挡，标识清晰', '现场目测', 'dev-extinguisher'),
  ],
  true,
)

const hydrantTemplate = makeTemplate(
  'l1-hydrant',
  '室内消火栓点检',
  '室内消火栓',
  '消火栓',
  [
    makeTextItem('box', '箱体检查', '箱门开启灵活，箱体无变形锈蚀', '现场目测', 'dev-hydrant'),
    makeTextItem('hose', '水带水枪', '水带盘卷整齐，水枪接口完整无缺失', '现场目测', 'dev-hydrant'),
    makeNumericItem('pressure', '静压检查', '静压应不低于 0.15MPa 且不高于 0.5MPa', '压力表读数', 0.15, 0.5, 'dev-hydrant'),
  ],
)

const alarmTemplate = makeTemplate(
  'l1-alarm',
  '火灾报警点检',
  '火灾自动报警',
  '报警设备',
  [
    makeTextItem('panel', '控制器状态', '主机运行正常，无屏蔽、故障、火警未处理信息', '查看控制器面板', 'dev-alarm'),
    makeTextItem('detector', '探测器外观', '探测器安装牢固，无遮挡、无脱落、无污染', '现场目测', 'dev-alarm'),
    makeManualItem('manual', '手报按钮', '手动报警按钮标识清楚，保护罩完好', '现场抽查', 'dev-alarm'),
  ],
  true,
)

const evacuationTemplate = makeTemplate(
  'l1-evacuation',
  '疏散通道点检',
  '疏散通道',
  '通道',
  [
    makeTextItem('exit', '安全出口', '安全出口保持畅通，门开启方向正确', '现场目测', 'dev-exit'),
    makeTextItem('sign', '疏散指示', '疏散指示标志清晰，方向准确，无遮挡', '现场目测', 'dev-exit'),
    makeTextItem('light', '应急照明', '应急照明灯具安装牢固，试验按钮有效', '按下试验按钮', 'dev-exit'),
  ],
)

const pumpItems = Array.from({ length: 22 }, (_, idx) =>
  makeTextItem(
    `pump-${idx + 1}`,
    `泵房项目${idx + 1}`,
    `消防泵房第 ${idx + 1} 项检查要求：设备、管线、阀门、控制柜和现场标识保持完好，现场记录与运行状态一致。`,
    '现场目测与运行记录核对',
    'dev-pump',
  ),
)
const pumpTemplate = makeTemplate('l1-pump', '消防泵房点检', '消防泵房', '泵房设备', pumpItems, true)

const l1Templates = [
  extinguisherTemplate,
  hydrantTemplate,
  alarmTemplate,
  evacuationTemplate,
  pumpTemplate,
]

const fireL2 = makeL2('l2-fire-facility', '消防设施', [extinguisherTemplate.id, hydrantTemplate.id, pumpTemplate.id], '消防设施问题扣分')
const alarmL2 = makeL2('l2-alarm-evacuation', '报警与疏散', [alarmTemplate.id, evacuationTemplate.id], '报警疏散问题扣分')
const l2Templates = [fireL2, alarmL2]

const l3Template: L3Template = {
  id: 'l3-fire-safety-regression',
  name: '消防安全检查总表',
  createdAt: now,
  updatedAt: now,
  availableL2Ids: l2Templates.map(item => item.id),
  subdivisionWeights: [
    { l2TemplateId: fireL2.id, weight: 60 },
    { l2TemplateId: alarmL2.id, weight: 40 },
  ],
  headerInfo: {
    title: '检查结果计算表',
    fields: { companyName: '', projectName: '' },
  },
  styles,
}

const devices: DeviceItem[] = [
  { id: 'dev-extinguisher', name: '灭火器', model: 'MFZ/ABC4', unit: '具', serialNumber: 'XF-MHQ-001', purpose: '初起火灾扑救', createdAt: now, updatedAt: now },
  { id: 'dev-hydrant', name: '室内消火栓', model: 'SN65', unit: '套', serialNumber: 'XF-XHS-001', purpose: '室内消防供水', createdAt: now, updatedAt: now },
  { id: 'dev-alarm', name: '火灾报警设备', model: 'JB-QB', unit: '台', serialNumber: 'XF-BJ-001', purpose: '火灾报警联动', createdAt: now, updatedAt: now },
  { id: 'dev-exit', name: '疏散设施', model: '通用', unit: '处', serialNumber: 'XF-SS-001', purpose: '人员疏散', createdAt: now, updatedAt: now },
  { id: 'dev-pump', name: '消防泵组', model: 'XBD', unit: '套', serialNumber: 'XF-PUMP-001', purpose: '消防给水加压', createdAt: now, updatedAt: now },
]

const dataById: Record<string, InspectionTableData> = {
  [extinguisherTemplate.id]: makeInspectionData(extinguisherTemplate, 'loc-extinguisher', '灭火器', 32, '灭火器点检备注：末页 5 点位 + 汇总列验证。'),
  [hydrantTemplate.id]: makeInspectionData(
    hydrantTemplate,
    'loc-hydrant',
    '消火栓',
    14,
    [
      '消火栓备注专页验证：覆盖首层、裙楼、地下车库等不同区域。',
      '超过三行时应独立生成备注页。',
      '备注页需要填充完整 A4 打印区域。',
      '同时不应重复生成多个备注页。',
    ].join('\n'),
  ),
  [pumpTemplate.id]: makeInspectionData(
    pumpTemplate,
    'loc-pump',
    '泵房点',
    5,
    [
      '消防泵房备注专页验证：该表检查项目较多，最终点位块已经接近页尾。',
      '现场要求备注超过三行时，不再挤入最后一个有效表。',
      '备注应另起一页显示，且只占用一个备注页块。',
      '打印检查时需确认 A4 边框完整、文字换行正常。',
    ].join('\n'),
  ),
  [alarmTemplate.id]: makeInspectionData(alarmTemplate, 'loc-alarm', '报警点', 18, '报警系统备注：抽查主机、探测器、手报按钮和联动反馈。'),
  [evacuationTemplate.id]: makeInspectionData(evacuationTemplate, 'loc-evacuation', '疏散点', 7, '疏散通道备注：覆盖安全出口、楼梯间、走廊和地下空间。'),
}

const locationItems: ProjectLocationItem[] = [
  { id: 'loc-extinguisher', l2TemplateId: fireL2.id, l2TemplateName: fireL2.name, l1TemplateId: extinguisherTemplate.id, l1TemplateName: extinguisherTemplate.name, unit: '具', quantity: 32, checkpointNames: dataById[extinguisherTemplate.id].checkpoints.map(item => item.name) },
  { id: 'loc-hydrant', l2TemplateId: fireL2.id, l2TemplateName: fireL2.name, l1TemplateId: hydrantTemplate.id, l1TemplateName: hydrantTemplate.name, unit: '套', quantity: 14, checkpointNames: dataById[hydrantTemplate.id].checkpoints.map(item => item.name) },
  { id: 'loc-pump', l2TemplateId: fireL2.id, l2TemplateName: fireL2.name, l1TemplateId: pumpTemplate.id, l1TemplateName: pumpTemplate.name, unit: '处', quantity: 5, checkpointNames: dataById[pumpTemplate.id].checkpoints.map(item => item.name) },
  { id: 'loc-alarm', l2TemplateId: alarmL2.id, l2TemplateName: alarmL2.name, l1TemplateId: alarmTemplate.id, l1TemplateName: alarmTemplate.name, unit: '点', quantity: 18, checkpointNames: dataById[alarmTemplate.id].checkpoints.map(item => item.name) },
  { id: 'loc-evacuation', l2TemplateId: alarmL2.id, l2TemplateName: alarmL2.name, l1TemplateId: evacuationTemplate.id, l1TemplateName: evacuationTemplate.name, unit: '处', quantity: 7, checkpointNames: dataById[evacuationTemplate.id].checkpoints.map(item => item.name) },
]

const project: Project = {
  id: 'project-fire-safety-regression',
  name: '消防安全多点检闭环',
  createdAt: now,
  updatedAt: now,
  dataVersion: 2,
  l3TemplateId: l3Template.id,
  info: {
    companyName: '消防安全检查公司',
    ownerUnit: '建设单位',
    implementUnit: '维保实施单位',
    supervisorUnit: '监理单位',
  },
  locationItems,
  subdivisions: [
    {
      l2TemplateId: fireL2.id,
      l2TemplateName: fireL2.name,
      selectedL1Ids: [extinguisherTemplate.id, hydrantTemplate.id, pumpTemplate.id],
      inspectionData: {
        [extinguisherTemplate.id]: dataById[extinguisherTemplate.id],
        [hydrantTemplate.id]: dataById[hydrantTemplate.id],
        [pumpTemplate.id]: dataById[pumpTemplate.id],
      },
      scoringData: { [`${fireL2.id}-deduction`]: 1.5 },
      summaryWeight: 60,
    },
    {
      l2TemplateId: alarmL2.id,
      l2TemplateName: alarmL2.name,
      selectedL1Ids: [alarmTemplate.id, evacuationTemplate.id],
      inspectionData: {
        [alarmTemplate.id]: dataById[alarmTemplate.id],
        [evacuationTemplate.id]: dataById[evacuationTemplate.id],
      },
      scoringData: { [`${alarmL2.id}-deduction`]: 1 },
      summaryWeight: 40,
    },
  ],
}

async function main() {
  await fs.mkdir(outDir, { recursive: true })
  const workbook = buildProjectWorkbook(project, l1Templates, l2Templates, devices, [l3Template])
  const buffer = await writeWorkbookBuffer(workbook)
  await fs.writeFile(outputPath, Buffer.from(buffer))
  console.log(outputPath)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
