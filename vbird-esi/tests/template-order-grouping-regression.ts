import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import type { L1Template, L2Template, L3Template, Project } from '@/types'
import { buildProjectCalcPreview } from '@/utils/projectCalc'
import { buildProjectWorkbook, writeWorkbookBuffer } from '@/utils/excelExport'
import { buildL1ExportPrintPages, buildL1VerticalRowSlices, getUsablePageHeightPt, L1_PRINT_LAYOUT } from '@/utils/l1PrintLayout'
import { createObjectPackage, prepareObjectPackageImport } from '@/utils/objectPackage'
import { createInspectionData, syncInspectionDataToLocationItem } from '@/utils/projectStructure'
import { getOrderedProjectSubdivisions } from '@/utils/projectOrder'

const now = '2026-07-10T00:00:00.000Z'
const regressionOutputDir = '.tmp-regression'

await fs.mkdir(regressionOutputDir, { recursive: true })

function l1(id: string, name: string, group?: string, weight = 1): L1Template {
  return {
    id, name, facilityName: name, resultGroupName: group, resultWeight: weight, createdAt: now, updatedAt: now,
    columns: { fixedColumns: [], dataColumnWidth: 90, summaryColumnWidth: 100 },
    inspectionItems: [{
      id: `${id}-item`, groupId: `${id}-group`, groupName: '外观', requirement: '符合要求',
      inspectionMethod: '目测', validationType: 'text', textOptions: ['符合', '不符合', '/'],
    }],
    faultRow: { enabled: true, label: name },
    styles: { mergeRules: [], defaultRowHeight: 30, headerRowHeight: 40, borderStyle: 'thin' },
  }
}

function table(template: L1Template, faults: Array<'是' | '否'>, group?: string, weight?: number) {
  const data = createInspectionData(template, faults.map((_, index) => `地点${index + 1}`))
  data.faultValues = faults
  data.values[0] = faults.map(() => '符合')
  data.resultGroupName = group
  data.resultWeight = weight
  return data
}

const l1C = l1('l1-c', '控制器', '报警设施', 1)
const l1A = l1('l1-a', '自动报警', '报警设施', 2)
const l1B = l1('l1-b', '手动报警', '报警设施', 0)
const l1D = l1('l1-d', '照明')
const l1Templates = [l1A, l1B, l1C, l1D]
const l2 = {
  id: 'l2-fire', name: '消防', createdAt: now, updatedAt: now,
  availableL1Ids: ['l1-c', 'l1-a', 'l1-b', 'l1-d'],
  headerInfo: { title: '分部工程质量检验评定表', fields: { companyName: '', subdivisionName: '', implementUnit: '', ownerUnit: '', supervisorUnit: '' } },
  scoring: { deductionItems: [], gradeThresholds: [{ label: '优良', minScore: 85 }, { label: '合格', minScore: 70 }, { label: '不合格', minScore: 0 }] },
} satisfies L2Template
const l3 = {
  id: 'l3-main', name: '总表', createdAt: now, updatedAt: now, availableL2Ids: ['l2-fire'],
  subdivisionWeights: [{ l2TemplateId: 'l2-fire', weight: 1 }],
  headerInfo: { title: '检查结果计算表', fields: { companyName: '', projectName: '' } },
  styles: { mergeRules: [], defaultRowHeight: 30, headerRowHeight: 40, borderStyle: 'thin' },
} satisfies L3Template

const project: Project = {
  id: 'project-1', name: '排序组合回归', createdAt: now, updatedAt: now, l3TemplateId: l3.id,
  info: { companyName: '测试公司', ownerUnit: '', implementUnit: '', supervisorUnit: '' },
  locationItems: [],
  subdivisions: [{
    l2TemplateId: l2.id, l2TemplateName: l2.name,
    selectedL1Ids: ['l1-a', 'l1-d', 'l1-b', 'l1-c'],
    inspectionData: {
      'l1-a': table(l1A, ['否', '否'], '报警设施', 2),
      'l1-b': table(l1B, ['是'], '报警设施', 0),
      'l1-c': table(l1C, ['是', '否'], '报警设施', 1),
      'l1-d': table(l1D, ['否']),
    },
    scoringData: {}, summaryWeight: 1,
  }],
}

