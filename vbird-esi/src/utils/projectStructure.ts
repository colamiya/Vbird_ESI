import type {
  Checkpoint,
  InspectionTableData,
  Project,
  ProjectLocationItem,
  ProjectSubdivision,
} from '@/types/project'
import type { L1Template, L2Template, L3SubdivisionWeight, L3Template } from '@/types/template'
import { generateId } from '@/utils/id'
import { ensureRequirementOverrides } from '@/utils/projectRequirement'
import { getOrderedL1Ids } from '@/utils/projectOrder'

export const PROJECT_DATA_VERSION = 3
export const DEFAULT_SUBDIVISION_WEIGHT = 1

export function defaultCheckpointNames(quantity: number): string[] {
  return Array.from({ length: Math.max(0, quantity) }, (_, idx) => `地点${idx + 1}`)
}

export function normalizeCheckpointNames(names: string[], quantity: number): string[] {
  const defaults = defaultCheckpointNames(quantity)
  return Array.from({ length: Math.max(0, quantity) }, (_, idx) => {
    const name = `${names[idx] ?? ''}`.trim()
    return name || defaults[idx]
  })
}

export function createInspectionData(
  template: L1Template,
  checkpointNames: string[],
  locationItemId?: string,
): InspectionTableData {
  const checkpoints: Checkpoint[] = checkpointNames.map(name => ({ id: generateId(), name }))
  const data: InspectionTableData = {
    l1TemplateId: template.id,
    l1TemplateName: template.name,
    locationItemId,
    checkpoints,
    values: template.inspectionItems.map(() => checkpoints.map(() => null)),
    requirementOverrides: {},
    manualJudgements: {},
    faultValues: checkpoints.map(() => null),
    notes: '',
    segmentBreaks: [],
    rowBreaks: [],
    resultGroupName: template.resultGroupName?.trim() || undefined,
    resultWeight: normalizeSubdivisionWeight(template.resultWeight),
  }
  ensureRequirementOverrides(data, template.inspectionItems)
  return data
}

export function applyCheckpointNamesToInspectionData(
  data: InspectionTableData,
  names: string[],
): void {
  const normalized = normalizeCheckpointNames(names, names.length)
  while (data.checkpoints.length < normalized.length) {
    data.checkpoints.push({ id: generateId(), name: `地点${data.checkpoints.length + 1}` })
    data.values.forEach(row => row.push(null))
    data.faultValues.push(null)
  }
  while (data.checkpoints.length > normalized.length) {
    data.checkpoints.pop()
    data.values.forEach(row => row.pop())
    data.faultValues.pop()
  }
  normalized.forEach((name, idx) => {
    data.checkpoints[idx].name = name
  })
  data.segmentBreaks = []
  data.segmentLayout = undefined
}

export function hasDataBeyondQuantity(data: InspectionTableData, quantity: number): boolean {
  for (let col = quantity; col < data.checkpoints.length; col++) {
    if (data.faultValues[col]) return true
    if (data.values.some(row => row[col] !== null && row[col] !== undefined && row[col] !== '')) return true
  }
  return false
}

export function ensureProjectLocationItems(project: Project): Project {
  project.dataVersion = PROJECT_DATA_VERSION
  for (const sub of project.subdivisions ?? []) {
    sub.summaryWeight = normalizeSubdivisionWeight(sub.summaryWeight)
    for (const data of Object.values(sub.inspectionData ?? {})) {
      if (!data.requirementOverrides) data.requirementOverrides = {}
      if (!data.manualJudgements) data.manualJudgements = {}
      data.resultWeight = normalizeSubdivisionWeight(data.resultWeight)
      data.resultGroupName = data.resultGroupName?.trim() || undefined
    }
  }
  if (!project.locationItems) {
    project.locationItems = inferLocationItemsFromProject(project)
  }
  return project
}

export function normalizeSubdivisionWeight(value: unknown): number {
  const num = Number(value)
  if (!Number.isFinite(num)) return DEFAULT_SUBDIVISION_WEIGHT
  return Math.max(0, num)
}

export function normalizeL3SubdivisionWeights(
  l3: Pick<L3Template, 'availableL2Ids' | 'subdivisionWeights'>,
): L3SubdivisionWeight[] {
  const savedWeights = new Map<string, number>()
  for (const item of l3.subdivisionWeights ?? []) {
    savedWeights.set(item.l2TemplateId, normalizeSubdivisionWeight(item.weight))
  }
  return l3.availableL2Ids.map(l2TemplateId => ({
    l2TemplateId,
    weight: savedWeights.get(l2TemplateId) ?? DEFAULT_SUBDIVISION_WEIGHT,
  }))
}

export function getL3SubdivisionWeight(
  l3: Pick<L3Template, 'subdivisionWeights'> | null | undefined,
  l2TemplateId: string,
): number {
  const item = l3?.subdivisionWeights?.find(row => row.l2TemplateId === l2TemplateId)
  return normalizeSubdivisionWeight(item?.weight)
}

