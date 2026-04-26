<script setup lang="ts">
/**
 * TemplateManager — 模板管理页 (v2.0)
 * 改进: SVG图标替代emoji、迷你表格预览、骨架屏加载
 */
import { ref, computed, onMounted } from 'vue'
import { ElMessageBox, ElMessage } from 'element-plus'
import { Plus, Delete, Edit, Search, View } from '@element-plus/icons-vue'
import { useTemplateStore } from '@/stores/templateStore'
import type { L1Template, L2Template, L3Template, InspectionTableData, DeviceItem } from '@/types'
import { generateId } from '@/utils/id'
import InspectionTable from '@/components/InspectionTable.vue'
import L1TemplateDialog from './L1TemplateDialog.vue'
import L2TemplateDialog from './L2TemplateDialog.vue'
import L3TemplateDialog from './L3TemplateDialog.vue'

const store = useTemplateStore()

const activeTab = ref<'l1' | 'l2' | 'l3' | 'device'>('l1')
const searchKeyword = ref('')

const filteredL1 = computed(() => {
  const kw = searchKeyword.value.trim().toLowerCase()
  if (!kw) return store.l1Templates
  return store.l1Templates.filter(t =>
    t.name.toLowerCase().includes(kw) || t.facilityName?.toLowerCase().includes(kw)
  )
})

const filteredL2 = computed(() => {
  const kw = searchKeyword.value.trim().toLowerCase()
  if (!kw) return store.l2Templates
  return store.l2Templates.filter(t => t.name.toLowerCase().includes(kw))
})

const filteredL3 = computed(() => {
  const kw = searchKeyword.value.trim().toLowerCase()
  if (!kw) return store.l3Templates
  return store.l3Templates.filter(t => t.name.toLowerCase().includes(kw))
})

const filteredDevices = computed(() => {
  const kw = searchKeyword.value.trim().toLowerCase()
  if (!kw) return store.deviceItems
  return store.deviceItems.filter(t =>
    t.name.toLowerCase().includes(kw) ||
    t.model.toLowerCase().includes(kw) ||
    t.purpose.toLowerCase().includes(kw)
  )
})

// ---- L1 预览弹窗（迷你表格） ----
const showPreview = ref(false)
const previewTemplate = ref<L1Template | null>(null)
const previewData = ref<InspectionTableData | null>(null)

function openPreview(tpl: L1Template) {
  previewTemplate.value = tpl
  // 创建示例数据用于预览
  const sampleCps = ['地点1', '地点2', '地点3'].map(name => ({
    id: generateId(),
    name,
  }))
  previewData.value = {
    l1TemplateId: tpl.id,
    l1TemplateName: tpl.name,
    checkpoints: sampleCps,
    values: tpl.inspectionItems.map(item => {
      const opts = item.textOptions ?? []
      return sampleCps.map(() => opts.length > 0 ? opts[0] : '符合')
    }),
    faultValues: sampleCps.map(() => '否'),
    notes: '',
    segmentBreaks: [],
    rowBreaks: [],
  }
  showPreview.value = true
}

// ---- L1 对话框 ----
const showL1Dialog = ref(false)
const editingL1 = ref<L1Template | null>(null)
function openCreateL1() { editingL1.value = null; showL1Dialog.value = true }
function openEditL1(tpl: L1Template) { editingL1.value = tpl; showL1Dialog.value = true }
async function handleSaveL1(tpl: L1Template) { await store.saveL1Template(tpl) }
async function handleDeleteL1(tpl: L1Template) {
  // 检查是否被 L2 模板引用
  const refL2 = store.l2Templates.filter(l2 => l2.availableL1Ids.includes(tpl.id))
  let confirmMsg = `确定删除模板「${tpl.name}」？此操作不可恢复。`
  if (refL2.length > 0) {
    confirmMsg = `模板「${tpl.name}」被以下 L2 模板引用：${refL2.map(t => `「${t.name}」`).join('、')}。
删除后这些 L2 模板的可用列表中将出现“已删除”提示。是否继续删除？`
  }
  try {
    await ElMessageBox.confirm(confirmMsg, '删除确认', { type: refL2.length > 0 ? 'error' : 'warning' })
  } catch {
    return  // BUG-2: 用户点取消，正常退出
  }
  await store.deleteL1Template(tpl.id)
  ElMessage.success('模板已删除')
}

