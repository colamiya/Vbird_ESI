<script setup lang="ts">
/**
 * ProjectEditor — 项目数据录入页（审查修复版）
 * 修复: C1(debounce保存 + 状态指示), F1(L2模板选择), F2(项目信息编辑)
 */
import { ref, computed, onMounted, watch, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Delete } from '@element-plus/icons-vue'
import { useProjectStore } from '@/stores/projectStore'
import { useTemplateStore } from '@/stores/templateStore'
import type { ProjectSubdivision, InspectionTableData, L2Template, DeductionItem } from '@/types'
import InspectionTable from '@/components/InspectionTable.vue'
import { buildProjectCalcPreview } from '@/utils/projectCalc'

const route = useRoute()
const router = useRouter()
const projectStore = useProjectStore()
const templateStore = useTemplateStore()

const projectId = computed(() => route.params.id as string)

// ---- 当前项目 ----
const project = computed(() =>
  projectStore.projects.find(p => p.id === projectId.value) ?? null
)

// ---- 当前选中的分部索引 ----
const activeSubIndex = ref(0)

const currentSub = computed(() =>
  project.value?.subdivisions[activeSubIndex.value] ?? null
)

// ---- 当前选中的 L1 点检表 ID（分部内二级 Tab）----
const activeL1Id = ref<string | null>(null)
const showCalcPreviewDialog = ref(false)

// ---- C1: Debounce 保存机制 ----
const saveStatus = ref<'saved' | 'saving' | 'unsaved' | 'error'>('saved')
let saveTimer: ReturnType<typeof setTimeout> | null = null
const SAVE_DEBOUNCE_MS = 800

function scheduleSave() {
  saveStatus.value = 'unsaved'
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    doSave()
  }, SAVE_DEBOUNCE_MS)
}

async function doSave() {
  if (!project.value) return
  saveStatus.value = 'saving'
  try {
    project.value.updatedAt = new Date().toISOString()
    await projectStore.saveProject(project.value)
    saveStatus.value = 'saved'
  } catch (e) {
    console.error('保存失败:', e)
    saveStatus.value = 'error'
    ElMessage.error('保存失败，请检查磁盘空间')
  }
}

// 页面离开前确保保存（onUnmounted 不支持 async，用 beforeunload + goBack 双重保证）
onUnmounted(() => {
  if (saveTimer) clearTimeout(saveTimer)
  // 尽力触发一次同步保存（不能 await，但 Tauri invoke 是异步的，依赖 goBack 拦截）
  if (saveStatus.value === 'unsaved' && project.value) {
    void doSave()
  }
})

// ---- F1: 添加分部（弹出 L2 选择） ----
const showAddSubDialog = ref(false)
const selectedL2Id = ref('')

const selectableL2Templates = computed(() => {
  if (!project.value) return []
  let available = templateStore.l2Templates
  
  // 如果项目关联了 L3，限制只能选择该 L3 包含的 L2
  if (project.value.l3TemplateId) {
    const l3 = templateStore.l3Templates.find(t => t.id === project.value!.l3TemplateId)
    if (l3) {
      available = available.filter(t => l3.availableL2Ids.includes(t.id))
    }
  }
  
  // 过滤掉已经添加的 L2
  const addedIds = new Set(project.value.subdivisions.map(s => s.l2TemplateId))
  return available.filter(t => !addedIds.has(t.id))
})

function openAddSubDialog() {
  if (selectableL2Templates.value.length === 0) {
    ElMessage.warning('没有可添加的 L2 分部表模板')
    return
  }
  selectedL2Id.value = ''
  showAddSubDialog.value = true
}

function confirmAddSubdivision() {
  if (!project.value || !selectedL2Id.value) {
    ElMessage.warning('请选择一个 L2 分部表模板')
    return
  }
  const l2 = templateStore.l2Templates.find(t => t.id === selectedL2Id.value)
  if (!l2) return

  // 防止同一 L2 模板被重复添加为分部
  const alreadyAdded = project.value.subdivisions.some(s => s.l2TemplateId === selectedL2Id.value)
  if (alreadyAdded) {
    ElMessage.warning(`「${l2.name}」已存在，不能重复添加`)
    return
  }

  const sub: ProjectSubdivision = {
    l2TemplateId: l2.id,
    l2TemplateName: l2.name,
    selectedL1Ids: [],
    inspectionData: {},
    scoringData: {},
  }

  project.value.subdivisions.push(sub)
  activeSubIndex.value = project.value.subdivisions.length - 1
  showAddSubDialog.value = false
  scheduleSave()
  ElMessage.success('分部已添加')
}

