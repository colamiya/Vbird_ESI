/**
 * Vbird ESI — 模板状态管理 (Pinia)
 * 管理 L1/L2/L3 三级模板的 CRUD
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { L1Template, L2Template, L3Template } from '@/types'
import { saveData, loadAllData, deleteData, STORAGE_DIRS } from '@/utils/storage'

export const useTemplateStore = defineStore('template', () => {
  // ---- 状态 ----
  const l1Templates = ref<L1Template[]>([])
  const l2Templates = ref<L2Template[]>([])
  const l3Templates = ref<L3Template[]>([])
  const loading = ref(false)

  // ---- L1 操作 ----
  async function loadL1Templates() {
    loading.value = true
    try {
      l1Templates.value = await loadAllData<L1Template>(STORAGE_DIRS.TEMPLATES_L1)
    } catch (e) {
      console.warn('加载 L1 模板失败:', e)
      l1Templates.value = []
    } finally {
      loading.value = false
    }
  }

  async function saveL1Template(template: L1Template) {
    template.updatedAt = new Date().toISOString()
    await saveData(STORAGE_DIRS.TEMPLATES_L1, template)
    const idx = l1Templates.value.findIndex(t => t.id === template.id)
    if (idx >= 0) {
      l1Templates.value[idx] = { ...template }
    } else {
      l1Templates.value.push({ ...template })
    }
  }

  async function deleteL1Template(id: string) {
    await deleteData(STORAGE_DIRS.TEMPLATES_L1, id)
    l1Templates.value = l1Templates.value.filter(t => t.id !== id)
  }

  // ---- L2 操作 ----
  async function loadL2Templates() {
    loading.value = true
    try {
      l2Templates.value = await loadAllData<L2Template>(STORAGE_DIRS.TEMPLATES_L2)
    } catch (e) {
      console.warn('加载 L2 模板失败:', e)
      l2Templates.value = []
    } finally {
      loading.value = false
    }
  }

  async function saveL2Template(template: L2Template) {
    template.updatedAt = new Date().toISOString()
    await saveData(STORAGE_DIRS.TEMPLATES_L2, template)
    const idx = l2Templates.value.findIndex(t => t.id === template.id)
    const copy = JSON.parse(JSON.stringify(template)) as L2Template  // BUG-5: 深拷贝防引用泄漏
    if (idx >= 0) {
      l2Templates.value[idx] = copy
    } else {
      l2Templates.value.push(copy)
    }
  }

  async function deleteL2Template(id: string) {
    await deleteData(STORAGE_DIRS.TEMPLATES_L2, id)
    l2Templates.value = l2Templates.value.filter(t => t.id !== id)
  }

  // ---- L3 操作 ----
  async function loadL3Templates() {
    loading.value = true
    try {
      l3Templates.value = await loadAllData<L3Template>(STORAGE_DIRS.TEMPLATES_L3)
    } catch (e) {
      console.warn('加载 L3 模板失败:', e)
      l3Templates.value = []
    } finally {
      loading.value = false
    }
  }

  async function saveL3Template(template: L3Template) {
    template.updatedAt = new Date().toISOString()
    await saveData(STORAGE_DIRS.TEMPLATES_L3, template)
    const idx = l3Templates.value.findIndex(t => t.id === template.id)
    const copy = JSON.parse(JSON.stringify(template)) as L3Template  // BUG-5: 深拷贝防引用泄漏
    if (idx >= 0) {
      l3Templates.value[idx] = copy
    } else {
      l3Templates.value.push(copy)
    }
  }

  async function deleteL3Template(id: string) {
    await deleteData(STORAGE_DIRS.TEMPLATES_L3, id)
    l3Templates.value = l3Templates.value.filter(t => t.id !== id)
  }

  // ---- 初始化（并行加载，三级独立容错，一级失败不影响其他级） ----
  async function loadAll() {
    loading.value = true
    // BUG-1: 改用 Promise.allSettled，防止单级异常导致其他级数据丢失
    const [r1, r2, r3] = await Promise.allSettled([
      loadAllData<L1Template>(STORAGE_DIRS.TEMPLATES_L1),
      loadAllData<L2Template>(STORAGE_DIRS.TEMPLATES_L2),
      loadAllData<L3Template>(STORAGE_DIRS.TEMPLATES_L3),
    ])
    if (r1.status === 'fulfilled') l1Templates.value = r1.value
    else console.warn('加载 L1 模板失败:', r1.reason)
    if (r2.status === 'fulfilled') l2Templates.value = r2.value
    else console.warn('加载 L2 模板失败:', r2.reason)
    if (r3.status === 'fulfilled') l3Templates.value = r3.value
    else console.warn('加载 L3 模板失败:', r3.reason)
    loading.value = false
  }

  return {
    l1Templates,
    l2Templates,
    l3Templates,
    loading,
    loadL1Templates,
    saveL1Template,
    deleteL1Template,
    loadL2Templates,
    saveL2Template,
    deleteL2Template,
    loadL3Templates,
    saveL3Template,
    deleteL3Template,
    loadAll,
  }
})
