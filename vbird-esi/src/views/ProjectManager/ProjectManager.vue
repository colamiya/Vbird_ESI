<script setup lang="ts">
/**
 * ProjectManager — 项目管理页
 * 支持项目的创建/编辑/删除/列表
 */
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessageBox, ElMessage } from 'element-plus'
import { Plus, Delete, Edit, Search, Download } from '@element-plus/icons-vue'
import { useProjectStore } from '@/stores/projectStore'
import { useTemplateStore } from '@/stores/templateStore'
import type { Project } from '@/types'
import { generateId, nowISO } from '@/utils/id'
import { exportProjectToExcel } from '@/utils/excelExport'

const router = useRouter()
const projectStore = useProjectStore()
const templateStore = useTemplateStore()

// ---- 搜索 ----
const searchKeyword = ref('')

const filteredProjects = computed(() => {
  const kw = searchKeyword.value.trim().toLowerCase()
  if (!kw) return projectStore.projects
  return projectStore.projects.filter(p =>
    p.name.toLowerCase().includes(kw) ||
    p.info.companyName.toLowerCase().includes(kw)
  )
})

// ---- 创建项目对话框 ----
const showCreateDialog = ref(false)
const createForm = ref({
  name: '',
  companyName: '',
  ownerUnit: '',
  implementUnit: '',
  supervisorUnit: '',
  l3TemplateId: '',
})

function openCreateDialog() {
  createForm.value = { name: '', companyName: '', ownerUnit: '', implementUnit: '', supervisorUnit: '', l3TemplateId: '' }
  showCreateDialog.value = true
}

async function handleCreateProject() {
  if (!createForm.value.name.trim()) {
    ElMessage.warning('请输入项目名称')
    return
  }

  const now = nowISO()
  const project: Project = {
    id: generateId(),
    name: createForm.value.name.trim(),
    createdAt: now,
    updatedAt: now,
    info: {
      companyName: createForm.value.companyName.trim(),
      ownerUnit: createForm.value.ownerUnit.trim(),
      implementUnit: createForm.value.implementUnit.trim(),
      supervisorUnit: createForm.value.supervisorUnit.trim(),
    },
    l3TemplateId: createForm.value.l3TemplateId,
    subdivisions: [],
  }

  await projectStore.saveProject(project)
  showCreateDialog.value = false
  ElMessage.success('项目已创建')
}

async function handleDeleteProject(project: Project) {
  await ElMessageBox.confirm(`确定删除项目「${project.name}」？此操作不可恢复。`, '删除确认', { type: 'warning' })
  await projectStore.deleteProject(project.id)
  ElMessage.success('项目已删除')
}

function openProject(project: Project) {
  projectStore.setCurrentProject(project.id)
  router.push(`/project/${project.id}`)
}

// ---- 导出 Excel ----
const exportingId = ref<string | null>(null)

async function handleExportExcel(project: Project) {
  exportingId.value = project.id
  try {
    const ok = await exportProjectToExcel(
      project,
      templateStore.l1Templates,
      templateStore.l2Templates,
    )
    if (ok) {
      ElMessage.success('Excel 导出成功')
    }
  } catch (e: any) {
    console.error('导出失败:', e)
    ElMessage.error(`导出失败: ${e.message || e}`)
  } finally {
    exportingId.value = null
  }
}

// ---- 格式化时间 ----
function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  } catch {
    return iso
  }
}

// ---- L3 模板名称查找 ----
function getL3Name(id: string): string {
  if (!id) return '未选择'
  const tpl = templateStore.l3Templates.find(t => t.id === id)
  return tpl?.name ?? '(已删除)'
}

onMounted(() => {
  projectStore.loadProjects()
  templateStore.loadAll()
})
</script>