// ---- 删除分部 ----
async function removeSubdivision(index: number) {
  if (!project.value) return
  const subName = project.value.subdivisions[index]?.l2TemplateName || '未命名分部'
  try {
    await ElMessageBox.confirm(
      `确定删除分部「${subName}」？该分部下所有数据将不可恢复。`,
      '删除确认',
      { type: 'warning' }
    )
  } catch {
    return
  }
  project.value.subdivisions.splice(index, 1)
  if (activeSubIndex.value >= project.value.subdivisions.length) {
    activeSubIndex.value = Math.max(0, project.value.subdivisions.length - 1)
  }
  scheduleSave()
  ElMessage.success('分部已删除')
}

// ---- F2: 项目信息编辑 ----
const showInfoDialog = ref(false)
const editingInfo = ref({
  name: '',
  companyName: '',
  ownerUnit: '',
  implementUnit: '',
  supervisorUnit: '',
})

function openInfoDialog() {
  if (!project.value) return
  editingInfo.value = {
    name: project.value.name,
    companyName: project.value.info.companyName,
    ownerUnit: project.value.info.ownerUnit,
    implementUnit: project.value.info.implementUnit,
    supervisorUnit: project.value.info.supervisorUnit,
  }
  showInfoDialog.value = true
}

function saveInfoDialog() {
  if (!project.value) return
  if (!editingInfo.value.name.trim()) {
    ElMessage.warning('项目名称不能为空')
    return
  }
  project.value.name = editingInfo.value.name.trim()
  project.value.info.companyName = editingInfo.value.companyName.trim()
  project.value.info.ownerUnit = editingInfo.value.ownerUnit.trim()
  project.value.info.implementUnit = editingInfo.value.implementUnit.trim()
  project.value.info.supervisorUnit = editingInfo.value.supervisorUnit.trim()
  showInfoDialog.value = false
  scheduleSave()
  ElMessage.success('项目信息已更新')
}

// ---- L1 点检表管理 ----

const availableL1Templates = computed(() => {
  if (!currentSub.value) return []
  const l2 = templateStore.l2Templates.find(t => t.id === currentSub.value!.l2TemplateId)
  if (!l2) return templateStore.l1Templates
  return templateStore.l1Templates.filter(t => l2.availableL1Ids.includes(t.id))
})

function addL1ToSubdivision(l1Id: string) {
  if (!currentSub.value || !project.value) return
  if (currentSub.value.selectedL1Ids.includes(l1Id)) {
    ElMessage.warning('该点检表已添加')
    return
  }
  const l1 = templateStore.l1Templates.find(t => t.id === l1Id)
  if (!l1) return

  currentSub.value.selectedL1Ids.push(l1Id)
  currentSub.value.inspectionData[l1Id] = {
    l1TemplateId: l1Id,
    l1TemplateName: l1.name,
    checkpoints: [],
    values: l1.inspectionItems.map(() => []),
    faultValues: [],
    notes: '',
    segmentBreaks: [],
    rowBreaks: [],
  }
  activeL1Id.value = l1Id
  scheduleSave()
  ElMessage.success(`已添加「${l1.name}」`)
}

async function removeL1FromSubdivision(l1Id: string) {
  if (!currentSub.value) return
  const l1Name = currentSub.value.inspectionData[l1Id]?.l1TemplateName || '(未知)'
  try {
    await ElMessageBox.confirm(
      `确定移除点检表「${l1Name}」？该表所有填入数据将丢失。`,
      '移除确认',
      { type: 'warning' }
    )
  } catch {
    return
  }
  const idx = currentSub.value.selectedL1Ids.indexOf(l1Id)
  if (idx > -1) {
    currentSub.value.selectedL1Ids.splice(idx, 1)
    delete currentSub.value.inspectionData[l1Id]
    if (activeL1Id.value === l1Id) {
      activeL1Id.value = currentSub.value.selectedL1Ids[0] ?? null
    }
    scheduleSave()
    ElMessage.success('点检表已移除')
  }
}

