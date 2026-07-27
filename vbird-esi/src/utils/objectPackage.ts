import { open, save } from '@tauri-apps/plugin-dialog'
import type { DeviceItem, L1Template, L2Template, L3Template, Project } from '@/types'
import { generateId } from '@/utils/id'
import { deleteData, readJsonFile, saveData, STORAGE_DIRS, writeJsonFile } from '@/utils/storage'
import { ensureProjectLocationItems } from '@/utils/projectStructure'

export type ObjectPackageRootType = 'project' | 'l1' | 'l2' | 'l3'

export interface ObjectPackageCatalog {
  l1Templates: L1Template[]
  l2Templates: L2Template[]
  l3Templates: L3Template[]
  deviceItems: DeviceItem[]
  projects: Project[]
}

export interface ObjectPackage {
  app: 'vbird-esi'
  packageVersion: 1
  rootType: ObjectPackageRootType
  exportedAt: string
  data: ObjectPackageCatalog & {
    rootId: string
  }
}

export interface ObjectPackageImportResult {
  rootType: ObjectPackageRootType
  rootName: string
  importedCount: number
}

const EMPTY_CATALOG: ObjectPackageCatalog = {
  l1Templates: [], l2Templates: [], l3Templates: [], deviceItems: [], projects: [],
}

