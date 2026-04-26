/**
 * Vbird ESI — 文件存储操作封装
 * 统一通过 Rust 端 Tauri Command 做文件 I/O
 * 路径获取也走 Rust 命令，避免前端 @tauri-apps/api/path 混用
 */

import { invoke } from '@tauri-apps/api/core'

/** 存储子目录常量 */
export const STORAGE_DIRS = {
  TEMPLATES_L1: 'templates/l1',
  TEMPLATES_L2: 'templates/l2',
  TEMPLATES_L3: 'templates/l3',
  DEVICES: 'devices',
  PROJECTS: 'projects',
} as const

/** 数据根目录 Promise 缓存（防止并发调用发出多次 invoke，RISK-2 修复） */
let _dataRootPromise: Promise<string> | null = null

/** 获取应用数据根目录（通过 Rust 命令获取，保证与后端一致） */
export async function getDataRoot(): Promise<string> {
  if (!_dataRootPromise) {
    _dataRootPromise = invoke<string>('get_app_data_path')
  }
  return _dataRootPromise
}

/** 拼接完整文件路径（纯字符串拼接，不依赖前端 path API） */
export async function getFilePath(subDir: string, fileName: string): Promise<string> {
  const root = await getDataRoot()
  // 使用 / 拼接路径，Rust std::fs 在 Windows 上也支持正斜杠
  return `${root}/${subDir}/${fileName}`
}

/** 读取 JSON 文件 */
export async function readJsonFile<T>(path: string): Promise<T> {
  return await invoke('read_json_file', { path })
}

/** 写入 JSON 文件 */
export async function writeJsonFile<T>(path: string, data: T): Promise<void> {
  await invoke('write_json_file', { path, data })
}

/** 删除文件 */
export async function deleteFile(path: string): Promise<void> {
  await invoke('delete_file', { path })
}

/** 列出目录下所有 JSON 文件路径 */
export async function listJsonFiles(subDir: string): Promise<string[]> {
  const root = await getDataRoot()
  const dir = `${root}/${subDir}`
  return await invoke('list_json_files', { dir })
}

/** 检查文件是否存在 */
export async function fileExists(path: string): Promise<boolean> {
  return await invoke('file_exists', { path })
}

/** 保存数据到指定子目录（自动用 data.id 作文件名） */
export async function saveData<T extends { id: string }>(
  subDir: string,
  data: T,
): Promise<void> {
  const path = await getFilePath(subDir, `${data.id}.json`)
  await writeJsonFile(path, data)
}

/** 加载指定子目录下的所有数据（并行读取，单文件失败不影响其它） */
export async function loadAllData<T>(subDir: string): Promise<T[]> {
  const files = await listJsonFiles(subDir)
  const results = await Promise.allSettled(files.map(f => readJsonFile<T>(f)))
  const data: T[] = []
  for (const r of results) {
    if (r.status === 'fulfilled') {
      data.push(r.value)
    } else {
      console.warn(`读取文件失败 (subDir=${subDir}):`, r.reason)
    }
  }
  return data
}

/** 删除指定子目录下的数据 */
export async function deleteData(subDir: string, id: string): Promise<void> {
  const path = await getFilePath(subDir, `${id}.json`)
  await deleteFile(path)
}

/** 删除指定业务目录下全部 JSON 数据 */
export async function clearDataDir(subDir: string): Promise<void> {
  const files = await listJsonFiles(subDir)
  await Promise.all(files.map(file => deleteFile(file)))
}