function getL1Template(l1Id: string) {
  return templateStore.l1Templates.find(t => t.id === l1Id)
}

function handleInspectionUpdate(_data: InspectionTableData) {
  scheduleSave()
}

// --- L2 模板的扣分项 ---
const currentL2Template = computed<L2Template | undefined>(() => {
  if (!currentSub.value) return undefined
  return templateStore.l2Templates.find(t => t.id === currentSub.value!.l2TemplateId)
})

const currentDeductionItems = computed<DeductionItem[]>(() => {
  return currentL2Template.value?.scoring.deductionItems ?? []
})

function getDeductionValue(itemId: string): number {
  return currentSub.value?.scoringData[itemId] ?? 0
}

function setDeductionValue(itemId: string, val: number | undefined) {
  if (!currentSub.value) return
  currentSub.value.scoringData[itemId] = val ?? 0
  scheduleSave()
}

// ---- 返回项目列表 ----
async function goBack() {
  if (saveStatus.value === 'unsaved' && project.value) {
    try {
      await ElMessageBox.confirm(
        '当前有未保存的修改，是否等待保存完成后再离开？',
        '数据未保存',
        {
          type: 'warning',
          confirmButtonText: '保存并离开',
          cancelButtonText: '直接离开',
        }
      )
      // 用户确认——等待保存完成再跳转
      if (saveTimer) clearTimeout(saveTimer)
      await doSave()
    } catch {
      // 用户点“直接离开”——不保存直接跳转
    }
  }
  router.push('/projects')
}

// ---- 保存状态文本 ----
const saveStatusText = computed(() => {
  switch (saveStatus.value) {
    case 'saved': return '✓ 已保存'
    case 'saving': return '⏳ 保存中...'
    case 'unsaved': return '● 未保存'
    case 'error': return '⚠ 保存失败'
    default: return ''
  }
})

const calcPreview = computed(() =>
  project.value ? buildProjectCalcPreview(project.value, templateStore.l1Templates) : null
)

// ---- 初始化 ----
onMounted(async () => {
  await Promise.all([projectStore.loadProjects(), templateStore.loadAll()])
  if (project.value) {
    projectStore.setCurrentProject(project.value.id)
  }
})

watch(projectId, () => {
  activeSubIndex.value = 0
  activeL1Id.value = null
})

watch(currentSub, sub => {
  if (!sub) {
    activeL1Id.value = null
    return
  }
  if (activeL1Id.value && sub.selectedL1Ids.includes(activeL1Id.value)) return
  activeL1Id.value = sub.selectedL1Ids[0] ?? null
}, { immediate: true })
</script>

