import { open, save } from '@tauri-apps/plugin-dialog'
import type { DeviceItem, L1Template, L2Template, L3Template, Project } from '@/types'
import {
  clearDataDir,
  loadAllData,
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
      l1Templates: await loadAllData<L1Template>(STORAGE_DIRS.TEMPLATES_L1),
      l2Templates: await loadAllData<L2Template>(STORAGE_DIRS.TEMPLATES_L2),
      l3Templates: await loadAllData<L3Template>(STORAGE_DIRS.TEMPLATES_L3),
      deviceItems: await loadAllData<DeviceItem>(STORAGE_DIRS.DEVICES),
      projects: (await loadAllData<Project>(STORAGE_DIRS.PROJECTS)).map(p => ensureProjectLocationItems(p)),
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

  const pkg = await readJsonFile<FullBackupPackage>(selected)
  if (pkg.app !== 'vbird-esi' || pkg.backupVersion !== 1 || !pkg.data) {
    throw new Error('备份包格式不正确或版本不兼容')
  }

  await Promise.all([
    clearDataDir(STORAGE_DIRS.TEMPLATES_L1),
    clearDataDir(STORAGE_DIRS.TEMPLATES_L2),
    clearDataDir(STORAGE_DIRS.TEMPLATES_L3),
    clearDataDir(STORAGE_DIRS.DEVICES),
    clearDataDir(STORAGE_DIRS.PROJECTS),
  ])

  for (const item of pkg.data.l1Templates ?? []) await saveData(STORAGE_DIRS.TEMPLATES_L1, item)
  for (const item of pkg.data.l2Templates ?? []) await saveData(STORAGE_DIRS.TEMPLATES_L2, item)
  for (const item of pkg.data.l3Templates ?? []) await saveData(STORAGE_DIRS.TEMPLATES_L3, item)
  for (const item of pkg.data.deviceItems ?? []) await saveData(STORAGE_DIRS.DEVICES, item)
  for (const item of pkg.data.projects ?? []) await saveData(STORAGE_DIRS.PROJECTS, ensureProjectLocationItems(item))

  return true
}
