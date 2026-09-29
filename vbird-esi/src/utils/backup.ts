import { open, save } from '@tauri-apps/plugin-dialog'
import type { DeviceItem, L1Template, L2Template, L3Template, Project } from '@/types'
import {
  assertSafeEntityId,
  clearDataDir,
  loadAllDataStrict,
  readJsonFile,
  saveData,
  STORAGE_DIRS,
  writeJsonFile,
} from '@/utils/storage'
import { ensureProjectLocationItems } from '@/utils/projectStructure'

export interface FullBackupPackage {
  backupVersion: 1
  exportedAt: string
  app: 'vbird-esi'
  data: {
    l1Templates: L1Template[]
    l2Templates: L2Template[]
    l3Templates: L3Template[]
    deviceItems: DeviceItem[]
    projects: Project[]
  }
}

type BackupData = FullBackupPackage['data']

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function requireEntityArray<T extends { id: string }>(
  value: unknown,
  field: keyof BackupData,
): T[] {
  if (!Array.isArray(value)) throw new Error(`备份包字段 ${field} 必须是数组`)
  const seen = new Set<string>()
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`备份包字段 ${field}[${index}] 必须是对象`)
    }
    const item = entry as T
    assertSafeEntityId(item.id)
    if (seen.has(item.id)) throw new Error(`备份包字段 ${field} 存在重复 ID：${item.id}`)
    seen.add(item.id)
    return clone(item)
  })
}

function validateBackupDependencies(data: BackupData): void {
  const l1Ids = new Set(data.l1Templates.map(item => item.id))
  const l2Ids = new Set(data.l2Templates.map(item => item.id))
  const l3Ids = new Set(data.l3Templates.map(item => item.id))
  const deviceIds = new Set(data.deviceItems.map(item => item.id))

  for (const template of data.l1Templates) {
    if (!Array.isArray(template.inspectionItems)) throw new Error(`L1 模板「${template.id}」检查项格式不正确`)
    for (const item of template.inspectionItems) {
      if (item.deviceId && !deviceIds.has(item.deviceId)) throw new Error(`L1 模板「${template.id}」缺少关联设备`)
    }
  }
  for (const template of data.l2Templates) {
    if (!Array.isArray(template.availableL1Ids)) throw new Error(`L2 模板「${template.id}」关联格式不正确`)
    if (template.availableL1Ids.some(id => !l1Ids.has(id))) throw new Error(`L2 模板「${template.id}」缺少关联 L1 模板`)
  }
  for (const template of data.l3Templates) {
    if (!Array.isArray(template.availableL2Ids)) throw new Error(`L3 模板「${template.id}」关联格式不正确`)
    if (template.availableL2Ids.some(id => !l2Ids.has(id))) throw new Error(`L3 模板「${template.id}」缺少关联 L2 模板`)
  }
  for (const project of data.projects) {
    if (!Array.isArray(project.subdivisions)) throw new Error(`项目「${project.id}」分部格式不正确`)
    if (project.l3TemplateId && !l3Ids.has(project.l3TemplateId)) throw new Error(`项目「${project.id}」缺少关联 L3 模板`)
    for (const sub of project.subdivisions) {
      if (!sub || typeof sub !== 'object' || !l2Ids.has(sub.l2TemplateId)) throw new Error(`项目「${project.id}」缺少关联 L2 模板`)
      if (!Array.isArray(sub.selectedL1Ids) || sub.selectedL1Ids.some(id => !l1Ids.has(id))) {
        throw new Error(`项目「${project.id}」缺少关联 L1 模板`)
      }
      if (!sub.inspectionData || typeof sub.inspectionData !== 'object') throw new Error(`项目「${project.id}」检查数据格式不正确`)
    }
  }
}

/** 在删除任何现有数据前，完整准备并验证外部备份。 */
export function prepareFullBackupPackage(rawPackage: unknown): FullBackupPackage {
  if (!rawPackage || typeof rawPackage !== 'object') throw new Error('备份包不是有效 JSON 对象')
  const pkg = rawPackage as Partial<FullBackupPackage>
  if (pkg.app !== 'vbird-esi' || pkg.backupVersion !== 1 || !pkg.data || typeof pkg.data !== 'object') {
    throw new Error('备份包格式不正确或版本不兼容')
  }
  const source = pkg.data as Partial<BackupData>
  const data: BackupData = {
    l1Templates: requireEntityArray<L1Template>(source.l1Templates, 'l1Templates'),
    l2Templates: requireEntityArray<L2Template>(source.l2Templates, 'l2Templates'),
    l3Templates: requireEntityArray<L3Template>(source.l3Templates, 'l3Templates'),
    deviceItems: requireEntityArray<DeviceItem>(source.deviceItems, 'deviceItems'),
    projects: requireEntityArray<Project>(source.projects, 'projects').map(project => ensureProjectLocationItems(project)),
  }
  validateBackupDependencies(data)
  return {
    app: 'vbird-esi',
    backupVersion: 1,
    exportedAt: typeof pkg.exportedAt === 'string' ? pkg.exportedAt : '',
    data,
  }
}