<template>
  <div class="project-editor">
    <!-- 面包屑导航 + 保存状态 -->
    <div class="editor-header">
      <nav class="breadcrumb">
        <span class="bc-link" @click="goBack">项目管理</span>
        <span class="bc-sep">/</span>
        <span v-if="project" class="bc-current" @dblclick="openInfoDialog" title="双击编辑项目信息">{{ project.name }}</span>
        <span v-else class="bc-current" style="color: var(--text-tertiary)">项目未找到</span>
        <template v-if="currentSub">
          <span class="bc-sep">/</span>
          <span class="bc-current">{{ currentSub.l2TemplateName }}</span>
        </template>
      </nav>
      <div class="header-actions">
        <el-button v-if="project" size="small" @click="showCalcPreviewDialog = true">检查结果计算预览</el-button>
        <span v-if="project" class="save-status" :class="saveStatus">{{ saveStatusText }}</span>
      </div>
    </div>

    <template v-if="project">
      <!-- 项目基本信息 (F2: 可点击编辑) -->
      <div class="info-bar" @click="openInfoDialog" title="点击编辑项目信息">
        <span v-if="project.info.companyName" class="info-item">
          <strong>检查公司:</strong> {{ project.info.companyName }}
        </span>
        <span v-if="project.info.ownerUnit" class="info-item">
          <strong>建设单位:</strong> {{ project.info.ownerUnit }}
        </span>
        <span v-if="project.info.implementUnit" class="info-item">
          <strong>实施单位:</strong> {{ project.info.implementUnit }}
        </span>
        <span class="info-item">
          <strong>分部数:</strong> {{ project.subdivisions.length }}
        </span>
        <span class="info-edit-hint">编辑</span>
      </div>

      <!-- 分部 Tab 导航 -->
      <div class="sub-tabs">
        <div class="sub-tabs-list">
          <div
            v-for="(sub, idx) in project.subdivisions"
            :key="idx"
            class="sub-tab"
            :class="{ active: activeSubIndex === idx }"
            @click="activeSubIndex = idx"
          >
            <span class="sub-tab-name">{{ sub.l2TemplateName }}</span>
            <el-button
              :icon="Delete"
              size="small"
              text
              type="danger"
              class="sub-tab-delete"
              @click.stop="removeSubdivision(idx)"
            />
          </div>
          <div class="sub-tab add-tab" @click="openAddSubDialog">
            <el-icon><Plus /></el-icon>
            <span>添加分部</span>
          </div>
        </div>
      </div>

      <!-- 分部内容区 -->
      <div v-if="currentSub" class="sub-content">
        <div class="content-header">
          <h3>{{ currentSub.l2TemplateName }}</h3>
          <span class="meta-info">关联 {{ currentSub.selectedL1Ids.length }} 个 L1 点检表</span>
        </div>

        <!-- L1 点检表选择区 -->
        <div class="l1-selector">
          <div class="selector-header">
            <span>添加点检表</span>
            <el-select
              placeholder="选择点检表模板..."
              size="small"
              style="width: 220px"
              @change="(val: string) => addL1ToSubdivision(val)"
            >
              <el-option
                v-for="tpl in availableL1Templates.filter(t => !currentSub!.selectedL1Ids.includes(t.id))"
                :key="tpl.id"
                :label="tpl.name"
                :value="tpl.id"
              />
            </el-select>
          </div>
        </div>

        <!-- L1 点检表数据录入区 -->
        <div class="inspection-tables-area">
          <div v-if="currentSub.selectedL1Ids.length === 0" class="no-l1-hint">
            <p>请从上方下拉菜单选择点检表模板，开始数据录入</p>
          </div>
          <template v-else>
            <div class="l1-tabs">
              <div
                v-for="l1Id in currentSub.selectedL1Ids"
                :key="l1Id"
                class="l1-tab"
                :class="{ active: activeL1Id === l1Id }"
                @click="activeL1Id = l1Id"
              >
                <span class="l1-tab-name">{{ getL1Template(l1Id)?.name ?? '(已删除)' }}</span>
                <el-button
                  :icon="Delete"
                  size="small"
                  text
                  type="danger"
                  class="l1-tab-delete"
                  @click.stop="removeL1FromSubdivision(l1Id)"
                />
              </div>
            </div>

            <div v-if="activeL1Id" class="l1-table-block">
              <InspectionTable
                v-if="getL1Template(activeL1Id) && currentSub.inspectionData[activeL1Id]"
                :key="activeL1Id"
                :template="getL1Template(activeL1Id)!"
                :data="currentSub.inspectionData[activeL1Id]"
                :header-info="project ? { companyName: project.info.companyName } : undefined"
                @update="handleInspectionUpdate"
              />
            </div>
          </template>
        </div>

        <!-- 评分数据: 动态扣分项 -->
        <div class="scoring-section">
          <h4 class="section-title">分部评分</h4>
          <div v-if="currentDeductionItems.length === 0" class="no-deductions">
            <p>该 L2 模板未配置扣分项</p>
          </div>
          <div class="scoring-row">
            <div
              v-for="item in currentDeductionItems"
              :key="item.id"
              class="scoring-field"
            >
              <label>{{ item.label }}</label>
              <el-input-number
                :model-value="getDeductionValue(item.id)"
                @update:model-value="(val: number | undefined) => setDeductionValue(item.id, val)"
                :min="0"
                :max="100"
                :step="0.5"
                size="small"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- 无分部 -->
      <div v-else class="empty-state">
        <svg class="empty-icon-svg" viewBox="0 0 48 48" fill="none"><path d="M4 12a3 3 0 013-3h12l3 4h14a3 3 0 013 3v17a3 3 0 01-3 3H7a3 3 0 01-3-3V12z" stroke="currentColor" stroke-width="2"/></svg>
        <h3>暂无分部</h3>
        <p>点击「添加分部」开始配置项目结构</p>
        <el-button type="primary" :icon="Plus" @click="openAddSubDialog" style="margin-top: 12px" size="small">添加分部</el-button>
      </div>
    </template>

    <!-- 项目不存在 -->
    <div v-else class="empty-state">
      <svg class="empty-icon-svg" viewBox="0 0 48 48" fill="none"><path d="M24 8l16 28H8L24 8z" stroke="currentColor" stroke-width="2"/><path d="M24 20v8M24 32v2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      <h3>项目未找到</h3>
      <p>可能已被删除，或数据加载失败</p>
      <el-button @click="goBack" style="margin-top: 12px" size="small">返回项目列表</el-button>
    </div>

    <!-- F1: 添加分部对话框 -->
    <el-dialog v-model="showAddSubDialog" title="添加分部" width="480px" :close-on-click-modal="false" destroy-on-close>
      <div class="form-section">
        <div class="form-field full">
          <label>选择 L2 分部表模板 <span class="required">*</span></label>
          <el-select v-model="selectedL2Id" placeholder="请选择..." style="width: 100%">
            <el-option v-for="tpl in selectableL2Templates" :key="tpl.id" :label="tpl.name" :value="tpl.id" />
          </el-select>
        </div>
      </div>
      <template #footer>
        <el-button @click="showAddSubDialog = false">取消</el-button>
        <el-button type="primary" @click="confirmAddSubdivision">添加分部</el-button>
      </template>
    </el-dialog>

    <!-- F2: 项目信息编辑对话框 -->
    <el-dialog v-model="showInfoDialog" title="编辑项目信息" width="600px" :close-on-click-modal="false" destroy-on-close>
      <div class="form-section">
        <div class="form-row">
          <div class="form-field full">
            <label>项目名称 <span class="required">*</span></label>
            <el-input v-model="editingInfo.name" placeholder="项目名称" />
          </div>
        </div>
        <div class="form-row" style="margin-top: 12px">
          <div class="form-field">
            <label>检查公司</label>
            <el-input v-model="editingInfo.companyName" />
          </div>
          <div class="form-field">
            <label>建设单位</label>
            <el-input v-model="editingInfo.ownerUnit" />
          </div>
        </div>
        <div class="form-row" style="margin-top: 12px">
          <div class="form-field">
            <label>实施单位</label>
            <el-input v-model="editingInfo.implementUnit" />
          </div>
          <div class="form-field">
            <label>监理单位</label>
            <el-input v-model="editingInfo.supervisorUnit" />
          </div>
        </div>
      </div>
      <template #footer>
        <el-button @click="showInfoDialog = false">取消</el-button>
        <el-button type="primary" @click="saveInfoDialog">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showCalcPreviewDialog" title="检查结果计算预览" width="980px" :close-on-click-modal="false" destroy-on-close>
      <div v-if="project && calcPreview" class="calc-preview">
        <div class="calc-summary-grid">
          <div class="calc-summary-card">
            <span class="calc-summary-label">项目总量</span>
            <strong class="calc-summary-value">{{ calcPreview.totalCount }}</strong>
          </div>
          <div class="calc-summary-card">
            <span class="calc-summary-label">故障数量</span>
            <strong class="calc-summary-value">{{ calcPreview.faultCount }}</strong>
          </div>
          <div class="calc-summary-card">
            <span class="calc-summary-label">合格率</span>
            <strong class="calc-summary-value">{{ calcPreview.passRate }}</strong>
          </div>
          <div class="calc-summary-card">
            <span class="calc-summary-label">总体评分 / 等级</span>
            <strong class="calc-summary-value">{{ calcPreview.avgScoreDisplay }} / {{ calcPreview.overallGrade }}</strong>
          </div>
        </div>

        <div v-if="calcPreview.subdivisions.length === 0" class="no-deductions">
          <p>当前项目还没有可统计的分部数据</p>
        </div>

        <div
          v-for="sub in calcPreview.subdivisions"
          :key="sub.l2TemplateId"
          class="calc-subsection"
        >
          <div class="calc-subsection-header">
            <div class="calc-subsection-title">
              <h4>{{ sub.name }}</h4>
              <span class="calc-subsection-meta">分部评分：{{ sub.finalScoreDisplay }}</span>
            </div>
            <div class="calc-subsection-summary">
              <span>总量 {{ sub.totalCount }}</span>
              <span>故障 {{ sub.faultCount }}</span>
              <span>合格率 {{ sub.passRate }}</span>
            </div>
          </div>

          <el-table
            :data="sub.l1Rows"
            size="small"
            border
            style="width: 100%"
            row-key="l1Id"
          >
            <el-table-column type="index" label="#" width="56" />
            <el-table-column prop="name" label="设施" min-width="220" />
            <el-table-column prop="totalCount" label="总量" width="96" />
            <el-table-column prop="faultCount" label="故障数量" width="110" />
            <el-table-column prop="passRate" label="合格率" width="110" />
          </el-table>
        </div>
      </div>
      <template #footer>
        <el-button @click="showCalcPreviewDialog = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.project-editor { width: 100%; }