// ---- L2 对话框 ----
const showL2Dialog = ref(false)
const editingL2 = ref<L2Template | null>(null)
function openCreateL2() { editingL2.value = null; showL2Dialog.value = true }
function openEditL2(tpl: L2Template) { editingL2.value = tpl; showL2Dialog.value = true }
async function handleSaveL2(tpl: L2Template) { await store.saveL2Template(tpl) }
async function handleDeleteL2(tpl: L2Template) {
  // 检查是否被 L3 模板引用
  const refL3 = store.l3Templates.filter(l3 => l3.availableL2Ids.includes(tpl.id))
  let confirmMsg = `确定删除模板「${tpl.name}」？此操作不可恢复。`
  if (refL3.length > 0) {
    confirmMsg = `模板「${tpl.name}」被以下 L3 模板引用：${refL3.map(t => `「${t.name}」`).join('、')}。
删除后这些 L3 模板的可用列表中将出现“已删除”提示。是否继续删除？`
  }
  try {
    await ElMessageBox.confirm(confirmMsg, '删除确认', { type: refL3.length > 0 ? 'error' : 'warning' })
  } catch {
    return  // BUG-2: 用户点取消，正常退出
  }
  await store.deleteL2Template(tpl.id)
  ElMessage.success('模板已删除')
}

// ---- L3 对话框 ----
const showL3Dialog = ref(false)
const editingL3 = ref<L3Template | null>(null)
function openCreateL3() { editingL3.value = null; showL3Dialog.value = true }
function openEditL3(tpl: L3Template) { editingL3.value = tpl; showL3Dialog.value = true }
async function handleSaveL3(tpl: L3Template) { await store.saveL3Template(tpl) }
async function handleDeleteL3(tpl: L3Template) {
  try {
    await ElMessageBox.confirm(`确定删除模板「${tpl.name}」？此操作不可恢复。`, '删除确认', { type: 'warning' })
  } catch {
    return  // BUG-2: 用户点取消，正常退出
  }
  await store.deleteL3Template(tpl.id)
  ElMessage.success('模板已删除')
}

// ---- 设备库 ----
const showDeviceDialog = ref(false)
const editingDevice = ref<DeviceItem | null>(null)
const deviceForm = ref({
  name: '',
  model: '',
  unit: '',
  purpose: '',
})

function openCreateDevice() {
  editingDevice.value = null
  deviceForm.value = { name: '', model: '', unit: '', purpose: '' }
  showDeviceDialog.value = true
}

function openEditDevice(device: DeviceItem) {
  editingDevice.value = device
  deviceForm.value = {
    name: device.name,
    model: device.model,
    unit: device.unit,
    purpose: device.purpose,
  }
  showDeviceDialog.value = true
}

async function saveDevice() {
  if (!deviceForm.value.name.trim()) {
    ElMessage.warning('请输入设备名称')
    return
  }
  const now = new Date().toISOString()
  await store.saveDeviceItem({
    id: editingDevice.value?.id ?? generateId(),
    name: deviceForm.value.name.trim(),
    model: deviceForm.value.model.trim(),
    unit: deviceForm.value.unit.trim(),
    purpose: deviceForm.value.purpose.trim(),
    createdAt: editingDevice.value?.createdAt ?? now,
    updatedAt: now,
  })
  showDeviceDialog.value = false
  ElMessage.success(editingDevice.value ? '设备已更新' : '设备已创建')
}