project.locationItems = Object.entries(project.subdivisions[0].inspectionData).map(([l1TemplateId, data]) => ({
  id: `loc-${l1TemplateId}`, l2TemplateId: l2.id, l2TemplateName: l2.name, l1TemplateId,
  l1TemplateName: data.l1TemplateName, unit: '台', quantity: data.checkpoints.length,
  checkpointNames: data.checkpoints.map(point => point.name),
  resultGroupName: data.resultGroupName, resultWeight: data.resultWeight,
}))

const preview = buildProjectCalcPreview(project, l1Templates, { l2Templates: [l2], l3Template: l3 })
assert.deepEqual(preview.subdivisions[0].l1Rows.map(row => row.name), ['报警设施', '照明'])
assert.equal(preview.subdivisions[0].l1Rows[0].sourceL1Ids.join(','), 'l1-c,l1-a,l1-b')
assert.equal(preview.subdivisions[0].l1Rows[0].passRate, '83.3%')

const fireButton = { ...l1('l1-fire-button', '手动火灾报警按钮', '火灾报警设施', 1), isCritical: true }
const fireDetector = { ...l1('l1-fire-detector', '自动火灾报警设施', '火灾报警设施', 1), isCritical: true }
const fireController = { ...l1('l1-fire-controller', '火灾报警控制器', '火灾报警设施', 1), isCritical: true }
const generalEquipment = l1('l1-general-equipment', '一般设备')
const criticalTemplates = [fireButton, fireDetector, fireController, generalEquipment]
const criticalL2 = { ...l2, id: 'l2-critical', availableL1Ids: criticalTemplates.map(template => template.id) }
const criticalData = {
  [fireButton.id]: table(fireButton, ['否'], '火灾报警设施', 1),
  [fireDetector.id]: table(fireDetector, ['是', '否'], '火灾报警设施', 1),
  [fireController.id]: table(fireController, ['否'], '火灾报警设施', 1),
  [generalEquipment.id]: table(generalEquipment, ['否']),
}
const criticalProject: Project = {
  ...project,
  id: 'project-critical',
  locationItems: [],
  subdivisions: [{
    l2TemplateId: criticalL2.id,
    l2TemplateName: criticalL2.name,
    selectedL1Ids: criticalTemplates.map(template => template.id),
    inspectionData: criticalData,
    scoringData: {},
    summaryWeight: 1,
  }],
}
const criticalPreview = buildProjectCalcPreview(criticalProject, criticalTemplates, { l2Templates: [criticalL2] })
assert.equal(criticalPreview.subdivisions[0].l1Rows[0].name, '火灾报警设施*')
assert.equal(criticalPreview.subdivisions[0].l1Rows[0].isCritical, true)
assert.equal(criticalPreview.subdivisions[0].passRate, '83.3%', '关键组合为最低值时，L2 合计完好率应取关键组合值')
criticalProject.locationItems = Object.entries(criticalData).map(([l1TemplateId, data]) => ({
  id: `critical-location-${l1TemplateId}`,
  l2TemplateId: criticalL2.id,
  l2TemplateName: criticalL2.name,
  l1TemplateId,
  l1TemplateName: data.l1TemplateName,
  unit: '台',
  quantity: data.checkpoints.length,
  checkpointNames: data.checkpoints.map(checkpoint => checkpoint.name),
  resultGroupName: data.resultGroupName,
  resultWeight: data.resultWeight,
}))
const criticalWorkbook = buildProjectWorkbook(criticalProject, criticalTemplates, [criticalL2], [], [l3])
assert.equal(criticalWorkbook.getWorksheet('结果清单')?.getCell('C4').value, '火灾报警设施*')
assert.equal(criticalWorkbook.getWorksheet('点位清单表')?.getCell('B5').value, '火灾报警设施*')
assert.equal(criticalWorkbook.getWorksheet('检查体系结构')?.getCell('B5').value, '火灾报警设施*')

