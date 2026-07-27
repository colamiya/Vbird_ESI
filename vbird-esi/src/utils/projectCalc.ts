import type { DeviceItem, Project, ProjectSubdivision, InspectionTableData } from '@/types'
import type { GradeThreshold, L1Template, L2Template, L3Template } from '@/types/template'
import { isEffectiveValue } from '@/utils/numericRule'
import { getOrderedL1Ids, getOrderedProjectSubdivisions } from '@/utils/projectOrder'

export interface ProjectCalcL1Row {
  l1Id: string
  name: string
  isCritical: boolean
  itemCount: number
  sourceL1Ids: string[]
  resultWeight: number
  totalCount: number
  faultCount: number
  passRate: string
  passRateValue: number | null
}

export interface ProjectCalcSubdivision {
  l2TemplateId: string
  name: string
  summaryWeight: number
  finalScore: number | null
  finalScoreDisplay: string
  totalCount: number
  faultCount: number
  passRate: string
  passRateValue: number | null
  l1Rows: ProjectCalcL1Row[]
}

export interface ProjectCalcPreview {
  totalCount: number
  faultCount: number
  passRate: string
  avgScore: number | null
  avgScoreDisplay: string
  weightedPassRateValue: number | null
  weightedPassRateDisplay: string
  overallGrade: string
  subdivisions: ProjectCalcSubdivision[]
}

export interface ProjectCalcOptions {
  getSubdivisionWeight?: (sub: ProjectSubdivision) => unknown
  l2Templates?: L2Template[]
  l3Template?: L3Template | null
}

export interface ResultListRow {
  subdivisionName: string
  l1Name: string
  totalCount: number
  faultCount: number
  passRate: string
  scaleGrade: string
  isCritical: boolean
}

export interface DeviceListRow {
  device: DeviceItem
  quantity: 1
  sourceL1Name: string
}

export function getDisplayL1Name(templateOrName: Pick<L1Template, 'name' | 'isCritical'> | string, isCritical = false): string {
  if (typeof templateOrName === 'string') return isCritical ? `${templateOrName}*` : templateOrName
  return templateOrName.isCritical ? `${templateOrName.name}*` : templateOrName.name
}

export function calcTotalPassRate(
  data: InspectionTableData,
  cpIndices: number[],
  _rowCount?: number,
): string {
  const { totalCount, faultCount } = countFaultStats(data, cpIndices)
  return calcRateFromCounts(totalCount, faultCount)
}

export function countValidCheckpoints(data: InspectionTableData, cpIndices: number[]): number {
  return countFaultStats(data, cpIndices).totalCount
}

export function countFaults(data: InspectionTableData, cpIndices: number[]): number {
  return countFaultStats(data, cpIndices).faultCount
}

export function countFaultStats(data: InspectionTableData, cpIndices: number[]): { totalCount: number; faultCount: number } {
  let totalCount = 0
  let faultCount = 0
  for (const idx of cpIndices) {
    const value = data.faultValues[idx]
    if (value === null || value === undefined || value === '' || value === '/') continue
    totalCount++
    if (value === '是') faultCount++
  }
  return { totalCount, faultCount }
}

export function calcSubdivisionScore(
  sub: ProjectSubdivision,
  l1Templates: L1Template[],
  l2Template?: L2Template,
): number | null {
  const rows = buildSubdivisionL1Rows(sub, l1Templates, l2Template)
  return calcWeightedCriticalScore(rows)
}

export function buildProjectCalcPreview(
  project: Project,
  l1Templates: L1Template[],
  options: ProjectCalcOptions = {},
): ProjectCalcPreview {
  let projectTotalCount = 0
  let projectFaultCount = 0
  const projectRows: ProjectCalcL1Row[] = []

  const subdivisions = getOrderedProjectSubdivisions(project, options.l3Template).map(sub => {
    const l2Template = options.l2Templates?.find(template => template.id === sub.l2TemplateId)
    const l1Rows = buildSubdivisionL1Rows(sub, l1Templates, l2Template)
    const subTotalCount = l1Rows.reduce((sum, row) => sum + row.totalCount, 0)
    const subFaultCount = l1Rows.reduce((sum, row) => sum + row.faultCount, 0)
    // 关键设备为全分部最低值时取其完好率，否则按总量/故障数计算整体完好率。
    const passRateValue = calcWeightedCriticalScore(l1Rows)
    const summaryWeight = normalizeWeight(options.getSubdivisionWeight?.(sub) ?? sub.summaryWeight)

    projectTotalCount += subTotalCount
    projectFaultCount += subFaultCount
    projectRows.push(...l1Rows)

    const finalScoreBase = calcWeightedCriticalScore(l1Rows)
    const totalDeduction = Object.values(sub.scoringData ?? {}).reduce((sum, value) => sum + (value ?? 0), 0)
    const finalScore = finalScoreBase !== null ? Math.max(0, finalScoreBase - totalDeduction) : null

    return {
      l2TemplateId: sub.l2TemplateId,
      name: sub.l2TemplateName || '(未命名分部)',
      summaryWeight,
      finalScore,
      finalScoreDisplay: finalScore !== null ? finalScore.toFixed(2) : '/',
      totalCount: subTotalCount,
      faultCount: subFaultCount,
      passRate: formatPercentValue(passRateValue),
      passRateValue,
      l1Rows,
    }
  })

  const avgScore = calcWeightedCriticalScore(projectRows)
  const weightedPassRateValue = calcWeightedSubdivisionPassRate(subdivisions)

  return {
    totalCount: projectTotalCount,
    faultCount: projectFaultCount,
    passRate: calcRateFromCounts(projectTotalCount, projectFaultCount),
    avgScore,
    avgScoreDisplay: avgScore !== null ? avgScore.toFixed(2) : '/',
    weightedPassRateValue,
    weightedPassRateDisplay: formatPercentValue(weightedPassRateValue),
    overallGrade: calcOverallGrade(avgScore),
    subdivisions,
  }
}

