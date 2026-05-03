import type {
  Checkpoint,
  InspectionTableData,
  Project,
  ProjectLocationItem,
  ProjectSubdivision,
} from '@/types/project'
import type { L1Template, L2Template } from '@/types/template'
import { generateId } from '@/utils/id'

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
  return {
    l1TemplateId: template.id,
    l1TemplateName: template.name,
    locationItemId,
    checkpoints,
    values: template.inspectionItems.map(() => checkpoints.map(() => null)),
    faultValues: checkpoints.map(() => null),
    notes: '',
    segmentBreaks: [],
    rowBreaks: [],
  }
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
      })
    }
  }
  return items
}

export function findOrCreateSubdivision(
  project: Project,
  l2: Pick<L2Template, 'id' | 'name'>,
): ProjectSubdivision {
  let sub = project.subdivisions.find(s => s.l2TemplateId === l2.id)
  if (!sub) {
    sub = {
      l2TemplateId: l2.id,
      l2TemplateName: l2.name,
      selectedL1Ids: [],
      inspectionData: {},
      scoringData: {},
      summaryWeight: DEFAULT_SUBDIVISION_WEIGHT,
    }
    project.subdivisions.push(sub)
  }
  return sub
}

export function syncLocationItemToProject(
  project: Project,
  item: ProjectLocationItem,
  l1Template: L1Template,
): void {
  const sub = findOrCreateSubdivision(project, {
    id: item.l2TemplateId,
    name: item.l2TemplateName,
  })
  if (!sub.selectedL1Ids.includes(item.l1TemplateId)) {
    sub.selectedL1Ids.push(item.l1TemplateId)
  }
  const names = normalizeCheckpointNames(item.checkpointNames, item.quantity)
  item.checkpointNames = names
  item.quantity = names.length

  const existing = sub.inspectionData[item.l1TemplateId]
  if (existing) {
    existing.locationItemId = item.id
    existing.l1TemplateName = item.l1TemplateName
    applyCheckpointNamesToInspectionData(existing, names)
  } else {
    sub.inspectionData[item.l1TemplateId] = createInspectionData(l1Template, names, item.id)
  }
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