const fallbackProject: Project = {
  ...criticalProject,
  id: 'project-critical-fallback',
  subdivisions: [{
    ...criticalProject.subdivisions[0],
    inspectionData: {
      [fireButton.id]: table(fireButton, ['否'], '火灾报警设施', 1),
      [fireDetector.id]: table(fireDetector, ['否'], '火灾报警设施', 1),
      [fireController.id]: table(fireController, ['否'], '火灾报警设施', 1),
      [generalEquipment.id]: table(generalEquipment, ['是']),
    },
  }],
}
const fallbackPreview = buildProjectCalcPreview(fallbackProject, criticalTemplates, { l2Templates: [criticalL2] })
assert.equal(fallbackPreview.subdivisions[0].passRate, '75.0%', '关键设备不是最低值时，L2 合计完好率应按总量和故障数量计算')

const checkpointSyncData = createInspectionData(fireButton, ['原地点'], 'location-sync')
const checkpointSyncProject: Project = {
  ...project,
  id: 'project-checkpoint-sync',
  locationItems: [{
    id: 'location-sync',
    l2TemplateId: criticalL2.id,
    l2TemplateName: criticalL2.name,
    l1TemplateId: fireButton.id,
    l1TemplateName: fireButton.name,
    unit: '台',
    quantity: 1,
    checkpointNames: ['原地点'],
  }],
  subdivisions: [{
    l2TemplateId: criticalL2.id,
    l2TemplateName: criticalL2.name,
    selectedL1Ids: [fireButton.id],
    inspectionData: { [fireButton.id]: checkpointSyncData },
    scoringData: {},
    summaryWeight: 1,
  }],
}
checkpointSyncData.checkpoints[0].name = '修改地点'
checkpointSyncData.checkpoints.push({ id: 'checkpoint-added', name: '新增地点' })
checkpointSyncData.values.forEach(row => row.push(null))
checkpointSyncData.faultValues.push(null)
syncInspectionDataToLocationItem(checkpointSyncProject, checkpointSyncProject.subdivisions[0], checkpointSyncData)
assert.deepEqual(checkpointSyncProject.locationItems[0].checkpointNames, ['修改地点', '新增地点'])
assert.equal(checkpointSyncProject.locationItems[0].quantity, 2)
checkpointSyncData.checkpoints.splice(0, 1)
checkpointSyncData.values.forEach(row => row.splice(0, 1))
checkpointSyncData.faultValues.splice(0, 1)
syncInspectionDataToLocationItem(checkpointSyncProject, checkpointSyncProject.subdivisions[0], checkpointSyncData)
assert.deepEqual(checkpointSyncProject.locationItems[0].checkpointNames, ['新增地点'])
assert.equal(checkpointSyncProject.locationItems[0].quantity, 1)

const l3OrderProbe = { ...l3, availableL2Ids: ['l2-before', 'l2-fire'] }
const orderProject = {
  ...project,
  subdivisions: [
    project.subdivisions[0],
    { ...project.subdivisions[0], l2TemplateId: 'l2-before', l2TemplateName: '前置分部' },
  ],
}
assert.deepEqual(getOrderedProjectSubdivisions(orderProject, l3OrderProbe).map(sub => sub.l2TemplateId), ['l2-before', 'l2-fire'])

const invalidData = table(l1D, ['否'], '无有效组合', 1)
invalidData.faultValues = [null]
const invalidPreview = buildProjectCalcPreview({
  ...project,
  subdivisions: [{ ...project.subdivisions[0], selectedL1Ids: ['l1-d'], inspectionData: { 'l1-d': invalidData } }],
}, l1Templates, { l2Templates: [l2], l3Template: l3 })
assert.equal(invalidPreview.subdivisions[0].l1Rows[0].passRate, '/')

