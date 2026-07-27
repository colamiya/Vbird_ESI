import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { L1Template, L2Template, L3Template, Project } from '@/types'
import { buildProjectWorkbook, writeWorkbookBuffer } from '@/utils/excelExport'
import { buildProjectCalcPreview } from '@/utils/projectCalc'
import { createInspectionData, syncInspectionDataToLocationItem } from '@/utils/projectStructure'

const now = '2026-07-12T00:00:00.000Z'
const outputDir = path.resolve('.tmp-full-flow-qa')
const outputFile = path.join(outputDir, 'ESI-全流程模拟验收.xlsx')

function l1(id: string, name: string, isCritical = false, resultWeight = 1): L1Template {
  return {
    id,
    name,
    facilityName: name,
    isCritical,
    resultGroupName: isCritical ? '火灾报警设施' : undefined,
    resultWeight,
    createdAt: now,
    updatedAt: now,
    columns: { fixedColumns: [], dataColumnWidth: 90, summaryColumnWidth: 100 },
    inspectionItems: [{
      id: `${id}-item`,
      groupId: `${id}-group`,
      groupName: '总体检查',
      requirement: '设备外观完整、功能正常，符合相关技术要求。',
      inspectionMethod: '目测、操作试验',
      validationType: 'text',
      textOptions: ['符合', '不符合', '/'],
      rowHeight: 30,
    }],
    faultRow: { enabled: true, label: name },
    styles: { mergeRules: [], defaultRowHeight: 30, headerRowHeight: 40, borderStyle: 'thin' },
  }
}

function dataFor(template: L1Template, names: string[], faults: Array<'是' | '否'>, locationItemId: string) {
  const data = createInspectionData(template, names, locationItemId)
  data.values[0] = names.map(() => '符合')
  data.faultValues = faults
  data.resultGroupName = template.resultGroupName
  data.resultWeight = template.resultWeight
  return data
}

function findFirstRow(
  sheet: NonNullable<ReturnType<ReturnType<typeof buildProjectWorkbook>['getWorksheet']>>,
  column: number,
  value: string,
): number {
  if (!sheet) return 0
  for (let row = 1; row <= sheet.rowCount; row++) {
    if (sheet.getCell(row, column).value === value) return row
  }
  return 0
}

const manualButton = l1('l1-manual-button', '手动火灾报警按钮', true, 1)
const autoAlarm = l1('l1-auto-alarm', '自动火灾报警设施', true, 2)
const controller = l1('l1-controller', '火灾报警控制器', true, 1)
const ordinary = l1('l1-ordinary', '一般照明设备')
const l1Templates = [manualButton, autoAlarm, controller, ordinary]

const l2: L2Template = {
  id: 'l2-fire',
  name: '消防设施',
  createdAt: now,
  updatedAt: now,
  availableL1Ids: l1Templates.map(template => template.id),
  headerInfo: { title: '分部工程质量检验评定表', fields: { companyName: '', subdivisionName: '', implementUnit: '', ownerUnit: '', supervisorUnit: '' } },
  scoring: { deductionItems: [], gradeThresholds: [{ label: '优良', minScore: 85 }, { label: '合格', minScore: 70 }, { label: '不合格', minScore: 0 }] },
}

const l3: L3Template = {
  id: 'l3-qa',
  name: '全流程模拟总表',
  createdAt: now,
  updatedAt: now,
  availableL2Ids: [l2.id],
  subdivisionWeights: [{ l2TemplateId: l2.id, weight: 1 }],
  headerInfo: { title: '检查结果计算表', fields: { companyName: '', projectName: '' } },
  styles: { mergeRules: [], defaultRowHeight: 30, headerRowHeight: 40, borderStyle: 'thin' },
}

const buttonData = dataFor(manualButton, ['东洞1', '东洞2', '东洞3'], ['否', '否', '否'], 'loc-button')
const autoData = dataFor(autoAlarm, ['东洞4', '东洞5', '东洞6', '东洞7'], ['是', '否', '否', '否'], 'loc-auto')
const controllerData = dataFor(controller, ['控制器1', '控制器2'], ['否', '否'], 'loc-controller')
const ordinaryData = dataFor(ordinary, ['照明1', '照明2', '照明3', '照明4', '照明5'], ['否', '否', '否', '否', '否'], 'loc-ordinary')