.editor-header { display: flex; align-items: center; gap: var(--space-md); margin-bottom: var(--space-md); }

/* 面包屑导航 */
.breadcrumb { display: flex; align-items: center; gap: 6px; font-size: 13px; }
.header-actions { margin-left: auto; display: flex; align-items: center; gap: var(--space-sm); }
.bc-link { color: var(--text-secondary); cursor: pointer; transition: color var(--transition-fast); }
.bc-link:hover { color: var(--color-primary-light); }
.bc-sep { color: var(--text-tertiary); font-size: 11px; }
.bc-current { color: var(--text-primary); font-weight: 600; cursor: default; }

/* 保存状态 */
.save-status { font-size: 11px; padding: 3px 8px; border-radius: var(--radius-sm); transition: all var(--transition-fast); }
.save-status.saved { color: hsl(152, 56%, 32%); background: hsla(152, 56%, 46%, 0.12); }
.save-status.saving { color: hsl(235, 55%, 48%); background: hsla(235, 60%, 55%, 0.1); }
.save-status.unsaved { color: hsl(38, 80%, 38%); background: hsla(38, 92%, 50%, 0.12); }
.save-status.error { color: var(--color-danger); background: hsla(0, 72%, 51%, 0.1); }

.info-bar { display: flex; gap: var(--space-md); padding: var(--space-sm) var(--space-md); background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md); margin-bottom: var(--space-md); flex-wrap: wrap; cursor: pointer; transition: border-color var(--transition-fast); position: relative; }
.info-bar:hover { border-color: var(--color-primary); }
.info-item { font-size: 12px; color: var(--text-secondary); }
.info-item strong { color: var(--text-primary); margin-right: 4px; }
.info-edit-hint { font-size: 10px; color: var(--text-tertiary); opacity: 0; transition: opacity var(--transition-fast); position: absolute; right: 12px; top: 50%; transform: translateY(-50%); }
.info-bar:hover .info-edit-hint { opacity: 1; }

