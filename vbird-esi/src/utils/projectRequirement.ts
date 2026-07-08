import type { Project, InspectionTableData, ProjectRequirementOverride } from '@/types/project'
import type { InspectionItem, L1Template } from '@/types/template'

export interface MissingProjectRequirement {
  subdivisionName: string
  l1Name: string
  rowIndex: number
  groupName: string
}

export function needsProjectRequirement(item: InspectionItem): boolean {
  return !`${item.requirement ?? ''}`.trim()
}

export function ensureRequirementOverrides(data: InspectionTableData, items: InspectionItem[]): void {
  if (!data.requirementOverrides) data.requirementOverrides = {}
  for (const item of items) {
    if (needsProjectRequirement(item) && data.requirementOverrides[item.id] === undefined) {
      data.requirementOverrides[item.id] = {
        requirement: '',
        validationType: item.validationType === 'numeric' ? 'numeric' : 'text',
        numericRule: item.numericRule,
        numericRange: item.numericRange,
      }
    }
  }
}

export function getRequirementOverride(data: InspectionTableData, item: InspectionItem): ProjectRequirementOverride {
  ensureRequirementOverrides(data, [item])
  const raw = data.requirementOverrides?.[item.id]
  if (typeof raw === 'string') {
    const override: ProjectRequirementOverride = {
      requirement: raw,
      validationType: item.validationType === 'numeric' ? 'numeric' : 'text',
      numericRule: item.numericRule,
      numericRange: item.numericRange,
    }
    data.requirementOverrides![item.id] = override
    return override
  }
  return raw ?? {
    requirement: '',
    validationType: item.validationType === 'numeric' ? 'numeric' : 'text',
    numericRule: item.numericRule,
    numericRange: item.numericRange,
  }
}

export function getEffectiveRequirement(
  item: InspectionItem,
  data?: Pick<InspectionTableData, 'requirementOverrides'>,
): string {
  const templateRequirement = `${item.requirement ?? ''}`.trim()
  if (templateRequirement) return templateRequirement
  const raw = data?.requirementOverrides?.[item.id]
  if (typeof raw === 'string') return raw.trim()
  return `${raw?.requirement ?? ''}`.trim()
}

export function buildEffectiveInspectionItems(
  template: L1Template,
  data?: InspectionTableData,
): InspectionItem[] {
  return template.inspectionItems.map(item => ({
    ...item,
    requirement: getEffectiveRequirement(item, data),
    ...(needsProjectRequirement(item) && data
      ? (() => {
          const override = getRequirementOverride(data, item)
          return {
            validationType: override.validationType ?? item.validationType,
            numericRule: override.numericRule,
            numericRange: override.numericRange,
            textOptions: override.validationType === 'numeric' ? undefined : item.textOptions,
          }
        })()
      : {}),
  }))
}

export function findMissingProjectRequirements(
  project: Project,
  l1Templates: L1Template[],
): MissingProjectRequirement[] {
  const missing: MissingProjectRequirement[] = []
  for (const sub of project.subdivisions ?? []) {
    for (const l1Id of sub.selectedL1Ids ?? []) {
      const template = l1Templates.find(t => t.id === l1Id)
      const data = sub.inspectionData?.[l1Id]
      if (!template || !data) continue
      ensureRequirementOverrides(data, template.inspectionItems)
      template.inspectionItems.forEach((item, idx) => {
        if (!needsProjectRequirement(item)) return
        if (getEffectiveRequirement(item, data)) return
        missing.push({
          subdivisionName: sub.l2TemplateName || '未命名分部',
          l1Name: data.l1TemplateName || template.name,
          rowIndex: idx + 1,
          groupName: item.groupName || `第 ${idx + 1} 行`,
        })
      })
    }
  }
  return missing
}

export function formatMissingProjectRequirements(missing: MissingProjectRequirement[], limit = 8): string {
  const lines = missing.slice(0, limit).map(item =>
    `${item.subdivisionName} / ${item.l1Name} / 第 ${item.rowIndex} 行 ${item.groupName}`,
  )
  const rest = missing.length - lines.length
  return rest > 0 ? `${lines.join('\n')}\n另有 ${rest} 项未填写` : lines.join('\n')
}
