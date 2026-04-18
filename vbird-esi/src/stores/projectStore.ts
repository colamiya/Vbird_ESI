/**
 * Vbird ESI — 项目状态管理 (Pinia)
 * 管理项目的 CRUD + 当前编辑项目
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Project } from '@/types'
import { saveData, loadAllData, deleteData, STORAGE_DIRS } from '@/utils/storage'

export const useProjectStore = defineStore('project', () => {
  // ---- 状态 ----
  const projects = ref<Project[]>([])
  const currentProjectId = ref<string | null>(null)
  const loading = ref(false)

  // ---- 计算属性 ----
  const currentProject = computed(() =>
    projects.value.find(p => p.id === currentProjectId.value) ?? null
  )

  // ---- 操作 ----
  async function loadProjects() {
    loading.value = true
    try {
      projects.value = await loadAllData<Project>(STORAGE_DIRS.PROJECTS)
    } catch (e) {
      console.warn('加载项目失败:', e)
      projects.value = []
    } finally {
      loading.value = false
    }
  }

  async function saveProject(project: Project) {
    project.updatedAt = new Date().toISOString()
    await saveData(STORAGE_DIRS.PROJECTS, project)
    const idx = projects.value.findIndex(p => p.id === project.id)
    if (idx >= 0) {
      projects.value[idx] = project
    } else {
      projects.value.push(project)
    }
  }

  async function deleteProject(id: string) {
    await deleteData(STORAGE_DIRS.PROJECTS, id)
    projects.value = projects.value.filter(p => p.id !== id)
    if (currentProjectId.value === id) {
      currentProjectId.value = null
    }
  }

  function setCurrentProject(id: string | null) {
    currentProjectId.value = id
  }

  return {
    projects,
    currentProjectId,
    currentProject,
    loading,
    loadProjects,
    saveProject,
    deleteProject,
    setCurrentProject,
  }
})