async function handleDeleteDevice(device: DeviceItem) {
  try {
    await ElMessageBox.confirm(`确定删除设备「${device.name}」？模板中的设备关联会失效。`, '删除确认', { type: 'warning' })
  } catch {
    return
  }
  await store.deleteDeviceItem(device.id)
  ElMessage.success('设备已删除')
}

const l1Count = computed(() => store.l1Templates.length)
const l2Count = computed(() => store.l2Templates.length)
const l3Count = computed(() => store.l3Templates.length)
const deviceCount = computed(() => store.deviceItems.length)

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  } catch { return iso }
}

function getL1Names(ids: string[]): string[] {
  return ids.map(id => store.l1Templates.find(t => t.id === id)?.name ?? '(已删除)')
}

function getL2Names(ids: string[]): string[] {
  return ids.map(id => store.l2Templates.find(t => t.id === id)?.name ?? '(已删除)')
}

onMounted(() => { store.loadAll() })
</script>

<template>
  <div class="template-manager">
    <div class="page-header">
      <div>
        <h1 class="page-title">模板管理</h1>
        <p class="page-desc">管理 L1 点检表、L2 分部表、L3 总表模板</p>
      </div>
    </div>

    <!-- 三级 Tab 切换 -->
    <div class="tab-cards">
      <div class="stat-card" :class="{ active: activeTab === 'l1' }" @click="activeTab = 'l1'">
        <div class="stat-icon l1">
          <svg viewBox="0 0 20 20" fill="none"><rect x="2" y="2" width="16" height="16" rx="2" stroke="currentColor" stroke-width="1.4"/><path d="M2 7h16M7 2v16" stroke="currentColor" stroke-width="1.4"/></svg>
        </div>
        <div class="stat-info">
          <span class="stat-label">L1 点检表</span>
          <span class="stat-value">{{ l1Count }}</span>
        </div>
      </div>
      <div class="stat-card" :class="{ active: activeTab === 'l2' }" @click="activeTab = 'l2'">
        <div class="stat-icon l2">
          <svg viewBox="0 0 20 20" fill="none"><rect x="2" y="2" width="16" height="16" rx="2" stroke="currentColor" stroke-width="1.4"/><path d="M2 7h16M2 13h16" stroke="currentColor" stroke-width="1.4"/></svg>
        </div>
        <div class="stat-info">
          <span class="stat-label">L2 分部表</span>
          <span class="stat-value">{{ l2Count }}</span>
        </div>
      </div>
      <div class="stat-card" :class="{ active: activeTab === 'l3' }" @click="activeTab = 'l3'">
        <div class="stat-icon l3">
          <svg viewBox="0 0 20 20" fill="none"><rect x="2" y="2" width="16" height="16" rx="2" stroke="currentColor" stroke-width="1.4"/><path d="M5 6h10M5 10h10M5 14h6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
        </div>
        <div class="stat-info">
          <span class="stat-label">L3 总表</span>
          <span class="stat-value">{{ l3Count }}</span>
        </div>
      </div>
      <div class="stat-card" :class="{ active: activeTab === 'device' }" @click="activeTab = 'device'">
        <div class="stat-icon device">
          <svg viewBox="0 0 20 20" fill="none"><rect x="4" y="5" width="12" height="10" rx="2" stroke="currentColor" stroke-width="1.4"/><path d="M7 3v4M13 3v4M7 17v-4M13 17v-4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
        </div>
        <div class="stat-info">
          <span class="stat-label">设备库</span>
          <span class="stat-value">{{ deviceCount }}</span>
        </div>
      </div>
    </div>

    <!-- 搜索栏 -->
    <div class="search-bar">
      <el-input v-model="searchKeyword" :prefix-icon="Search" placeholder="搜索模板名称..." clearable />
    </div>

    <!-- L1 列表 -->
    <div v-if="activeTab === 'l1'" class="template-list-section">
      <div class="list-toolbar">
        <h3 class="list-title">L1 点检表模板</h3>
        <el-button type="primary" :icon="Plus" size="small" @click="openCreateL1">新建模板</el-button>
      </div>
      <!-- 骨架屏 -->
      <div v-if="store.loading" class="skeleton-grid">
        <div v-for="i in 3" :key="i" class="skeleton-card"><div class="sk-line w60"></div><div class="sk-line w40"></div><div class="sk-line w80"></div></div>
      </div>
      <div v-else-if="store.l1Templates.length === 0" class="empty-state">
        <svg class="empty-icon-svg" viewBox="0 0 48 48" fill="none"><rect x="6" y="6" width="36" height="36" rx="4" stroke="currentColor" stroke-width="2"/><path d="M6 16h36M16 6v36" stroke="currentColor" stroke-width="2"/></svg>
        <h3>暂无 L1 模板</h3>
        <p>创建一个点检表模板开始使用</p>
        <el-button type="primary" :icon="Plus" @click="openCreateL1" style="margin-top: 12px" size="small">新建模板</el-button>
      </div>
      <div v-else-if="filteredL1.length === 0" class="empty-state">
        <svg class="empty-icon-svg" viewBox="0 0 48 48" fill="none"><circle cx="20" cy="20" r="14" stroke="currentColor" stroke-width="2"/><path d="M30 30l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        <h3>无匹配结果</h3>
      </div>
      <div v-else class="template-grid">
        <div v-for="tpl in filteredL1" :key="tpl.id" class="template-card" @click="openPreview(tpl)">
          <div class="card-header">
            <h4 class="card-title">{{ tpl.name }}</h4>
            <div class="card-actions" @click.stop>
              <el-button :icon="View" size="small" text @click="openPreview(tpl)" title="预览" />
              <el-button :icon="Edit" size="small" text @click="openEditL1(tpl)" title="编辑" />
              <el-button :icon="Delete" size="small" text type="danger" @click="handleDeleteL1(tpl)" title="删除" />
            </div>
          </div>
          <div class="card-meta">
            <span v-if="tpl.facilityName" class="meta-tag">{{ tpl.facilityName }}</span>
            <span v-if="tpl.isCritical" class="meta-tag danger">重点设备 *</span>
            <span class="meta-info">{{ tpl.inspectionItems.length }} 个检查项</span>
          </div>
          <div class="card-footer"><span class="card-time">{{ formatDate(tpl.updatedAt) }}</span></div>
        </div>
      </div>
    </div>

    <!-- L2 列表 -->
    <div v-else-if="activeTab === 'l2'" class="template-list-section">
      <div class="list-toolbar">
        <h3 class="list-title">L2 分部表模板</h3>
        <el-button type="primary" :icon="Plus" size="small" @click="openCreateL2">新建模板</el-button>
      </div>
      <div v-if="store.loading" class="skeleton-grid">
        <div v-for="i in 3" :key="i" class="skeleton-card"><div class="sk-line w60"></div><div class="sk-line w40"></div><div class="sk-line w80"></div></div>
      </div>
      <div v-else-if="store.l2Templates.length === 0" class="empty-state">
        <svg class="empty-icon-svg" viewBox="0 0 48 48" fill="none"><rect x="6" y="6" width="36" height="36" rx="4" stroke="currentColor" stroke-width="2"/><path d="M6 16h36M6 28h36" stroke="currentColor" stroke-width="2"/></svg>
        <h3>暂无 L2 模板</h3>
        <p>创建分部工程表模板</p>
        <el-button type="primary" :icon="Plus" @click="openCreateL2" style="margin-top: 12px" size="small">新建模板</el-button>
      </div>
      <div v-else-if="filteredL2.length === 0" class="empty-state"><h3>无匹配结果</h3></div>
      <div v-else class="template-grid">
        <div v-for="tpl in filteredL2" :key="tpl.id" class="template-card">
          <div class="card-header">
            <h4 class="card-title">{{ tpl.name }}</h4>
            <div class="card-actions">
              <el-button :icon="Edit" size="small" text @click="openEditL2(tpl)" />
              <el-button :icon="Delete" size="small" text type="danger" @click="handleDeleteL2(tpl)" />
            </div>
          </div>
          <div class="card-meta"><span class="meta-info">关联 {{ tpl.availableL1Ids.length }} 个 L1 模板</span></div>
          <div v-if="tpl.availableL1Ids.length > 0" class="card-tags">
            <span v-for="name in getL1Names(tpl.availableL1Ids)" :key="name" class="meta-tag small">{{ name }}</span>
          </div>
          <div class="card-footer"><span class="card-time">{{ formatDate(tpl.updatedAt) }}</span></div>
        </div>
      </div>
    </div>

    <!-- L3 列表 -->
    <div v-else-if="activeTab === 'l3'" class="template-list-section">
      <div class="list-toolbar">
        <h3 class="list-title">L3 总表模板</h3>
        <el-button type="primary" :icon="Plus" size="small" @click="openCreateL3">新建模板</el-button>
      </div>
      <div v-if="store.loading" class="skeleton-grid">
        <div v-for="i in 3" :key="i" class="skeleton-card"><div class="sk-line w60"></div><div class="sk-line w40"></div><div class="sk-line w80"></div></div>
      </div>
      <div v-else-if="store.l3Templates.length === 0" class="empty-state">
        <svg class="empty-icon-svg" viewBox="0 0 48 48" fill="none"><rect x="6" y="6" width="36" height="36" rx="4" stroke="currentColor" stroke-width="2"/><path d="M12 14h24M12 22h24M12 30h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        <h3>暂无 L3 模板</h3>
        <p>创建单位工程总表模板</p>
        <el-button type="primary" :icon="Plus" @click="openCreateL3" style="margin-top: 12px" size="small">新建模板</el-button>
      </div>
      <div v-else-if="filteredL3.length === 0" class="empty-state"><h3>无匹配结果</h3></div>
      <div v-else class="template-grid">
        <div v-for="tpl in filteredL3" :key="tpl.id" class="template-card">
          <div class="card-header">
            <h4 class="card-title">{{ tpl.name }}</h4>
            <div class="card-actions">
              <el-button :icon="Edit" size="small" text @click="openEditL3(tpl)" />
              <el-button :icon="Delete" size="small" text type="danger" @click="handleDeleteL3(tpl)" />
            </div>
          </div>
          <div class="card-meta"><span class="meta-info">关联 {{ tpl.availableL2Ids.length }} 个 L2 模板</span></div>
          <div v-if="tpl.availableL2Ids.length > 0" class="card-tags">
            <span v-for="name in getL2Names(tpl.availableL2Ids)" :key="name" class="meta-tag small">{{ name }}</span>
          </div>
          <div class="card-footer"><span class="card-time">{{ formatDate(tpl.updatedAt) }}</span></div>
        </div>
      </div>
    </div>

    <!-- 设备库 -->
    <div v-else class="template-list-section">
      <div class="list-toolbar">
        <h3 class="list-title">检查设备库</h3>
        <el-button type="primary" :icon="Plus" size="small" @click="openCreateDevice">新增设备</el-button>
      </div>
      <div v-if="store.loading" class="skeleton-grid">
        <div v-for="i in 3" :key="i" class="skeleton-card"><div class="sk-line w60"></div><div class="sk-line w40"></div><div class="sk-line w80"></div></div>
      </div>
      <div v-else-if="store.deviceItems.length === 0" class="empty-state">
        <svg class="empty-icon-svg" viewBox="0 0 48 48" fill="none"><rect x="10" y="14" width="28" height="20" rx="4" stroke="currentColor" stroke-width="2"/><path d="M16 8v8M32 8v8M16 40v-8M32 40v-8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        <h3>暂无设备</h3>
        <p>新增设备后，可在 L1 检查项中关联设备</p>
        <el-button type="primary" :icon="Plus" @click="openCreateDevice" style="margin-top: 12px" size="small">新增设备</el-button>
      </div>
      <div v-else class="template-grid">
        <div v-for="device in filteredDevices" :key="device.id" class="template-card">
          <div class="card-header">
            <h4 class="card-title">{{ device.name }}</h4>
            <div class="card-actions">
              <el-button :icon="Edit" size="small" text @click="openEditDevice(device)" />
              <el-button :icon="Delete" size="small" text type="danger" @click="handleDeleteDevice(device)" />
            </div>
          </div>
          <div class="card-meta">
            <span v-if="device.model" class="meta-tag">{{ device.model }}</span>
            <span v-if="device.unit" class="meta-info">单位：{{ device.unit }}</span>
          </div>
          <div v-if="device.purpose" class="device-purpose">{{ device.purpose }}</div>
          <div class="card-footer"><span class="card-time">{{ formatDate(device.updatedAt) }}</span></div>
        </div>
      </div>
    </div>

    <!-- 对话框 -->
    <L1TemplateDialog v-model:visible="showL1Dialog" :template="editingL1" @save="handleSaveL1" />
    <L2TemplateDialog v-model:visible="showL2Dialog" :template="editingL2" @save="handleSaveL2" />
    <L3TemplateDialog v-model:visible="showL3Dialog" :template="editingL3" @save="handleSaveL3" />

    <el-dialog v-model="showDeviceDialog" :title="editingDevice ? '编辑设备' : '新增设备'" width="560px" :close-on-click-modal="false" destroy-on-close>
      <div class="form-section">
        <div class="form-row">
          <div class="form-field">
            <label>设备名称 <span class="required">*</span></label>
            <el-input v-model="deviceForm.name" />
          </div>
          <div class="form-field">
            <label>设备型号</label>
            <el-input v-model="deviceForm.model" />
          </div>
        </div>
        <div class="form-row" style="margin-top: 12px">
          <div class="form-field">
            <label>单位</label>
            <el-input v-model="deviceForm.unit" placeholder="台/套" />
          </div>
          <div class="form-field">
            <label>设备用途</label>
            <el-input v-model="deviceForm.purpose" />
          </div>
        </div>
      </div>
      <template #footer>
        <el-button @click="showDeviceDialog = false">取消</el-button>
        <el-button type="primary" @click="saveDevice">保存</el-button>
      </template>
    </el-dialog>

    <!-- E4: 迷你表格预览弹窗 -->
    <el-dialog
      v-model="showPreview"
      :title="previewTemplate ? `预览 — ${previewTemplate.name}` : '预览'"
      width="860px"
      append-to-body
    >
      <template v-if="showPreview && previewTemplate && previewData">
        <div class="preview-hint">以下为示例数据预览，编辑模板请点击下方按钮</div>
        <div class="preview-table-wrap">
          <InspectionTable
            :template="previewTemplate"
            :data="previewData"
            @update="() => {}"
          />
        </div>
      </template>
      <template #footer>
        <el-button @click="showPreview = false">关闭</el-button>
        <el-button type="primary" @click="showPreview = false; if(previewTemplate) openEditL1(previewTemplate)">编辑模板</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.template-manager { max-width: min(1600px, 100%); margin: 0 auto; }