export function inferLocationItemsFromProject(project: Project): ProjectLocationItem[] {
  const items: ProjectLocationItem[] = []
  for (const sub of project.subdivisions ?? []) {
    for (const l1Id of sub.selectedL1Ids ?? []) {
      const data = sub.inspectionData?.[l1Id]
      const names = data?.checkpoints?.map(cp => cp.name) ?? []
      const id = data?.locationItemId || generateId()
      if (data) data.locationItemId = id
      items.push({
        id,
        l2TemplateId: sub.l2TemplateId,
        l2TemplateName: sub.l2TemplateName,
        l1TemplateId: l1Id,
        l1TemplateName: data?.l1TemplateName ?? l1Id,
        unit: '',
        quantity: names.length,
        checkpointNames: names.length > 0 ? names : defaultCheckpointNames(0),
        resultGroupName: data?.resultGroupName,
        resultWeight: normalizeSubdivisionWeight(data?.resultWeight),
      })
    }
  }
  return items
}

export function findOrCreateSubdivision(
  project: Project,
  l2: Pick<L2Template, 'id' | 'name'>,
  summaryWeight = DEFAULT_SUBDIVISION_WEIGHT,
): ProjectSubdivision {
  let sub = project.subdivisions.find(s => s.l2TemplateId === l2.id)
  if (!sub) {
    sub = {
      l2TemplateId: l2.id,
      l2TemplateName: l2.name,
      selectedL1Ids: [],
      inspectionData: {},
      scoringData: {},
      summaryWeight: normalizeSubdivisionWeight(summaryWeight),
    }
    project.subdivisions.push(sub)
  }
  return sub
}

export function syncLocationItemToProject(
  project: Project,
  item: ProjectLocationItem,
  l1Template: L1Template,
  summaryWeight = DEFAULT_SUBDIVISION_WEIGHT,
  l2Template?: Pick<L2Template, 'availableL1Ids'>,
): void {
  const sub = findOrCreateSubdivision(project, {
    id: item.l2TemplateId,
    name: item.l2TemplateName,
  }, summaryWeight)
  if (!sub.selectedL1Ids.includes(item.l1TemplateId)) {
    sub.selectedL1Ids.push(item.l1TemplateId)
  }
  sub.selectedL1Ids = getOrderedL1Ids(sub, l2Template)
  const names = normalizeCheckpointNames(item.checkpointNames, item.quantity)
  item.checkpointNames = names
  item.quantity = names.length

  const existing = sub.inspectionData[item.l1TemplateId]
  if (existing) {
    existing.locationItemId = item.id
    existing.l1TemplateName = item.l1TemplateName
    existing.resultGroupName = item.resultGroupName?.trim() || undefined
    existing.resultWeight = normalizeSubdivisionWeight(item.resultWeight)
    applyCheckpointNamesToInspectionData(existing, names)
  } else {
    const data = createInspectionData(l1Template, names, item.id)
    data.resultGroupName = item.resultGroupName?.trim() || data.resultGroupName
    data.resultWeight = item.resultWeight === undefined
      ? data.resultWeight
      : normalizeSubdivisionWeight(item.resultWeight)
    sub.inspectionData[item.l1TemplateId] = data
  }
}

/** 将 L1 录入页直接修改的检查点列回写到项目级点位清单。 */
export function syncInspectionDataToLocationItem(
  project: Project,
  subdivision: Pick<ProjectSubdivision, 'l2TemplateId'>,
  data: InspectionTableData,
): ProjectLocationItem | undefined {
  const item = (project.locationItems ?? []).find(row =>
    row.id === data.locationItemId || (
      row.l2TemplateId === subdivision.l2TemplateId &&
      row.l1TemplateId === data.l1TemplateId
    ),
  )
  if (!item) return undefined

  data.locationItemId = item.id
  item.l1TemplateName = data.l1TemplateName
  item.checkpointNames = data.checkpoints.map(checkpoint => checkpoint.name)
  item.quantity = item.checkpointNames.length
  item.resultGroupName = data.resultGroupName?.trim() || undefined
  item.resultWeight = normalizeSubdivisionWeight(data.resultWeight)
  return item
}

export function removeLocationItemFromProject(project: Project, item: ProjectLocationItem): void {
  project.locationItems = (project.locationItems ?? []).filter(row => row.id !== item.id)
  const sub = project.subdivisions.find(s => s.l2TemplateId === item.l2TemplateId)
  if (!sub) return
  sub.selectedL1Ids = sub.selectedL1Ids.filter(id => id !== item.l1TemplateId)
  delete sub.inspectionData[item.l1TemplateId]
  if (sub.selectedL1Ids.length === 0) {
    project.subdivisions = project.subdivisions.filter(s => s !== sub)
  }
}
