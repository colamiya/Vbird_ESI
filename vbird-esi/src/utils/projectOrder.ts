import type { L2Template, L3Template } from '@/types/template'
import type { Project, ProjectLocationItem, ProjectSubdivision } from '@/types/project'

/** 将模板关联数组作为唯一顺序来源；旧数据或已删除引用稳定排在末尾。 */
export function sortByReferenceOrder<T>(
  items: T[],
  getId: (item: T) => string,
  referenceIds: string[] | undefined,
): T[] {
  if (!referenceIds?.length) return [...items]
  const index = new Map(referenceIds.map((id, position) => [id, position]))
  return items
    .map((item, originalIndex) => ({ item, originalIndex }))
    .sort((left, right) => {
      const leftRank = index.get(getId(left.item)) ?? Number.MAX_SAFE_INTEGER
      const rightRank = index.get(getId(right.item)) ?? Number.MAX_SAFE_INTEGER
      return leftRank - rightRank || left.originalIndex - right.originalIndex
    })
    .map(entry => entry.item)
}

export function getOrderedProjectSubdivisions(
  project: Project,
  l3Template?: Pick<L3Template, 'availableL2Ids'> | null,
): ProjectSubdivision[] {
  return sortByReferenceOrder(project.subdivisions ?? [], sub => sub.l2TemplateId, l3Template?.availableL2Ids)
}

export function getOrderedL1Ids(
  sub: ProjectSubdivision,
  l2Template?: Pick<L2Template, 'availableL1Ids'> | null,
): string[] {
  return sortByReferenceOrder(sub.selectedL1Ids ?? [], id => id, l2Template?.availableL1Ids)
}

export function getOrderedLocationItems(
  project: Project,
  l2Templates: L2Template[],
  l3Template?: Pick<L3Template, 'availableL2Ids'> | null,
): ProjectLocationItem[] {
  const locationItems = project.locationItems ?? []
  const byKey = new Map(locationItems.map(item => [`${item.l2TemplateId}:${item.l1TemplateId}`, item]))
  const usedIds = new Set<string>()
  const ordered: ProjectLocationItem[] = []

  for (const sub of getOrderedProjectSubdivisions(project, l3Template)) {
    const l2 = l2Templates.find(template => template.id === sub.l2TemplateId)
    for (const l1Id of getOrderedL1Ids(sub, l2)) {
      const item = byKey.get(`${sub.l2TemplateId}:${l1Id}`)
      if (!item) continue
      ordered.push(item)
      usedIds.add(item.id)
    }
  }

  return ordered.concat(locationItems.filter(item => !usedIds.has(item.id)))
}