/* 分部 Tab */
.sub-tabs { margin-bottom: var(--space-md); }
.sub-tabs-list { display: flex; gap: 3px; overflow-x: auto; padding-bottom: 2px; }
.sub-tab { display: flex; align-items: center; gap: 4px; padding: 6px 14px; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md) var(--radius-md) 0 0; cursor: pointer; font-size: 12px; color: var(--text-secondary); transition: all var(--transition-fast); white-space: nowrap; }
.sub-tab:hover { background: var(--bg-card-hover); color: var(--text-primary); }
.sub-tab.active { background: var(--color-primary-bg); border-color: var(--color-primary); color: var(--color-primary); }
.sub-tab-name { max-width: 120px; overflow: hidden; text-overflow: ellipsis; }
.sub-tab-delete { opacity: 0; transition: opacity var(--transition-fast); }
.sub-tab:hover .sub-tab-delete { opacity: 1; }
.add-tab { border-style: dashed; color: var(--text-tertiary); gap: 6px; }
.add-tab:hover { border-color: var(--color-primary); color: var(--color-primary); }

/* 分部内容 */
.sub-content { background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 0 var(--radius-md) var(--radius-md) var(--radius-md); padding: var(--space-md); }
.content-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-sm); }
.content-header h3 { font-size: 14px; font-weight: 600; color: var(--text-primary); }
.meta-info { font-size: 11px; color: var(--text-tertiary); }