const workbook = buildProjectWorkbook(project, l1Templates, [l2], [], [l3])
assert.deepEqual(workbook.worksheets.slice(0, 5).map(sheet => sheet.name), ['检查结果计算表', '点位清单表', '检查体系结构', '结果清单', '设备清单'])
assert.ok(workbook.getWorksheet('检查体系结构'))
assert.ok(workbook.getWorksheet('自动报警'))
const workbookWrite = workbook.xlsx.writeFile(regressionOutputDir + '/template-order-grouping-regression.xlsx')

const paginationTemplate = l1('l1-pages', '分页回归')
const paginationData = table(paginationTemplate, Array.from({ length: 18 }, () => '否'))
const pages = buildL1ExportPrintPages(paginationTemplate, paginationData)
for (const page of pages) {
  const last = page.segments.at(-1)
  assert.ok(last)
  page.segments.slice(0, -1).forEach(segment => assert.equal(segment.notesRowHeight, segment.baseNotesRowHeight))
  assert.ok(last.notesRowHeight >= last.baseNotesRowHeight)
}

const longTemplate: L1Template = {
  ...l1('l1-long', '自备发电设施'),
  inspectionItems: Array.from({ length: 65 }, (_, index) => ({
    id: 'long-item-' + index,
    groupId: 'long-group-' + Math.floor(index / 5),
    groupName: '检查组' + (Math.floor(index / 5) + 1),
    requirement: '检查项目 ' + (index + 1) + ' 应符合设备运行和安全技术要求。',
    inspectionMethod: '目测',
    validationType: 'text' as const,
    textOptions: ['符合', '不符合', '/'],
  })),
}
const longData = createInspectionData(longTemplate, Array.from({ length: 6 }, (_, index) => '机组' + (index + 1)))
longData.values = longTemplate.inspectionItems.map(() => Array.from({ length: 6 }, () => '符合'))
longData.faultValues = Array.from({ length: 6 }, () => '否')
longData.notes = '长检查项目分页回归备注。'
const longSlices = buildL1VerticalRowSlices(longTemplate, longData, 150)
assert.ok(longSlices.length > 1)
assert.equal(longSlices.at(-1)?.endIndex, 65)

const communicationRequirements = [
  '外观有无污染、损伤',
  '分机能否一键呼叫主机',
  '通话效果试验',
  '外观有无污染、损伤',
  '能否向隧道广播语音',
  '环境噪声≤90dB时，话音清晰，隧道中能听清广播内容',
  '外观有无污染、损伤',
  '主机呼叫分机试验',
  '控制台可自动录音',
  '控制台能显示呼叫位置信息',
  '呼叫在控制台有振铃响应',
  '呼叫后，话机有等待信号或提示音',
  '控制台可取消呼叫',
  '中心可自动立即显示故障信息',
  '系统能手动设置实时检测线路连接、电池、设备的工作状态',
  '系统能自动生成事件、故障、值班记录等报告，并可查询、打印',
  '监控员能实时广播，也可播放已录制的节目',
  '可对广播音量的大小进行调节',
  '可对指定的节目源循环播放',
  '具有音区多路切换选择广播功能，可进行单音区、多音区广播',
]

const groupedPaginationTemplate: L1Template = {
  ...longTemplate,
  id: 'l1-grouped-pagination',
  inspectionItems: communicationRequirements.map((requirement, index) => ({
    ...longTemplate.inspectionItems[index],
    id: 'grouped-item-' + index,
    groupId: index < 3 ? 'phone' : index < 6 ? 'broadcast' : 'platform',
    groupName: index < 3 ? '紧急电话' : index < 6 ? '广播' : '操作平台',
    requirement,
    rowHeight: 30,
  })),
}
const groupedPaginationData = createInspectionData(groupedPaginationTemplate, ['地点1'])
const groupedSlices = buildL1VerticalRowSlices(groupedPaginationTemplate, groupedPaginationData, 98)
assert.ok(groupedSlices.length > 1)
assert.equal(groupedSlices.at(-1)?.isLast, true, '最终分片必须承载故障、完好率和备注尾部')
assert.ok(
  groupedSlices[0].endIndex > 6,
  '普通页应优先填满，可在检查项目组内分页，不能为给末页预留整组而留下大量空白',
)
assert.equal(
  groupedPaginationTemplate.inspectionItems[groupedSlices[0].endIndex - 1]?.groupId,
  groupedPaginationTemplate.inspectionItems[groupedSlices[0].endIndex]?.groupId,
  '当前页剩余空间足够时，应允许在同一检查项目组内拆页',
)