export async function exportObjectPackage(
  rootType: ObjectPackageRootType,
  rootId: string,
  catalog: ObjectPackageCatalog,
): Promise<string | null> {
  const pkg = createObjectPackage(rootType, rootId, catalog)
  const filePath = await save({
    title: `导出${getRootLabel(rootType)}对象包`,
    defaultPath: `ESI-${rootType}-${getRootName(pkg, rootType)}-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'ESI 对象包', extensions: ['json'] }],
  })
  if (!filePath) return null
  await writeJsonFile(filePath, pkg)
  return filePath
}

export async function importObjectPackage(
  expectedRootType: ObjectPackageRootType,
  catalog: ObjectPackageCatalog,
): Promise<ObjectPackageImportResult | null> {
  const selected = await open({
    title: `导入${getRootLabel(expectedRootType)}对象包`,
    multiple: false,
    filters: [{ name: 'ESI 对象包', extensions: ['json'] }],
  })
  if (!selected || Array.isArray(selected)) return null

  const pkg = await readJsonFile<unknown>(selected)
  const imported = prepareObjectPackageImport(pkg, expectedRootType, catalog)
  await persistImportedCatalog(imported.catalog)
  return {
    rootType: expectedRootType,
    rootName: imported.rootName,
    importedCount: imported.count,
  }
}

export function createObjectPackage(
  rootType: ObjectPackageRootType,
  rootId: string,
  catalog: ObjectPackageCatalog,
): ObjectPackage {
  const source = clone(catalog)
  const root = getRoot(source, rootType, rootId)
  if (!root) throw new Error(`找不到待导出的${getRootLabel(rootType)}`)

  const l1Ids = new Set<string>()
  const l2Ids = new Set<string>()
  const l3Ids = new Set<string>()
  const projectIds = new Set<string>()

  if (rootType === 'l1') l1Ids.add(rootId)
  if (rootType === 'l2') l2Ids.add(rootId)
  if (rootType === 'l3') l3Ids.add(rootId)
  if (rootType === 'project') {
    projectIds.add(rootId)
    const project = root as Project
    if (project.l3TemplateId) l3Ids.add(project.l3TemplateId)
    project.subdivisions.forEach(sub => {
      l2Ids.add(sub.l2TemplateId)
      sub.selectedL1Ids.forEach(id => l1Ids.add(id))
    })
  }

  expandDependencies(source, l3Ids, l2Ids, l1Ids)
  const deviceIds = new Set<string>()
  source.l1Templates.filter(item => l1Ids.has(item.id)).forEach(template => {
    template.inspectionItems.forEach(item => { if (item.deviceId) deviceIds.add(item.deviceId) })
  })

  return {
    app: 'vbird-esi',
    packageVersion: 1,
    rootType,
    exportedAt: new Date().toISOString(),
    data: {
      rootId,
      l1Templates: source.l1Templates.filter(item => l1Ids.has(item.id)),
      l2Templates: source.l2Templates.filter(item => l2Ids.has(item.id)),
      l3Templates: source.l3Templates.filter(item => l3Ids.has(item.id)),
      deviceItems: source.deviceItems.filter(item => deviceIds.has(item.id)),
      projects: source.projects.filter(item => projectIds.has(item.id)).map(project => ensureProjectLocationItems(project)),
    },
  }
}

export function prepareObjectPackageImport(
  rawPackage: unknown,
  expectedRootType: ObjectPackageRootType,
  existing: ObjectPackageCatalog,
): { catalog: ObjectPackageCatalog; rootName: string; count: number } {
  const pkg = validateObjectPackage(rawPackage, expectedRootType)
  validateDependencyClosure(pkg)
  const imported = clone({
    l1Templates: pkg.data.l1Templates,
    l2Templates: pkg.data.l2Templates,
    l3Templates: pkg.data.l3Templates,
    deviceItems: pkg.data.deviceItems,
    projects: pkg.data.projects,
  })
  const idMaps = createIdMaps(imported, existing)
  rewriteReferences(imported, idMaps)
  appendImportNames(imported, existing)

  const root = getRoot(imported, expectedRootType, idMaps[expectedRootType].get(pkg.data.rootId) ?? pkg.data.rootId)
  if (!root) throw new Error('对象包根对象重映射失败')
  const count = imported.l1Templates.length + imported.l2Templates.length + imported.l3Templates.length + imported.deviceItems.length + imported.projects.length
  return { catalog: imported, rootName: getEntityName(root), count }
}

function validateObjectPackage(rawPackage: unknown, expectedRootType: ObjectPackageRootType): ObjectPackage {
  if (!rawPackage || typeof rawPackage !== 'object') throw new Error('对象包不是有效 JSON 对象')
  const pkg = rawPackage as Partial<ObjectPackage>
  if (pkg.app !== 'vbird-esi' || pkg.packageVersion !== 1) throw new Error('对象包格式不正确或版本不兼容')
  if (pkg.rootType !== expectedRootType) throw new Error(`该对象包类型为 ${pkg.rootType ?? '未知'}，不能导入到${getRootLabel(expectedRootType)}区域`)
  if (!pkg.data || typeof pkg.data !== 'object' || typeof pkg.data.rootId !== 'string') throw new Error('对象包缺少根对象数据')
  const data = pkg.data as Partial<ObjectPackage['data']>
  for (const key of ['l1Templates', 'l2Templates', 'l3Templates', 'deviceItems', 'projects'] as const) {
    if (!Array.isArray(data[key])) throw new Error(`对象包字段 ${key} 格式不正确`)
  }
  const normalized = pkg as ObjectPackage
  if (!getRoot(normalized.data, expectedRootType, normalized.data.rootId)) throw new Error('对象包根对象不存在')
  return normalized
}

function validateDependencyClosure(pkg: ObjectPackage): void {
  const l1Ids = new Set(pkg.data.l1Templates.map(item => item.id))
  const l2Ids = new Set(pkg.data.l2Templates.map(item => item.id))
  const l3Ids = new Set(pkg.data.l3Templates.map(item => item.id))
  const deviceIds = new Set(pkg.data.deviceItems.map(item => item.id))

  pkg.data.l1Templates.forEach(template => template.inspectionItems.forEach(item => {
    if (item.deviceId && !deviceIds.has(item.deviceId)) throw new Error(`L1 模板「${template.name}」缺少关联设备`)
  }))
  pkg.data.l2Templates.forEach(template => template.availableL1Ids.forEach(id => {
    if (!l1Ids.has(id)) throw new Error(`L2 模板「${template.name}」缺少关联 L1 模板`)
  }))
  pkg.data.l3Templates.forEach(template => template.availableL2Ids.forEach(id => {
    if (!l2Ids.has(id)) throw new Error(`L3 模板「${template.name}」缺少关联 L2 模板`)
  }))
  pkg.data.projects.forEach(project => {
    if (project.l3TemplateId && !l3Ids.has(project.l3TemplateId)) throw new Error(`项目「${project.name}」缺少关联 L3 模板`)
    project.subdivisions.forEach(sub => {
      if (!l2Ids.has(sub.l2TemplateId)) throw new Error(`项目「${project.name}」缺少分部模板`)
      sub.selectedL1Ids.forEach(id => {
        if (!l1Ids.has(id)) throw new Error(`项目「${project.name}」缺少点检模板`)
      })
    })
  })
}

function createIdMaps(imported: ObjectPackageCatalog, existing: ObjectPackageCatalog): Record<ObjectPackageRootType | 'device', Map<string, string>> {
  return {
    l1: createIdMap(imported.l1Templates, existing.l1Templates),
    l2: createIdMap(imported.l2Templates, existing.l2Templates),
    l3: createIdMap(imported.l3Templates, existing.l3Templates),
    project: createIdMap(imported.projects, existing.projects),
    device: createIdMap(imported.deviceItems, existing.deviceItems),
  }
}

function createIdMap<T extends { id: string }>(imported: T[], existing: T[]): Map<string, string> {
  const existingIds = new Set(existing.map(item => item.id))
  const seen = new Set<string>()
  const map = new Map<string, string>()
  imported.forEach(item => {
    if (seen.has(item.id)) throw new Error(`对象包存在重复 ID：${item.id}`)
    seen.add(item.id)
    if (existingIds.has(item.id)) map.set(item.id, generateId())
  })
  return map
}

function rewriteReferences(catalog: ObjectPackageCatalog, maps: Record<ObjectPackageRootType | 'device', Map<string, string>>): void {
  const remap = (type: ObjectPackageRootType | 'device', id: string) => maps[type].get(id) ?? id
  catalog.deviceItems.forEach(item => { item.id = remap('device', item.id) })
  catalog.l1Templates.forEach(template => {
    template.id = remap('l1', template.id)
    template.inspectionItems.forEach(item => { if (item.deviceId) item.deviceId = remap('device', item.deviceId) })
  })
  catalog.l2Templates.forEach(template => {
    template.id = remap('l2', template.id)
    template.availableL1Ids = template.availableL1Ids.map(id => remap('l1', id))
  })
  catalog.l3Templates.forEach(template => {
    template.id = remap('l3', template.id)
    template.availableL2Ids = template.availableL2Ids.map(id => remap('l2', id))
    template.subdivisionWeights = template.subdivisionWeights?.map(item => ({ ...item, l2TemplateId: remap('l2', item.l2TemplateId) }))
  })
  catalog.projects.forEach(project => {
    project.id = remap('project', project.id)
    project.l3TemplateId = project.l3TemplateId ? remap('l3', project.l3TemplateId) : ''
    project.subdivisions.forEach(sub => {
      sub.l2TemplateId = remap('l2', sub.l2TemplateId)
      sub.selectedL1Ids = sub.selectedL1Ids.map(id => remap('l1', id))
      const inspectionData: typeof sub.inspectionData = {}
      Object.entries(sub.inspectionData).forEach(([id, data]) => {
        const nextId = remap('l1', id)
        inspectionData[nextId] = { ...data, l1TemplateId: remap('l1', data.l1TemplateId) }
      })
      sub.inspectionData = inspectionData
    })
    project.locationItems?.forEach(item => {
      item.l2TemplateId = remap('l2', item.l2TemplateId)
      item.l1TemplateId = remap('l1', item.l1TemplateId)
    })
    ensureProjectLocationItems(project)
  })
}

function appendImportNames(imported: ObjectPackageCatalog, existing: ObjectPackageCatalog): void {
  appendNames(imported.l1Templates, existing.l1Templates)
  appendNames(imported.l2Templates, existing.l2Templates)
  appendNames(imported.l3Templates, existing.l3Templates)
  appendNames(imported.projects, existing.projects)
  appendNames(imported.deviceItems, existing.deviceItems)
}

function appendNames<T extends { name: string }>(imported: T[], existing: T[]): void {
  const names = new Set(existing.map(item => item.name.trim()))
  imported.forEach(item => {
    const base = item.name.trim() || '未命名'
    let candidate = base
    if (names.has(candidate)) {
      candidate = `${base}（导入）`
      let suffix = 2
      while (names.has(candidate)) candidate = `${base}（导入${suffix++}）`
    }
    item.name = candidate
    names.add(candidate)
  })
}

async function persistImportedCatalog(catalog: ObjectPackageCatalog): Promise<void> {
  const saved: { directory: string; id: string }[] = []
  const persist = async <T extends { id: string }>(directory: string, items: T[]) => {
    for (const item of items) {
      await saveData(directory, item)
      saved.push({ directory, id: item.id })
    }
  }
  try {
    await persist(STORAGE_DIRS.DEVICES, catalog.deviceItems)
    await persist(STORAGE_DIRS.TEMPLATES_L1, catalog.l1Templates)
    await persist(STORAGE_DIRS.TEMPLATES_L2, catalog.l2Templates)
    await persist(STORAGE_DIRS.TEMPLATES_L3, catalog.l3Templates)
    await persist(STORAGE_DIRS.PROJECTS, catalog.projects.map(project => ensureProjectLocationItems(project)))
  } catch (error) {
    await Promise.allSettled(saved.map(item => deleteData(item.directory, item.id)))
    throw error
  }
}

function expandDependencies(catalog: ObjectPackageCatalog, l3Ids: Set<string>, l2Ids: Set<string>, l1Ids: Set<string>): void {
  let changed = true
  while (changed) {
    changed = false
    catalog.l3Templates.filter(item => l3Ids.has(item.id)).forEach(template => template.availableL2Ids.forEach(id => {
      if (!l2Ids.has(id)) { l2Ids.add(id); changed = true }
    }))
    catalog.l2Templates.filter(item => l2Ids.has(item.id)).forEach(template => template.availableL1Ids.forEach(id => {
      if (!l1Ids.has(id)) { l1Ids.add(id); changed = true }
    }))
  }
}

function getRoot(catalog: ObjectPackageCatalog | ObjectPackage['data'], rootType: ObjectPackageRootType, id: string): L1Template | L2Template | L3Template | Project | undefined {
  const mapping = {
    l1: catalog.l1Templates,
    l2: catalog.l2Templates,
    l3: catalog.l3Templates,
    project: catalog.projects,
  }
  return mapping[rootType].find(item => item.id === id) as L1Template | L2Template | L3Template | Project | undefined
}

function getRootName(pkg: ObjectPackage, rootType: ObjectPackageRootType): string {
  const root = getRoot(pkg.data, rootType, pkg.data.rootId)
  return root ? getEntityName(root) : rootType
}

function getEntityName(entity: { name: string }): string { return entity.name || '未命名' }
function getRootLabel(rootType: ObjectPackageRootType): string {
  return { project: '项目', l1: 'L1 模板', l2: 'L2 模板', l3: 'L3 模板' }[rootType]
}
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T }

export const EMPTY_OBJECT_PACKAGE_CATALOG = EMPTY_CATALOG