.page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-lg); }
.page-title { font-size: 22px; font-weight: 700; color: var(--text-primary); letter-spacing: -0.02em; margin-bottom: 2px; }
.page-desc { color: var(--text-secondary); font-size: 13px; }

.tab-cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--space-sm); margin-bottom: var(--space-lg); }
.stat-card { display: flex; align-items: center; gap: var(--space-md); padding: var(--space-md) var(--space-lg); background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-lg); cursor: pointer; transition: all var(--transition-normal); }
.stat-card:hover { border-color: var(--border-color-light); }
.stat-card.active { border-color: var(--color-primary); box-shadow: var(--shadow-glow); }
.stat-icon { width: 40px; height: 40px; border-radius: var(--radius-md); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.stat-icon svg { width: 20px; height: 20px; }
.stat-icon.l1 { background: hsla(217, 72%, 50%, 0.1); color: hsl(217, 72%, 45%); }
.stat-icon.l2 { background: hsla(152, 56%, 40%, 0.1); color: hsl(152, 56%, 36%); }
.stat-icon.l3 { background: hsla(270, 55%, 50%, 0.1); color: hsl(270, 55%, 42%); }
.stat-icon.device { background: hsla(38, 80%, 50%, 0.12); color: hsl(38, 80%, 36%); }
.stat-info { display: flex; flex-direction: column; gap: 1px; }
.stat-label { font-size: 12px; color: var(--text-secondary); }
.stat-value { font-size: 22px; font-weight: 700; color: var(--text-primary); font-variant-numeric: tabular-nums; }

.template-list-section { min-height: 300px; }
.list-toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-md); }
.list-title { font-size: 15px; font-weight: 600; color: var(--text-primary); }

