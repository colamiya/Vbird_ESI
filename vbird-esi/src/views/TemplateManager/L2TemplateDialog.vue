<script setup lang="ts">
/**
 * L2TemplateDialog — L2 分部工程表模板 创建/编辑 对话框
 * 包含基本信息 + 穿梭框关联 L1 模板
 */
import { ref, watch, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { ArrowDown, ArrowUp } from '@element-plus/icons-vue'
import type { L2Template, DeductionItem, GradeThreshold } from '@/types'
import { generateId, nowISO } from '@/utils/id'
import { useTemplateStore } from '@/stores/templateStore'

const props = defineProps<{
  visible: boolean
  template: L2Template | null
}>()

const emit = defineEmits<{
  (e: 'update:visible', val: boolean): void
  (e: 'save', template: L2Template): void
}>()

const store = useTemplateStore()

const dialogVisible = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val),
})

// ---- 表单数据 ----
const formData = ref({
  name: '',
  title: '分部工程质量检验评定表',
  companyName: '',
  subdivisionName: '',
  implementUnit: '',
  ownerUnit: '',
  supervisorUnit: '',
})

// 自定义扣分项列表
const deductionItems = ref<DeductionItem[]>([])
// 质量等级阈值
const gradeThresholds = ref<GradeThreshold[]>([])

/** 默认等级阈值 */
const DEFAULT_GRADES: GradeThreshold[] = [
  { label: '优良', minScore: 85 },
  { label: '合格', minScore: 70 },
  { label: '不合格', minScore: 0 },
]

// 穿梭框数据
const selectedL1Ids = ref<string[]>([])
const selectedL1Rows = computed(() => selectedL1Ids.value.map(id => ({
  id,
  name: store.l1Templates.find(template => template.id === id)?.name ?? '(已删除模板)',
})))

// ---- 穿梭框数据源（独占模型：已被其他 L2 占用的 L1 不显示） ----
const transferData = computed(() => {
  // 收集被其他 L2 模板占用的 L1 ID
  const usedL1Ids = new Set<string>()
  for (const l2 of store.l2Templates) {
    // 跳过当前正在编辑的模板（它自己占用的 L1 仍然可见）
    if (props.template && l2.id === props.template.id) continue
    for (const id of l2.availableL1Ids) usedL1Ids.add(id)
  }

  return store.l1Templates
    .filter(t => !usedL1Ids.has(t.id))
    .map(t => ({
      key: t.id,
      label: t.name,
      disabled: false,
    }))
})

// ---- 监听 props 初始化表单 ----
watch(() => props.visible, (val) => {
  if (val) {
    if (props.template) {
      formData.value = {
        name: props.template.name,
        title: props.template.headerInfo.title,
        companyName: props.template.headerInfo.fields.companyName,
        subdivisionName: props.template.headerInfo.fields.subdivisionName,
        implementUnit: props.template.headerInfo.fields.implementUnit,
        ownerUnit: props.template.headerInfo.fields.ownerUnit,
        supervisorUnit: props.template.headerInfo.fields.supervisorUnit,
      }
      deductionItems.value = JSON.parse(JSON.stringify(props.template.scoring.deductionItems))
      gradeThresholds.value = JSON.parse(JSON.stringify(
        props.template.scoring.gradeThresholds ?? DEFAULT_GRADES
      ))
      selectedL1Ids.value = [...props.template.availableL1Ids]
    } else {
      formData.value = {
        name: '',
        title: '分部工程质量检验评定表',
        companyName: '',
        subdivisionName: '',
        implementUnit: '',
        ownerUnit: '',
        supervisorUnit: '',
      }
      // 默认预置两个扣分项
      deductionItems.value = [
        { id: generateId(), label: '外观缺陷扣分' },
        { id: generateId(), label: '资料扣分' },
      ]
      gradeThresholds.value = JSON.parse(JSON.stringify(DEFAULT_GRADES))
      selectedL1Ids.value = []
    }
  }
})

// ---- 扣分项管理 ----
function addDeductionItem() {
  deductionItems.value.push({ id: generateId(), label: '' })
}

function removeDeductionItem(index: number) {
  deductionItems.value.splice(index, 1)
}