export function buildResultListRows(project: Project, l1Templates: L1Template[]): ResultListRow[] {
  return buildResultListRowsWithGrades(project, l1Templates)
}

export function buildResultListRowsWithGrades(
  project: Project,
  l1Templates: L1Template[],
  l2Templates: L2Template[] = [],
  l3Template?: L3Template | null,
): ResultListRow[] {
  const rows: ResultListRow[] = []
  const preview = buildProjectCalcPreview(project, l1Templates, { l2Templates, l3Template })
  for (const sub of preview.subdivisions) {
    const l2Template = l2Templates.find(template => template.id === sub.l2TemplateId)
    for (const row of sub.l1Rows) {
      rows.push({
        subdivisionName: sub.name,
        l1Name: row.name,
        totalCount: row.totalCount,
        faultCount: row.faultCount,
        passRate: row.passRate,
        scaleGrade: calcGradeByThresholds(row.passRateValue, l2Template?.scoring.gradeThresholds),
        isCritical: row.isCritical,
      })
    }
  }
  return rows
}

export function calcGradeByThresholds(
  score: number | null,
  thresholds: GradeThreshold[] | undefined,
): string {
  if (score === null) return '/'
  const sorted = (thresholds ?? [])
    .filter(item => item.label.trim())
    .slice()
    .sort((a, b) => b.minScore - a.minScore)
  if (sorted.length > 0) {
    const matched = sorted.find(item => score >= item.minScore)
    return matched?.label ?? sorted[sorted.length - 1].label
  }
  return score >= 85 ? '优良' : score >= 70 ? '合格' : '不合格'
}

export function buildDeviceListRows(
  project: Project,
  l1Templates: L1Template[],
  deviceItems: DeviceItem[],
  l2Templates: L2Template[] = [],
  l3Template?: L3Template | null,
): DeviceListRow[] {
  const deviceMap = new Map(deviceItems.map(item => [item.id, item]))
  const used = new Set<string>()
  const rows: DeviceListRow[] = []

  for (const sub of getOrderedProjectSubdivisions(project, l3Template)) {
    const l2Template = l2Templates.find(template => template.id === sub.l2TemplateId)
    for (const l1Id of getOrderedL1Ids(sub, l2Template)) {
      const template = l1Templates.find(t => t.id === l1Id)
      const data = sub.inspectionData[l1Id]
      if (!template || !data) continue

      template.inspectionItems.forEach((item, rowIdx) => {
        if (!item.deviceId || used.has(item.deviceId)) return
        const row = data.values[rowIdx] ?? []
        const hasValue = row.some(value => isEffectiveValue(value))
        if (!hasValue) return
        const device = deviceMap.get(item.deviceId)
        if (!device) return
        used.add(item.deviceId)
        rows.push({
          device,
          quantity: 1,
          sourceL1Name: getDisplayL1Name(template),
        })
      })
    }
  }

  return rows
}