const longProject: Project = {
  ...project,
  id: 'project-long',
  name: '长检查项目回归',
  locationItems: [],
  subdivisions: [{
    l2TemplateId: l2.id,
    l2TemplateName: l2.name,
    selectedL1Ids: [longTemplate.id],
    inspectionData: { [longTemplate.id]: longData },
    scoringData: {},
    summaryWeight: 1,
  }],
}
const longWorkbook = buildProjectWorkbook(longProject, [longTemplate], [l2], [], [l3])
const longSheet = longWorkbook.getWorksheet('自备发电设施')
assert.ok(longSheet)
const longPrintAreas = (longSheet as typeof longSheet & { __esiPrintAreas?: string[] }).__esiPrintAreas ?? []
assert.ok(longPrintAreas.length > 1)
longPrintAreas.forEach(area => {
  const startCell = area.match(/^([A-Z]+\d+):/)?.[1]
  assert.ok(startCell)
  assert.equal(longSheet.getCell(startCell).value, '设施名称：自备发电设施')
})
assert.ok(longSheet.getRow(longSheet.rowCount).values.includes('备注'))
const inspectionSystemSheet = longWorkbook.getWorksheet('检查体系结构')
assert.ok(inspectionSystemSheet)
assert.equal(inspectionSystemSheet.pageSetup.paperSize, 9)
assert.equal(inspectionSystemSheet.pageSetup.orientation, 'landscape')
assert.equal(inspectionSystemSheet.pageSetup.fitToPage, true)
assert.equal((inspectionSystemSheet as typeof inspectionSystemSheet & { __esiPrintAreas?: string[] }).__esiPrintAreas, undefined)
assert.equal(longSheet.getCell(4, 1).value, 1)
assert.equal(longSheet.getCell(9, 1).value, 2)

const wideData = table(paginationTemplate, Array.from({ length: 60 }, () => '否'))
const wideProject: Project = {
  ...project,
  id: 'project-wide',
  name: '纵向页块回归',
  locationItems: [],
  subdivisions: [{
    l2TemplateId: l2.id,
    l2TemplateName: l2.name,
    selectedL1Ids: [paginationTemplate.id],
    inspectionData: { [paginationTemplate.id]: wideData },
    scoringData: {},
    summaryWeight: 1,
  }],
}
const wideWorkbook = buildProjectWorkbook(wideProject, [paginationTemplate], [l2], [], [l3])
const wideSheet = wideWorkbook.getWorksheet('分页回归')
assert.ok(wideSheet)
const widePrintAreas = (wideSheet as typeof wideSheet & { __esiPrintAreas?: string[] }).__esiPrintAreas ?? []
assert.ok(widePrintAreas.length > 2)
assert.match(widePrintAreas[0], /^A1:I\d+$/)
assert.ok(widePrintAreas.some(area => /^J1:R\d+$/.test(area)))
assert.equal((wideSheet as typeof wideSheet & { __esiColumnPageBreaks?: number[] }).__esiColumnPageBreaks, undefined)
const longWorkbookWrite = writeWorkbookBuffer(longWorkbook)
  .then(buffer => fs.writeFile(regressionOutputDir + '/long-inspection-pagination-regression.xlsx', new Uint8Array(buffer)))
const wideWorkbookWrite = writeWorkbookBuffer(wideWorkbook)
  .then(buffer => fs.writeFile(regressionOutputDir + '/l1-stacked-pages-regression.xlsx', new Uint8Array(buffer)))