// ---- 质量等级管理 ----
function addGrade() {
  gradeThresholds.value.push({ label: '', minScore: 0 })
}
function removeGrade(index: number) {
  gradeThresholds.value.splice(index, 1)
}

function moveL1(index: number, direction: -1 | 1) {
  const target = index + direction
  if (target < 0 || target >= selectedL1Ids.value.length) return
  const ids = [...selectedL1Ids.value]
  ;[ids[index], ids[target]] = [ids[target], ids[index]]
  selectedL1Ids.value = ids
}
/** 阈值按分数降序排序，确保匹配顺序正确 */
function sortedGrades(): GradeThreshold[] {
  return [...gradeThresholds.value].sort((a, b) => b.minScore - a.minScore)
}

// ---- 保存 ----
function handleSave() {
  if (!formData.value.name.trim()) {
    ElMessage.warning('请输入模板名称')
    return
  }

  const now = nowISO()
  const template: L2Template = {
    id: props.template?.id ?? generateId(),
    name: formData.value.name.trim(),
    createdAt: props.template?.createdAt ?? now,
    updatedAt: now,
    availableL1Ids: selectedL1Ids.value,
    headerInfo: {
      title: formData.value.title.trim(),
      fields: {
        companyName: formData.value.companyName.trim(),
        subdivisionName: formData.value.subdivisionName.trim(),
        implementUnit: formData.value.implementUnit.trim(),
        ownerUnit: formData.value.ownerUnit.trim(),
        supervisorUnit: formData.value.supervisorUnit.trim(),
      },
    },
    scoring: {
      deductionItems: deductionItems.value.filter(d => d.label.trim()),
      gradeThresholds: sortedGrades().filter(g => g.label.trim()),
    },
  }

  emit('save', template)
  dialogVisible.value = false
  ElMessage.success(props.template ? '模板已更新' : '模板已创建')
}
</script>