.template-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: var(--space-sm); }
.template-card {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-left: 3px solid var(--border-color-light);
  border-radius: var(--radius-md);
  padding: var(--space-md);
  transition: all var(--transition-normal);
  display: flex; flex-direction: column; gap: 6px;
  cursor: pointer;
}
.template-card:hover { border-left-color: var(--color-primary); box-shadow: var(--shadow-sm); }
.card-header { display: flex; align-items: center; justify-content: space-between; }
.card-title { font-size: 14px; font-weight: 600; color: var(--text-primary); }
.card-actions { display: flex; gap: 2px; opacity: 0; transition: opacity var(--transition-fast); }
.template-card:hover .card-actions { opacity: 1; }
.card-meta { display: flex; align-items: center; gap: var(--space-sm); flex-wrap: wrap; }
.meta-tag { font-size: 11px; padding: 1px 6px; background: var(--color-primary-bg); color: var(--color-primary); border-radius: var(--radius-sm); }
.meta-tag.danger { background: hsla(0, 72%, 51%, 0.08); color: var(--color-danger); }
.meta-tag.small { font-size: 10px; padding: 1px 5px; }
.meta-info { font-size: 11px; color: var(--text-tertiary); }
.card-tags { display: flex; gap: 4px; flex-wrap: wrap; }
.card-footer { margin-top: auto; }
.card-time { font-size: 10px; color: var(--text-tertiary); }
.device-purpose { font-size: 12px; color: var(--text-secondary); line-height: 1.5; }