const communicationTemplate: L1Template = {
  ...groupedPaginationTemplate,
  id: 'l1-communication',
  name: '紧急电话及广播',
  facilityName: '紧急电话及广播',
}
const communicationData = createInspectionData(
  communicationTemplate,
  Array.from({ length: 19 }, (_, index) => '地点' + (index + 1)),
)
communicationData.values = communicationTemplate.inspectionItems.map(() =>
  Array.from({ length: 19 }, () => '符合'),
)
communicationData.faultValues = Array.from({ length: 19 }, () => '否')
const communicationProject: Project = {
  ...project,
  id: 'project-communication',
  name: '通信布局回归',
  locationItems: [],
  subdivisions: [{
    l2TemplateId: l2.id,
    l2TemplateName: l2.name,
    selectedL1Ids: [communicationTemplate.id],
    inspectionData: { [communicationTemplate.id]: communicationData },
    scoringData: {},
    summaryWeight: 1,
  }],
}
const communicationWorkbook = buildProjectWorkbook(communicationProject, [communicationTemplate], [l2], [], [l3])
const communicationSheet = communicationWorkbook.getWorksheet('紧急电话及广播')
assert.ok(communicationSheet)
const communicationPrintAreas = (communicationSheet as typeof communicationSheet & { __esiPrintAreas?: string[] }).__esiPrintAreas ?? []
assert.ok(communicationPrintAreas.some(area => /^A1:I\d+$/.test(area)))
assert.ok(communicationPrintAreas.some(area => /^J1:R\d+$/.test(area)))
assert.ok(communicationPrintAreas.some(area => /^S1:AA\d+$/.test(area)))
assert.ok(communicationPrintAreas.some(area => /^AB1:AJ\d+$/.test(area)))
assert.equal(communicationSheet.getCell(1, 1).value, '设施名称：紧急电话及广播')
assert.equal(communicationSheet.getCell(1, 10).value, '设施名称：紧急电话及广播')
assert.equal(communicationSheet.getCell(3, 13).value, '地点7')
assert.equal(communicationSheet.getCell(3, 22).value, '地点13')
assert.equal(communicationSheet.getCell(3, 31).value, '地点19')
communicationPrintAreas.forEach(area => {
  const match = area.match(/^[A-Z]+(\d+):[A-Z]+(\d+)$/)
  assert.ok(match)
  const startRow = Number(match[1])
  const endRow = Number(match[2])
  const areaHeight = Array.from({ length: endRow - startRow + 1 }, (_, offset) =>
    communicationSheet.getRow(startRow + offset).height ?? 15,
  ).reduce((sum, height) => sum + height, 0)
  assert.ok(
    areaHeight <= getUsablePageHeightPt() + 0.01,
    `紧急电话及广播打印区域 ${area} 高度 ${areaHeight} 超出 A4 可用高度`,
  )
})
const finalSegmentPrintAreas = communicationPrintAreas.filter(area => /^AB\d+:AJ\d+$/.test(area))
assert.ok(finalSegmentPrintAreas.length > 1, '回归样例必须让最后一个有效点位段拆成多页')
finalSegmentPrintAreas.forEach(area => {
  const startRow = Number(area.match(/^AB(\d+):/)?.[1])
  assert.equal(
    communicationSheet.getCell(startRow + 1, 36).value,
    '汇总列',
    '最后一个有效点位段拆成多页时，每个页块都必须保留汇总列',
  )
})
const communicationWorkbookWrite = writeWorkbookBuffer(communicationWorkbook)
  .then(buffer => fs.writeFile(regressionOutputDir + '/communication-left-right-regression.xlsx', new Uint8Array(buffer)))