export function buildSubdivisionL1Rows(
  sub: ProjectSubdivision,
  l1Templates: L1Template[],
  l2Template?: L2Template,
): ProjectCalcL1Row[] {
  const baseRows = getOrderedL1Ids(sub, l2Template).map(l1Id => {
    const l1Tpl = l1Templates.find(t => t.id === l1Id)
    const l1Data = sub.inspectionData[l1Id]
    const isCritical = l1Tpl?.isCritical ?? false
    const name = l1Tpl ? getDisplayL1Name(l1Tpl) : getDisplayL1Name(l1Data?.l1TemplateName ?? '(未知)', isCritical)
    const itemCount = l1Tpl?.inspectionItems.length ?? 0
    const resultWeight = normalizeWeight(l1Data?.resultWeight)

    if (!l1Data) {
      return {
        l1Id,
        name,
        isCritical,
        itemCount,
        sourceL1Ids: [l1Id],
        resultWeight,
        totalCount: 0,
        faultCount: 0,
        passRate: '/',
        passRateValue: null,
      }
    }

    const allCpIndices = l1Data.checkpoints.map((_, i) => i)
    const { totalCount, faultCount } = countFaultStats(l1Data, allCpIndices)
    const passRateValue = totalCount > 0 ? (1 - faultCount / totalCount) * 100 : null

    return {
      l1Id,
      name,
      isCritical,
      itemCount,
      sourceL1Ids: [l1Id],
      resultWeight,
      totalCount,
      faultCount,
      passRate: calcRateFromCounts(totalCount, faultCount),
      passRateValue,
    }
  })

  const groups = new Map<string, ProjectCalcL1Row[]>()
  for (const row of baseRows) {
    const source = sub.inspectionData[row.l1Id]
    const groupName = source?.resultGroupName?.trim()
    const key = groupName ? `group:${groupName}` : `single:${row.l1Id}`
    const list = groups.get(key) ?? []
    list.push(row)
    groups.set(key, list)
  }

  return [...groups.entries()].map(([key, rows]) => {
    if (rows.length === 1 && key.startsWith('single:')) return rows[0]
    const groupName = key.replace(/^group:/, '')
    const isCritical = rows.every(row => row.isCritical)
    const totalCount = rows.reduce((sum, row) => sum + row.totalCount, 0)
    const faultCount = rows.reduce((sum, row) => sum + row.faultCount, 0)
    const itemCount = rows.reduce((sum, row) => sum + row.itemCount, 0)
    const validRows = rows.filter(row => row.passRateValue !== null && row.resultWeight > 0)
    const weightTotal = validRows.reduce((sum, row) => sum + row.resultWeight, 0)
    const passRateValue = weightTotal > 0
      ? validRows.reduce((sum, row) => sum + row.passRateValue! * row.resultWeight, 0) / weightTotal
      : null
    return {
      l1Id: key,
      name: getDisplayL1Name(groupName || rows.map(row => row.name).join(' + '), isCritical),
      isCritical,
      itemCount,
      sourceL1Ids: rows.flatMap(row => row.sourceL1Ids),
      resultWeight: weightTotal || 1,
      totalCount,
      faultCount,
      passRate: formatPercentValue(passRateValue),
      passRateValue,
    }
  })
}

function calcWeightedCriticalScore(rows: ProjectCalcL1Row[]): number | null {
  const validRows = rows.filter(row => row.totalCount > 0 && row.passRateValue !== null)
  if (validRows.length === 0) return null

  const weighted = calcWeightedScore(validRows)
  const criticalRows = validRows.filter(row => row.isCritical)
  if (criticalRows.length === 0) return weighted

  const criticalMin = Math.min(...criticalRows.map(row => row.passRateValue!))
  const nonCriticalRows = validRows.filter(row => !row.isCritical)
  if (nonCriticalRows.length === 0) return criticalMin

  const nonCriticalMin = Math.min(...nonCriticalRows.map(row => row.passRateValue!))
  return criticalMin <= nonCriticalMin ? criticalMin : weighted
}

function calcWeightedScore(rows: ProjectCalcL1Row[]): number {
  const validRows = rows.filter(row => row.totalCount > 0 && row.passRateValue !== null)
  const totalCount = validRows.reduce((sum, row) => sum + row.totalCount, 0)
  if (totalCount <= 0) return 0
  return validRows.reduce((sum, row) => sum + row.passRateValue! * row.totalCount, 0) / totalCount
}

function calcRateFromCounts(totalCount: number, faultCount: number): string {
  if (totalCount <= 0) return '/'
  return ((1 - faultCount / totalCount) * 100).toFixed(1) + '%'
}

function calcWeightedSubdivisionPassRate(rows: ProjectCalcSubdivision[]): number | null {
  const validRows = rows.filter(row => row.passRateValue !== null && row.summaryWeight > 0)
  const weightTotal = validRows.reduce((sum, row) => sum + row.summaryWeight, 0)
  if (weightTotal <= 0) return null
  const weighted = validRows.reduce((sum, row) => sum + (row.passRateValue! * row.summaryWeight), 0)
  return weighted / weightTotal
}

function formatPercentValue(value: number | null): string {
  return value === null ? '/' : `${value.toFixed(1)}%`
}

function normalizeWeight(value: unknown): number {
  const num = Number(value)
  if (!Number.isFinite(num)) return 1
  return Math.max(0, num)
}

function calcOverallGrade(avgScore: number | null): string {
  if (avgScore === null) return '/'
  return avgScore >= 85 ? '优良' : avgScore >= 70 ? '合格' : '不合格'
}