<template>
  <div class="project-manager">
    <div class="page-header">
      <div>
        <h1 class="page-title">项目管理</h1>
        <p class="page-desc">管理工程安全检查项目，进行数据采集与导出</p>
      </div>
      <el-button type="primary" :icon="Plus" size="large" @click="openCreateDialog">新建项目</el-button>
    </div>

    <!-- 统计卡片 -->
    <div class="stats-row">
      <div class="stat-card-mini">
        <div class="stat-icon-mini">
          <svg viewBox="0 0 20 20" fill="none"><path d="M2 5a1.5 1.5 0 011.5-1.5H8l1.5 2h7A1.5 1.5 0 0118 7v8.5A1.5 1.5 0 0116.5 17h-13A1.5 1.5 0 012 15.5V5z" stroke="currentColor" stroke-width="1.5"/></svg>
        </div>
        <div class="stat-info-mini">
          <span class="stat-value-mini">{{ projectStore.projects.length }}</span>
          <span class="stat-label-mini">总项目数</span>
        </div>
      </div>
    </div>

    <!-- 搜索栏 -->
    <div class="search-bar">
      <el-input
        v-model="searchKeyword"
        :prefix-icon="Search"
        placeholder="搜索项目名称或检查公司..."
        clearable
        size="large"
      />
    </div>

    <!-- 加载中 -->
    <!-- 骨架屏加载 -->
    <div v-if="projectStore.loading" class="skeleton-grid">
      <div v-for="i in 3" :key="i" class="skeleton-card"><div class="sk-line w60"></div><div class="sk-line w40"></div><div class="sk-line w80"></div></div>
    </div>

    <!-- 空状态 -->
    <div v-else-if="projectStore.projects.length === 0" class="empty-state">
      <svg class="empty-icon-svg" viewBox="0 0 48 48" fill="none"><path d="M4 12a3 3 0 013-3h12l3 4h14a3 3 0 013 3v17a3 3 0 01-3 3H7a3 3 0 01-3-3V12z" stroke="currentColor" stroke-width="2"/></svg>
      <h3>暂无项目</h3>
      <p>点击「新建项目」开始第一个工程检查</p>
      <el-button type="primary" :icon="Plus" @click="openCreateDialog" style="margin-top: 12px" size="small">新建项目</el-button>
    </div>

    <!-- 搜索无结果 -->
    <div v-else-if="filteredProjects.length === 0" class="empty-state">
      <svg class="empty-icon-svg" viewBox="0 0 48 48" fill="none"><circle cx="20" cy="20" r="14" stroke="currentColor" stroke-width="2"/><path d="M30 30l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      <h3>无匹配结果</h3>
    </div>

    <!-- 项目列表 -->
    <div v-else class="project-grid">
      <div
        v-for="project in filteredProjects"
        :key="project.id"
        class="project-card"
        @click="openProject(project)"
      >
        <div class="card-header">
          <h4 class="card-title">{{ project.name }}</h4>
          <div class="card-actions" @click.stop>
            <el-button :icon="Download" size="small" text type="success" @click="handleExportExcel(project)" :loading="exportingId === project.id" title="导出 Excel" />
            <el-button :icon="Edit" size="small" text @click="openProject(project)" />
            <el-button :icon="Delete" size="small" text type="danger" @click="handleDeleteProject(project)" />
          </div>
        </div>
        <div class="card-meta">
          <span v-if="project.info.companyName" class="meta-tag">{{ project.info.companyName }}</span>
          <span class="meta-info">{{ project.subdivisions.length }} 个分部</span>
          <span class="meta-info">L3: {{ getL3Name(project.l3TemplateId) }}</span>
        </div>
        <div class="card-footer">
          <span class="card-time">更新: {{ formatDate(project.updatedAt) }}</span>
        </div>
      </div>
    </div>

    <!-- 创建项目对话框 -->
    <el-dialog v-model="showCreateDialog" title="新建项目" width="600px" :close-on-click-modal="false">
      <div class="form-section">
        <div class="form-row">
          <div class="form-field full">
            <label>项目名称 <span class="required">*</span></label>
            <el-input v-model="createForm.name" placeholder="如：XX 工程安全检查" />
          </div>
        </div>
        <div class="form-row" style="margin-top: 12px">
          <div class="form-field">
            <label>检查公司</label>
            <el-input v-model="createForm.companyName" />
          </div>
          <div class="form-field">
            <label>建设单位</label>
            <el-input v-model="createForm.ownerUnit" />
          </div>
        </div>
        <div class="form-row" style="margin-top: 12px">
          <div class="form-field">
            <label>实施单位</label>
            <el-input v-model="createForm.implementUnit" />
          </div>
          <div class="form-field">
            <label>监理单位</label>
            <el-input v-model="createForm.supervisorUnit" />
          </div>
        </div>
        <div class="form-row" style="margin-top: 12px">
          <div class="form-field full">
            <label>关联 L3 总表模板</label>
            <el-select v-model="createForm.l3TemplateId" placeholder="选择总表模板（可选）" clearable style="width: 100%">
              <el-option v-for="tpl in templateStore.l3Templates" :key="tpl.id" :label="tpl.name" :value="tpl.id" />
            </el-select>
          </div>
        </div>
      </div>
      <template #footer>
        <el-button @click="showCreateDialog = false">取消</el-button>
        <el-button type="primary" @click="handleCreateProject">创建项目</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.project-manager { max-width: min(1600px, 100%); margin: 0 auto; }