<template>
  <el-dialog
    v-model="dialogVisible"
    :title="template ? `编辑 L2 模板 — ${template.name}` : '新建 L2 分部表模板'"
    width="720px"
    :close-on-click-modal="false"
    destroy-on-close
  >
    <!-- 基本信息 -->
    <div class="form-section">
      <h4 class="section-title">基本信息</h4>
      <div class="form-row">
        <div class="form-field">
          <label>模板名称 <span class="required">*</span></label>
          <el-input v-model="formData.name" placeholder="如：安全设施分部" />
        </div>
        <div class="form-field">
          <label>表标题</label>
          <el-input v-model="formData.title" placeholder="分部工程质量检验评定表" />
        </div>
      </div>
    </div>

    <!-- 表头字段 -->
    <div class="form-section">
      <h4 class="section-title">表头信息（默认值）</h4>
      <div class="form-row">
        <div class="form-field">
          <label>检查公司</label>
          <el-input v-model="formData.companyName" placeholder="默认留空" />
        </div>
        <div class="form-field">
          <label>分部工程名称</label>
          <el-input v-model="formData.subdivisionName" placeholder="默认留空" />
        </div>
      </div>
      <div class="form-row" style="margin-top: 12px">
        <div class="form-field">
          <label>实施单位</label>
          <el-input v-model="formData.implementUnit" placeholder="默认留空" />
        </div>
        <div class="form-field">
          <label>建设单位</label>
          <el-input v-model="formData.ownerUnit" placeholder="默认留空" />
        </div>
      </div>
      <div class="form-row" style="margin-top: 12px">
        <div class="form-field">
          <label>监理单位</label>
          <el-input v-model="formData.supervisorUnit" placeholder="默认留空" />
        </div>
        <div class="form-field" />
      </div>
    </div>

    <!-- 评分配置：自定义扣分项 -->
    <div class="form-section">
      <div class="section-header">
        <h4 class="section-title">扣分项配置</h4>
        <el-button type="primary" size="small" @click="addDeductionItem">添加扣分项</el-button>
      </div>
      <div v-if="deductionItems.length === 0" class="empty-deductions">
        <p>无扣分项，可点击上方按钮添加</p>
      </div>
      <div v-for="(item, idx) in deductionItems" :key="item.id" class="deduction-row">
        <el-input v-model="item.label" placeholder="如：外观缺陷扣分" size="small" style="flex: 1" />
        <el-button type="danger" size="small" text @click="removeDeductionItem(idx)">删除</el-button>
      </div>
    </div>

    <!-- 质量等级配置 -->
    <div class="form-section">
      <div class="section-header">
        <div>
          <h4 class="section-title">质量等级配置</h4>
          <p class="section-desc">按最终得分判定等级（从高到低依次匹配第一个满足条件的等级）</p>
        </div>
        <el-button type="primary" size="small" @click="addGrade">添加等级</el-button>
      </div>
      <div class="grade-header">
        <span class="grade-col-label">等级名称</span>
        <span class="grade-col-score">最低分（含）</span>
        <span style="width:48px"></span>
      </div>
      <div v-for="(grade, idx) in gradeThresholds" :key="idx" class="deduction-row">
        <el-input v-model="grade.label" placeholder="如：优良" size="small" class="grade-col-label" />
        <el-input-number
          v-model="grade.minScore" :min="0" :max="100" :step="5"
          size="small" class="grade-col-score" controls-position="right"
        />
        <el-button type="danger" size="small" text @click="removeGrade(idx)">删除</el-button>
      </div>
      <div v-if="gradeThresholds.length === 0" class="empty-deductions">
        <p>无等级配置，导出时将不显示等级判定</p>
      </div>
    </div>

    <!-- 关联 L1 模板 -->
    <div class="form-section">
      <h4 class="section-title">关联 L1 点检表模板</h4>
      <p class="section-desc">将可用的 L1 模板从左侧选入右侧</p>
      <el-transfer
        v-model="selectedL1Ids"
        :data="transferData"
        :titles="['可用模板', '已关联']"
        filterable
        filter-placeholder="搜索模板"
      />
      <div v-if="selectedL1Rows.length" class="order-panel">
        <div class="order-title">导出与项目展示顺序</div>
        <div v-for="(row, index) in selectedL1Rows" :key="row.id" class="order-row">
          <span class="order-index">{{ index + 1 }}</span>
          <span class="order-name">{{ row.name }}</span>
          <el-tooltip content="上移" placement="top"><el-button :icon="ArrowUp" circle text size="small" :disabled="index === 0" @click="moveL1(index, -1)" /></el-tooltip>
          <el-tooltip content="下移" placement="top"><el-button :icon="ArrowDown" circle text size="small" :disabled="index === selectedL1Rows.length - 1" @click="moveL1(index, 1)" /></el-tooltip>
        </div>
      </div>
    </div>

    <template #footer>
      <el-button @click="dialogVisible = false">取消</el-button>
      <el-button type="primary" @click="handleSave">
        {{ template ? '保存修改' : '创建模板' }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.form-section {
  margin-bottom: var(--space-lg);
}

.section-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: var(--space-sm);
}

.section-desc {
  font-size: 12px;
  color: var(--text-tertiary);
  margin-bottom: var(--space-sm);
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-md);
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.form-field label {
  font-size: 13px;
  color: var(--text-secondary);
}

.required {
  color: var(--color-danger);
}

.switch-row {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  margin-bottom: var(--space-sm);
  font-size: 13px;
  color: var(--text-secondary);
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-sm);
}

.deduction-row {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  margin-bottom: 6px;
}

.empty-deductions {
  text-align: center;
  padding: var(--space-md);
  color: var(--text-tertiary);
  font-size: 12px;
  border: 1px dashed var(--border-color-light);
  border-radius: var(--radius-md);
}

/* 质量等级配置 */
.grade-header {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: 4px 0;
  margin-bottom: 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
}
.grade-col-label { flex: 2; min-width: 0; }
.grade-col-score { width: 120px; flex-shrink: 0; }
.order-panel { margin-top: var(--space-md); border-top: 1px solid var(--border-color-light); padding-top: var(--space-sm); }
.order-title { font-size: 13px; font-weight: 600; color: var(--text-secondary); margin-bottom: var(--space-xs); }
.order-row { display: flex; align-items: center; gap: var(--space-xs); min-height: 32px; }
.order-index { width: 24px; text-align: center; color: var(--text-tertiary); font-size: 12px; }
.order-name { flex: 1; min-width: 0; color: var(--text-primary); font-size: 13px; }
</style>