const hydrantTemplate: L1Template = {
  ...l1('l1-hydrant', '消火栓及灭火器'),
  inspectionItems: Array.from({ length: 8 }, (_, index) => ({
    id: 'hydrant-item-' + index,
    groupId: 'hydrant-overall',
    groupName: '总体',
    requirement: '消火栓及灭火器检查要求 ' + (index + 1),
    inspectionMethod: '目测',
    validationType: 'text' as const,
    textOptions: ['符合', '不符合', '/'],
    rowHeight: 30,
  })),
}
const hydrantData = createInspectionData(
  hydrantTemplate,
  Array.from({ length: 6 }, (_, index) => '地点' + (index + 1)),
)
hydrantData.values = hydrantTemplate.inspectionItems.map(() => Array.from({ length: 6 }, () => '符合'))
hydrantData.faultValues = Array.from({ length: 6 }, () => '否')
const hydrantWorkbook = buildProjectWorkbook({
  ...project,
  id: 'project-hydrant',
  name: '消火栓布局回归',
  locationItems: [],
  subdivisions: [{
    l2TemplateId: l2.id,
    l2TemplateName: l2.name,
    selectedL1Ids: [hydrantTemplate.id],
    inspectionData: { [hydrantTemplate.id]: hydrantData },
    scoringData: {},
    summaryWeight: 1,
  }],
}, [hydrantTemplate], [l2], [], [l3])
const hydrantSheet = hydrantWorkbook.getWorksheet('消火栓及灭火器')
assert.ok(hydrantSheet)
const hydrantPrintAreas = (hydrantSheet as typeof hydrantSheet & { __esiPrintAreas?: string[] }).__esiPrintAreas ?? []
assert.match(hydrantPrintAreas[0] ?? '', /^A1:I\d+$/)
assert.equal(hydrantPrintAreas.length, 1, '正好 6 个地点时不得追加空汇总表或空备注页')
assert.equal(hydrantSheet.getCell(13, 9).value, '100.0%', '总完好率应写在最后一个真实结果槽')

const valveTemplate: L1Template = {
  ...l1('l1-valve', '阀门'),
  inspectionItems: [
    '外观检查，有无漏水、腐蚀',
    '操作试验是否正常',
    '导通试验',
    '保温装置的状况',
  ].map((requirement, index) => ({
    id: 'valve-item-' + index,
    groupId: 'valve-overall',
    groupName: '总体',
    requirement,
    inspectionMethod: '目测',
    validationType: 'text' as const,
    textOptions: ['符合', '不符合', '/'],
    rowHeight: 30,
  })),
}
const valveData = createInspectionData(
  valveTemplate,
  Array.from({ length: 36 }, (_, index) => index < 6 ? `右洞${index + 1}#` : `地点${index + 1}`),
)
valveData.values = valveTemplate.inspectionItems.map(() => Array.from({ length: 36 }, () => '符合'))
valveData.faultValues = Array.from({ length: 36 }, () => '否')
const valveWorkbook = buildProjectWorkbook({
  ...project,
  id: 'project-valve',
  name: '阀门备注回归',
  locationItems: [],
  subdivisions: [{
    l2TemplateId: l2.id,
    l2TemplateName: l2.name,
    selectedL1Ids: [valveTemplate.id],
    inspectionData: { [valveTemplate.id]: valveData },
    scoringData: {},
    summaryWeight: 1,
  }],
}, [valveTemplate], [l2], [], [l3])
const valveSheet = valveWorkbook.getWorksheet('阀门')
assert.ok(valveSheet)
const valvePrintAreas = (valveSheet as typeof valveSheet & { __esiPrintAreas?: string[] }).__esiPrintAreas ?? []
assert.deepEqual(valvePrintAreas, [
  'A1:I26', 'J1:R34',
])
const valveMerges = valveSheet.model.merges ?? []
const valveNotesMerge = valveMerges
  .map(range => range.match(/^[A-Z]+(\d+):[A-Z]+(\d+)$/))
  .filter((match): match is RegExpMatchArray => match !== null)
  .sort((left, right) => Number(right[2]) - Number(right[1]) - Number(left[2]) + Number(left[1]))[0]
assert.ok(valveNotesMerge, '备注应纵向合并多个正常高度的单元格')
const notesStartRow = Number(valveNotesMerge[1])
const notesEndRow = Number(valveNotesMerge[2])
for (let row = notesStartRow; row <= notesEndRow; row++) {
  assert.ok(
    (valveSheet.getRow(row).height ?? 15) <= L1_PRINT_LAYOUT.notesRowH,
    '备注填充不得通过单个超高行实现',
  )
}