/* L1 选择器 */
.l1-selector { margin-bottom: var(--space-md); }
.selector-header { display: flex; align-items: center; gap: var(--space-sm); font-size: 12px; color: var(--text-secondary); }

/* L1 表格区 */
.inspection-tables-area { display: flex; flex-direction: column; gap: var(--space-md); margin-bottom: var(--space-md); }
.l1-tabs { display: flex; gap: 3px; overflow-x: auto; padding-bottom: 2px; }
.l1-tab { display: flex; align-items: center; gap: 4px; padding: 6px 12px; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md) var(--radius-md) 0 0; cursor: pointer; font-size: 12px; color: var(--text-secondary); transition: all var(--transition-fast); white-space: nowrap; }
.l1-tab:hover { background: var(--bg-card-hover); color: var(--text-primary); }
.l1-tab.active { background: var(--color-primary-bg); border-color: var(--color-primary); color: var(--color-primary); }
.l1-tab-name { max-width: 160px; overflow: hidden; text-overflow: ellipsis; }
.l1-tab-delete { opacity: 0; transition: opacity var(--transition-fast); }
.l1-tab:hover .l1-tab-delete { opacity: 1; }
.l1-table-block { border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: var(--space-sm); }
.no-l1-hint { text-align: center; padding: var(--space-md); color: var(--text-tertiary); font-size: 12px; border: 1px dashed var(--border-color); border-radius: var(--radius-md); }

/* 评分 — 紧凑行内 */
.scoring-section { border-top: 1px solid var(--border-color); padding-top: var(--space-sm); }
.section-title { font-size: 13px; font-weight: 600; color: var(--text-primary); margin-bottom: var(--space-xs); }
.scoring-row { display: flex; gap: var(--space-md); flex-wrap: wrap; align-items: center; }
.scoring-field { display: flex; align-items: center; gap: 6px; }
.scoring-field label { font-size: 12px; color: var(--text-secondary); white-space: nowrap; }
.no-deductions { font-size: 12px; color: var(--text-tertiary); padding: var(--space-xs) 0; }

/* 空状态 */
.empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: var(--space-2xl) 0; color: var(--text-tertiary); }
.empty-icon-svg { width: 48px; height: 48px; margin-bottom: var(--space-md); opacity: 0.3; color: var(--text-tertiary); }
.empty-state h3 { font-size: 15px; color: var(--text-secondary); margin-bottom: var(--space-xs); }
.empty-state p { font-size: 13px; }

/* 表单 */
.form-section { padding: var(--space-sm) 0; }
.form-row { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-md); }
.form-field { display: flex; flex-direction: column; gap: 4px; }
.form-field.full { grid-column: 1 / -1; }
.form-field label { font-size: 12px; color: var(--text-secondary); }
.required { color: var(--color-danger); }

.calc-preview { display: flex; flex-direction: column; gap: var(--space-md); }
.calc-summary-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--space-sm); }
.calc-summary-card { padding: var(--space-sm) var(--space-md); border: 1px solid var(--border-color); border-radius: var(--radius-md); background: var(--bg-card); display: flex; flex-direction: column; gap: 4px; }
.calc-summary-label { font-size: 12px; color: var(--text-secondary); }
.calc-summary-value { font-size: 18px; color: var(--text-primary); font-weight: 700; }
.calc-subsection { border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: var(--space-md); background: var(--bg-card); }
.calc-subsection-header { display: flex; align-items: center; justify-content: space-between; gap: var(--space-md); margin-bottom: var(--space-sm); }
.calc-subsection-title { display: flex; align-items: baseline; gap: var(--space-sm); flex-wrap: wrap; }
.calc-subsection-title h4 { font-size: 14px; color: var(--text-primary); margin: 0; }
.calc-subsection-meta { font-size: 12px; color: var(--text-secondary); }
.calc-subsection-summary { display: flex; gap: var(--space-md); flex-wrap: wrap; font-size: 12px; color: var(--text-secondary); }

@media (max-width: 960px) {
  .calc-summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .calc-subsection-header { flex-direction: column; align-items: flex-start; }
}
</style>
