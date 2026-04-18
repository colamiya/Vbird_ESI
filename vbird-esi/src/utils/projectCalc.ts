import type { Project, ProjectSubdivision, InspectionTableData } from '@/types/project'
import type { L1Template } from '@/types/template'

export interface ProjectCalcL1Row {
  l1Id: string
  name: string
  totalCount: number
  faultCount: number
  passRate: string
}

export interface ProjectCalcSubdivision {
  l2TemplateId: string
  name: string
  finalScore: number | null
  finalScoreDisplay: string
  totalCount: number
  faultCount: number
  passRate: string
  l1Rows: ProjectCalcL1Row[]
}

export interface ProjectCalcPreview {
  totalCount: number
  faultCount: number
  passRate: string
  avgScore: number | null
  avgScoreDisplay: string
  overallGrade: string
  subdivisions: ProjectCalcSubdivision[]
}

export function calcTotalPassRate(
  data: InspectionTableData,
  cpIndices: number[],
  _rowCount?: number,
): string {
  const validFaults = cpIndices
    .map(i => data.faultValues[i])
    .filter(v => v !== null && v !== undefined && v !== '' && v !== '/')

  if (validFaults.length === 0) return '/'

  const passed = validFaults.filter(v => v === '否').length
  return ((passed / validFaults.length) * 100).toFixed(1) + '%'
}

export function countValidCheckpoints(data: InspectionTableData, cpIndices: number[]): number {
  return cpIndices.filter(i => data.checkpoints[i] && data.checkpoints[i].name !== '/').length
}

export function countFaults(data: InspectionTableData, cpIndices: number[]): number {
  return cpIndices.filter(i => data.faultValues[i] === '是').length
}

export function calcSubdivisionScore(sub: ProjectSubdivision, l1Templates: L1Template[]): number | null {
  const rates: number[] = []

  for (const l1Id of sub.selectedL1Ids) {
    const l1Tpl = l1Templates.find(t => t.id === l1Id)
    const l1Data = sub.inspectionData[l1Id]
    if (!l1Tpl || !l1Data) continue

    const allCpIndices = l1Data.checkpoints.map((_, i) => i)
    const rateStr = calcTotalPassRate(l1Data, allCpIndices, l1Tpl.inspectionItems.length)
    const rateNum = parseRateToNumber(rateStr)
    if (rateNum !== null) rates.push(rateNum / 100)
  }

  if (rates.length === 0) return null
  return (rates.reduce((a, b) => a + b, 0) / rates.length) * 100
}

export function buildProjectCalcPreview(
  project: Project,
  l1Templates: L1Template[],
): ProjectCalcPreview {
  let projectTotalCount = 0
  let projectFaultCount = 0
  const finalScores: number[] = []

  const subdivisions = project.subdivisions.map(sub => {
    let subTotalCount = 0
    let subFaultCount = 0

    const l1Rows: ProjectCalcL1Row[] = sub.selectedL1Ids.map(l1Id => {
      const l1Tpl = l1Templates.find(t => t.id === l1Id)
      const l1Data = sub.inspectionData[l1Id]
      const name = l1Tpl?.name ?? l1Data?.l1TemplateName ?? '(未知)'

      if (!l1Tpl || !l1Data) {
        return {
          l1Id,
          name,
          totalCount: 0,
          faultCount: 0,
          passRate: '/',
        }
      }

      const allCpIndices = l1Data.checkpoints.map((_, i) => i)
      const totalCount = countValidCheckpoints(l1Data, allCpIndices)
      const faultCount = countFaults(l1Data, allCpIndices)
      const passRate = calcTotalPassRate(l1Data, allCpIndices, l1Tpl.inspectionItems.length)

      subTotalCount += totalCount
      subFaultCount += faultCount

      return {
        l1Id,
        name,
        totalCount,
        faultCount,
        passRate,
      }
    })

    projectTotalCount += subTotalCount
    projectFaultCount += subFaultCount

    const finalScoreBase = calcSubdivisionScore(sub, l1Templates)
    const totalDeduction = Object.values(sub.scoringData).reduce((sum, value) => sum + (value ?? 0), 0)
    const finalScore = finalScoreBase !== null ? finalScoreBase - totalDeduction : null
    if (finalScore !== null) finalScores.push(finalScore)

    return {
      l2TemplateId: sub.l2TemplateId,
      name: sub.l2TemplateName || '(未命名分部)',
      finalScore,
      finalScoreDisplay: finalScore !== null ? finalScore.toFixed(2) : '/',
      totalCount: subTotalCount,
      faultCount: subFaultCount,
      passRate: calcRateFromCounts(subTotalCount, subFaultCount),
      l1Rows,
    }
  })

  const avgScore = finalScores.length > 0
    ? finalScores.reduce((a, b) => a + b, 0) / finalScores.length
    : null

  return {
    totalCount: projectTotalCount,
    faultCount: projectFaultCount,
    passRate: calcRateFromCounts(projectTotalCount, projectFaultCount),
    avgScore,
    avgScoreDisplay: avgScore !== null ? avgScore.toFixed(2) : '/',
    overallGrade: calcOverallGrade(avgScore),
    subdivisions,
  }
}

function calcRateFromCounts(totalCount: number, faultCount: number): string {
  if (totalCount <= 0) return '/'
  return ((1 - faultCount / totalCount) * 100).toFixed(1) + '%'
}

function calcOverallGrade(avgScore: number | null): string {
  if (avgScore === null) return '/'
  return avgScore >= 85 ? '优良' : avgScore >= 70 ? '合格' : '不合格'
}

function parseRateToNumber(rate: string): number | null {
  if (rate === '/' || rate === '-') return null
  const n = parseFloat(rate)
  return Number.isNaN(n) ? null : n
}