async function clearAllData(): Promise<void> {
  const directories = [
    STORAGE_DIRS.TEMPLATES_L1,
    STORAGE_DIRS.TEMPLATES_L2,
    STORAGE_DIRS.TEMPLATES_L3,
    STORAGE_DIRS.DEVICES,
    STORAGE_DIRS.PROJECTS,
  ]
  const results = await Promise.allSettled([
    clearDataDir(STORAGE_DIRS.TEMPLATES_L1),
    clearDataDir(STORAGE_DIRS.TEMPLATES_L2),
    clearDataDir(STORAGE_DIRS.TEMPLATES_L3),
    clearDataDir(STORAGE_DIRS.DEVICES),
    clearDataDir(STORAGE_DIRS.PROJECTS),
  ])
  const failedDirectories = results
    .map((result, index) => ({ result, directory: directories[index] }))
    .filter(item => item.result.status === 'rejected')
    .map(item => item.directory)
  if (failedDirectories.length > 0) {
    throw new Error('无法完整清空数据目录：' + failedDirectories.join('、'))
  }
}

async function persistBackupData(data: BackupData): Promise<void> {
  for (const item of data.l1Templates) await saveData(STORAGE_DIRS.TEMPLATES_L1, item)
  for (const item of data.l2Templates) await saveData(STORAGE_DIRS.TEMPLATES_L2, item)
  for (const item of data.l3Templates) await saveData(STORAGE_DIRS.TEMPLATES_L3, item)
  for (const item of data.deviceItems) await saveData(STORAGE_DIRS.DEVICES, item)
  for (const item of data.projects) await saveData(STORAGE_DIRS.PROJECTS, item)
}

export async function exportFullBackupPackage(): Promise<string | null> {
  const filePath = await save({
    title: '导出系统数据备份',
    defaultPath: `ESI-backup-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'ESI 系统备份', extensions: ['json'] }],
  })
  if (!filePath) return null

  const data: FullBackupPackage = {
    backupVersion: 1,
    exportedAt: new Date().toISOString(),
    app: 'vbird-esi',
    data: {
      l1Templates: await loadAllDataStrict<L1Template>(STORAGE_DIRS.TEMPLATES_L1),
      l2Templates: await loadAllDataStrict<L2Template>(STORAGE_DIRS.TEMPLATES_L2),
      l3Templates: await loadAllDataStrict<L3Template>(STORAGE_DIRS.TEMPLATES_L3),
      deviceItems: await loadAllDataStrict<DeviceItem>(STORAGE_DIRS.DEVICES),
      projects: (await loadAllDataStrict<Project>(STORAGE_DIRS.PROJECTS)).map(p => ensureProjectLocationItems(p)),
    },
  }

  await writeJsonFile(filePath, data)
  return filePath
}

export async function importFullBackupPackage(): Promise<boolean> {
  const selected = await open({
    title: '导入系统数据备份',
    multiple: false,
    filters: [{ name: 'ESI 系统备份', extensions: ['json'] }],
  })
  if (!selected || Array.isArray(selected)) return false

  const pkg = prepareFullBackupPackage(await readJsonFile<unknown>(selected))
  const previous: BackupData = {
    l1Templates: await loadAllDataStrict<L1Template>(STORAGE_DIRS.TEMPLATES_L1),
    l2Templates: await loadAllDataStrict<L2Template>(STORAGE_DIRS.TEMPLATES_L2),
    l3Templates: await loadAllDataStrict<L3Template>(STORAGE_DIRS.TEMPLATES_L3),
    deviceItems: await loadAllDataStrict<DeviceItem>(STORAGE_DIRS.DEVICES),
    projects: await loadAllDataStrict<Project>(STORAGE_DIRS.PROJECTS),
  }

  try {
    await clearAllData()
    await persistBackupData(pkg.data)
  } catch (error) {
    try {
      await clearAllData()
      await persistBackupData(previous)
    } catch (rollbackError) {
      throw new Error(`备份导入失败，且旧数据恢复失败：${String(error)}；${String(rollbackError)}`)
    }
    throw error
  }

  return true
}