.page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-lg); }
.page-title { font-size: 22px; font-weight: 700; color: var(--text-primary); letter-spacing: -0.02em; margin-bottom: 2px; }
.page-desc { color: var(--text-secondary); font-size: 13px; }

.stats-row { display: flex; gap: var(--space-sm); margin-bottom: var(--space-md); }
.stat-card-mini { display: flex; align-items: center; gap: var(--space-sm); padding: var(--space-sm) var(--space-md); background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md); }
.stat-icon-mini { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; background: hsla(217, 72%, 50%, 0.1); color: hsl(217, 72%, 45%); border-radius: var(--radius-sm); }
.stat-icon-mini svg { width: 16px; height: 16px; }
.stat-info-mini { display: flex; flex-direction: column; }
.stat-value-mini { font-size: 18px; font-weight: 700; color: var(--text-primary); font-variant-numeric: tabular-nums; }
.stat-label-mini { font-size: 10px; color: var(--text-tertiary); }

.search-bar { margin-bottom: var(--space-md); }
.search-bar .el-input { max-width: 320px; }

.project-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: var(--space-sm); }
.project-card { background: var(--bg-card); border: 1px solid var(--border-color); border-left: 3px solid var(--border-color-light); border-radius: var(--radius-md); padding: var(--space-md); cursor: pointer; transition: all var(--transition-normal); display: flex; flex-direction: column; gap: 6px; }
.project-card:hover { border-left-color: var(--color-primary); box-shadow: var(--shadow-sm); }
.card-header { display: flex; align-items: center; justify-content: space-between; }
.card-title { font-size: 14px; font-weight: 600; color: var(--text-primary); }
.card-actions { display: flex; gap: 2px; opacity: 0; transition: opacity var(--transition-fast); }
.project-card:hover .card-actions { opacity: 1; }
.card-meta { display: flex; align-items: center; gap: var(--space-sm); flex-wrap: wrap; }
.meta-tag { font-size: 11px; padding: 1px 6px; background: var(--color-primary-bg); color: var(--color-primary); border-radius: var(--radius-sm); }
.meta-info { font-size: 11px; color: var(--text-tertiary); }
.card-footer { margin-top: auto; }
.card-time { font-size: 10px; color: var(--text-tertiary); }

.empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: var(--space-2xl) 0; color: var(--text-tertiary); }
.empty-icon-svg { width: 48px; height: 48px; margin-bottom: var(--space-md); opacity: 0.3; color: var(--text-tertiary); }
.empty-state h3 { font-size: 15px; color: var(--text-secondary); margin-bottom: var(--space-xs); }
.empty-state p { font-size: 13px; }

/* 骨架屏 */
.skeleton-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: var(--space-sm); }
.skeleton-card { background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: var(--space-md); display: flex; flex-direction: column; gap: 10px; }
.sk-line { height: 12px; background: var(--bg-elevated); border-radius: var(--radius-sm); animation: sk-pulse 1.5s ease-in-out infinite; }
.sk-line.w60 { width: 60%; }
.sk-line.w40 { width: 40%; }
.sk-line.w80 { width: 80%; }
@keyframes sk-pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 0.8; } }

.form-section { padding: var(--space-sm) 0; }
.form-row { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-md); }
.form-field { display: flex; flex-direction: column; gap: 4px; }
.form-field.full { grid-column: 1 / -1; }
.form-field label { font-size: 12px; color: var(--text-secondary); }
.required { color: var(--color-danger); }
</style>