const project: Project = {
  id: 'project-full-flow-qa',
  name: '全流程模拟验收项目',
  createdAt: now,
  updatedAt: now,
  l3TemplateId: l3.id,
  info: { companyName: 'ESI 模拟检查公司', ownerUnit: '建设单位', implementUnit: '实施单位', supervisorUnit: '监理单位' },
  locationItems: [
    [manualButton, buttonData, 'loc-button'],
    [autoAlarm, autoData, 'loc-auto'],
    [controller, controllerData, 'loc-controller'],
    [ordinary, ordinaryData, 'loc-ordinary'],
  ].map(([template, data, id]) => ({
    id: id as string,
    l2TemplateId: l2.id,
    l2TemplateName: l2.name,
    l1TemplateId: (template as L1Template).id,
    l1TemplateName: (data as typeof buttonData).l1TemplateName,
    unit: '台',
    quantity: (data as typeof buttonData).checkpoints.length,
    checkpointNames: (data as typeof buttonData).checkpoints.map(checkpoint => checkpoint.name),
    resultGroupName: (data as typeof buttonData).resultGroupName,
    resultWeight: (data as typeof buttonData).resultWeight,
  })),
  subdivisions: [{
    l2TemplateId: l2.id,
    l2TemplateName: l2.name,
    selectedL1Ids: l1Templates.map(template => template.id),
    inspectionData: {
      [manualButton.id]: buttonData,
      [autoAlarm.id]: autoData,
      [controller.id]: controllerData,
      [ordinary.id]: ordinaryData,
    },
    scoringData: {},
    summaryWeight: 1,
  }],
}

// 模拟 L1 录入页的新增、改名、删除检查点，并在每一步验证点位清单同步。
buttonData.checkpoints.push({ id: 'added-1', name: '东洞4-临时' })
buttonData.values.forEach(row => row.push('符合'))
buttonData.faultValues.push('否')
syncInspectionDataToLocationItem(project, project.subdivisions[0], buttonData)
assert.equal(project.locationItems[0].quantity, 4)
assert.deepEqual(project.locationItems[0].checkpointNames, ['东洞1', '东洞2', '东洞3', '东洞4-临时'])

buttonData.checkpoints[0].name = '东洞1-复核'
buttonData.checkpoints.splice(3, 1)
buttonData.values.forEach(row => row.splice(3, 1))
buttonData.faultValues.splice(3, 1)
syncInspectionDataToLocationItem(project, project.subdivisions[0], buttonData)
assert.equal(project.locationItems[0].quantity, 3)
assert.deepEqual(project.locationItems[0].checkpointNames, ['东洞1-复核', '东洞2', '东洞3'])

buttonData.checkpoints.push({ id: 'added-2', name: '东洞4' })
buttonData.values.forEach(row => row.push('符合'))
buttonData.faultValues.push('否')
syncInspectionDataToLocationItem(project, project.subdivisions[0], buttonData)
assert.equal(project.locationItems[0].quantity, 4)

const preview = buildProjectCalcPreview(project, l1Templates, { l2Templates: [l2], l3Template: l3 })
const subdivision = preview.subdivisions[0]
assert.equal(subdivision.totalCount, 15)
assert.equal(subdivision.faultCount, 1)
assert.equal(subdivision.l1Rows[0].name, '火灾报警设施*')
assert.equal(subdivision.l1Rows[0].passRate, '87.5%')
assert.equal(subdivision.passRate, '87.5%')

const workbook = buildProjectWorkbook(project, l1Templates, [l2], [], [l3])
const resultSheet = workbook.getWorksheet('结果清单')
const locationSheet = workbook.getWorksheet('点位清单表')
const inspectionSheet = workbook.getWorksheet('检查体系结构')
const calcSheet = workbook.getWorksheet('检查结果计算表')
const l1Sheet = workbook.getWorksheet('手动火灾报警按钮')
assert.ok(resultSheet && locationSheet && inspectionSheet && calcSheet && l1Sheet)

assert.equal(resultSheet.getCell('C4').value, '火灾报警设施*')
assert.equal(resultSheet.getCell('D4').value, 10)
assert.equal(resultSheet.getCell('E4').value, 1)
assert.equal(resultSheet.getCell('F4').value, '87.5%')
assert.equal(resultSheet.getCell('D4').fill.fgColor?.argb, 'FFFFFF00')
assert.equal(resultSheet.getCell('C4').border.bottom?.style, 'thin')
assert.equal(locationSheet.getCell('B5').value, '火灾报警设施*')
assert.equal(locationSheet.getCell('D5').value, 10)
assert.equal(inspectionSheet.getCell('B5').value, '火灾报警设施*')

const subtotalRow = findFirstRow(calcSheet, 1, '合计')
assert.ok(subtotalRow > 0)
assert.equal(calcSheet.getCell(subtotalRow, 3).value, 15)
assert.equal(calcSheet.getCell(subtotalRow, 4).value, 1)
assert.equal(calcSheet.getCell(subtotalRow, 6).value, '87.5%')
assert.equal(resultSheet.pageSetup.orientation, 'landscape')
assert.equal(l1Sheet.pageSetup.orientation, 'portrait')
assert.ok((l1Sheet as typeof l1Sheet & { __esiPrintAreas?: string[] }).__esiPrintAreas?.length)

await fs.mkdir(outputDir, { recursive: true })
await fs.writeFile(outputFile, Buffer.from(await writeWorkbookBuffer(workbook)))
console.log(JSON.stringify({ outputFile, sheetNames: workbook.worksheets.map(sheet => sheet.name), l1PrintAreas: (l1Sheet as typeof l1Sheet & { __esiPrintAreas?: string[] }).__esiPrintAreas }))