const brightnessTemplate: L1Template = {
  ...l1('l1-brightness', '亮度检测器'),
  inspectionItems: [
    '外观有无污染、损伤',
    '设备功能是否正常',
    '测试指示值准确性检查',
  ].map((requirement, index) => ({
    id: 'brightness-item-' + index,
    groupId: 'brightness-overall',
    groupName: '总体',
    requirement,
    inspectionMethod: '目测',
    validationType: 'text' as const,
    textOptions: ['符合', '不符合', '/'],
    rowHeight: 30,
  })),
}
const brightnessData = createInspectionData(
  brightnessTemplate,
  Array.from({ length: 26 }, (_, index) => index < 6 ? `右洞${index + 1}#` : `地点${index + 1}`),
)
brightnessData.values = brightnessTemplate.inspectionItems.map(() => Array.from({ length: 26 }, () => '符合'))
brightnessData.faultValues = Array.from({ length: 26 }, () => '否')
const brightnessWorkbook = buildProjectWorkbook({
  ...project,
  id: 'project-brightness',
  name: '亮度布局回归',
  locationItems: [],
  subdivisions: [{
    l2TemplateId: l2.id,
    l2TemplateName: l2.name,
    selectedL1Ids: [brightnessTemplate.id],
    inspectionData: { [brightnessTemplate.id]: brightnessData },
    scoringData: {},
    summaryWeight: 1,
  }],
}, [brightnessTemplate], [l2], [], [l3])
const brightnessSheet = brightnessWorkbook.getWorksheet('亮度检测器')
assert.ok(brightnessSheet)
const brightnessPrintAreas = (brightnessSheet as typeof brightnessSheet & { __esiPrintAreas?: string[] }).__esiPrintAreas ?? []
assert.deepEqual(
  brightnessPrintAreas.slice(0, 1),
  ['A1:I23'],
  '右洞1-6与地点7-18应合并为同一张 A4 打印区域',
)
assert.equal(brightnessPrintAreas.length, 2, '地点19-26与末尾备注应共同填满右侧 A4 页')
assert.match(brightnessPrintAreas[1] ?? '', /^J1:R\d+$/)
const brightnessRightEndRow = Number((brightnessPrintAreas[1] ?? '').match(/R(\d+)$/)?.[1] ?? 0)
const brightnessRightHeight = Array.from({ length: brightnessRightEndRow }, (_, index) =>
  brightnessSheet.getRow(index + 1).height ?? 15,
).reduce((total, height) => total + height, 0)
assert.ok(brightnessRightHeight <= getUsablePageHeightPt(), '亮度检测器右侧合页不得超过 A4 可用高度')

const catalog = { l1Templates, l2Templates: [l2], l3Templates: [l3], deviceItems: [], projects: [project] }
const objectPackage = createObjectPackage('project', project.id, catalog)
const imported = prepareObjectPackageImport(objectPackage, 'project', catalog)
assert.notEqual(imported.catalog.projects[0].id, project.id)
assert.notEqual(imported.catalog.l1Templates.find(item => item.id === 'l1-a'), l1A)
assert.equal(imported.catalog.projects[0].subdivisions[0].selectedL1Ids.length, 4)
for (const [rootType, rootId] of [['l1', l1A.id], ['l2', l2.id], ['l3', l3.id]] as const) {
  const pkg = createObjectPackage(rootType, rootId, catalog)
  const copy = prepareObjectPackageImport(pkg, rootType, catalog)
  assert.ok(copy.count >= 1)
}
assert.throws(() => prepareObjectPackageImport({ ...objectPackage, rootType: 'l1' }, 'project', catalog))
assert.throws(() => prepareObjectPackageImport({
  ...objectPackage,
  data: { ...objectPackage.data, l1Templates: [] },
}, 'project', catalog))

void Promise.all([workbookWrite, longWorkbookWrite, wideWorkbookWrite, communicationWorkbookWrite])
  .then(() => console.log('template-order-grouping-regression: PASS'))
  .catch(error => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => fs.rm(regressionOutputDir, { recursive: true, force: true }))