/* 空状态 — SVG 代替 emoji */
.empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: var(--space-2xl) 0; color: var(--text-tertiary); }
.empty-icon-svg { width: 48px; height: 48px; margin-bottom: var(--space-md); opacity: 0.3; color: var(--text-tertiary); }
.empty-state h3 { font-size: 15px; color: var(--text-secondary); margin-bottom: var(--space-xs); }
.empty-state p { font-size: 13px; }

/* 骨架屏 */
.skeleton-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: var(--space-sm); }
.skeleton-card { background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: var(--space-md); display: flex; flex-direction: column; gap: 10px; }
.sk-line { height: 12px; background: var(--bg-elevated); border-radius: var(--radius-sm); animation: sk-pulse 1.5s ease-in-out infinite; }
.sk-line.w60 { width: 60%; }
.sk-line.w40 { width: 40%; }
.sk-line.w80 { width: 80%; }
@keyframes sk-pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 0.8; } }

.search-bar { margin-bottom: var(--space-md); }
.search-bar .el-input { max-width: 320px; }

/* E4: 预览 */
.preview-hint { font-size: 12px; color: var(--text-tertiary); margin-bottom: var(--space-sm); }
.preview-table-wrap { max-height: 480px; overflow: auto; border: 1px solid var(--border-color); border-radius: var(--radius-md); pointer-events: none; opacity: 0.85; }
</style>
