<script setup lang="ts">
/**
 * L1TemplateDialog — L1 点检表模板 创建/编辑 对话框
 * 用 Element Plus Dialog + Form 实现基础 CRUD
 */
import { ref, watch, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { Plus, Delete } from '@element-plus/icons-vue'
import type { L1Template, InspectionItem, NumericOperator, NumericJoin, ValidationType } from '@/types'
import { generateId, nowISO } from '@/utils/id'

const props = defineProps<{
  visible: boolean
  template: L1Template | null  // null = 新建, 有值 = 编辑
}>()

const emit = defineEmits<{
  (e: 'update:visible', val: boolean): void
  (e: 'save', template: L1Template): void
}>()

const dialogVisible = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val),
})

// ---- 表单数据 ----
const formData = ref({
  name: '',
  facilityName: '',
  autoCutEnabled: true,
})

const inspectionItems = ref<InspectionItem[]>([])

const FIXED_TEXT_OPTIONS = ['符合', '不符合', '/'] as const
const MAX_NUMERIC_CLAUSES = 5


// ---- 监听 props 初始化表单 ----
watch(() => props.visible, (val) => {
  if (val) {
    if (props.template) {
      // 编辑模式：深拷贝
      formData.value = {
        name: props.template.name,
        facilityName: props.template.facilityName,
        autoCutEnabled: props.template.autoCutEnabled ?? true,
      }
      inspectionItems.value = JSON.parse(JSON.stringify(props.template.inspectionItems))
    } else {
      // 新建模式：重置
      formData.value = { name: '', facilityName: '', autoCutEnabled: true }
      inspectionItems.value = []
    }
  }
})

// ---- 检查项目管理 ----
function addInspectionItem() {
  const lastGroup = inspectionItems.value.length > 0
    ? inspectionItems.value[inspectionItems.value.length - 1].groupName
    : ''
  inspectionItems.value.push({
    id: generateId(),
    groupId: generateId(),
    groupName: lastGroup,
    requirement: '',
    validationType: 'text' as ValidationType,
    textOptions: [...FIXED_TEXT_OPTIONS],
    rowHeight: 30,
  })
}

function removeInspectionItem(index: number) {
  inspectionItems.value.splice(index, 1)
}

// ---- 保存 ----
function handleSave() {
  if (!formData.value.name.trim()) {
    ElMessage.warning('请输入模板名称')
    return
  }
  if (inspectionItems.value.length === 0) {
    ElMessage.warning('请至少添加一个检查项目')
    return
  }
  for (let i = 0; i < inspectionItems.value.length; i++) {
    const item = inspectionItems.value[i]
    if (!item.groupName.trim()) {
      ElMessage.warning(`第 ${i + 1} 行缺少检查项目名称`)
      return
    }
    if (!item.requirement.trim()) {
      ElMessage.warning(`第 ${i + 1} 行缺少技术要求`)
      return
    }
    if (item.validationType === 'text') {
      item.textOptions = [...FIXED_TEXT_OPTIONS]
      item.numericRule = undefined
      item.numericRange = undefined
    } else if (item.validationType === 'numeric') {
      item.textOptions = undefined
      const clauses = item.numericRule?.clauses ?? []
      if (clauses.length === 0) {
        ElMessage.warning(`第 ${i + 1} 行为数值类型，请配置至少一个条件`)
        return
      }
      if (clauses.length > MAX_NUMERIC_CLAUSES) {
        ElMessage.warning(`第 ${i + 1} 行条件数量超过上限（${MAX_NUMERIC_CLAUSES} 条）`)
        return
      }
      for (let ci = 0; ci < clauses.length; ci++) {
        const c = clauses[ci]
        if (!c.op) {
          ElMessage.warning(`第 ${i + 1} 行第 ${ci + 1} 条条件缺少操作符`)
          return
        }
        if (typeof c.value !== 'number' || Number.isNaN(c.value)) {
          ElMessage.warning(`第 ${i + 1} 行第 ${ci + 1} 条条件缺少阈值`)
          return
        }
        if (ci < clauses.length - 1) {
          if (!c.join) c.join = 'AND'
        } else {
          c.join = undefined
        }
      }
      item.numericRule = { clauses }
      item.numericRange = undefined
    }
  }

  // 合并同组的 groupId
  const groupIdMap = new Map<string, string>()
  inspectionItems.value.forEach(item => {
    if (!groupIdMap.has(item.groupName)) {
      groupIdMap.set(item.groupName, item.groupId)
    } else {
      item.groupId = groupIdMap.get(item.groupName)!
    }
  })

  const now = nowISO()
  const template: L1Template = {
    id: props.template?.id ?? generateId(),
    name: formData.value.name.trim(),
    facilityName: formData.value.facilityName.trim(),
    createdAt: props.template?.createdAt ?? now,
    updatedAt: now,
    columns: {
      fixedColumns: [
        { id: 'seq',  label: '序号',   width: 50 },
        { id: 'item', label: '检查项目', width: 120 },
        { id: 'req',  label: '技术要求', width: 200 },
      ],
      dataColumnWidth:    90,
      summaryColumnWidth: 100,
    },
    inspectionItems: inspectionItems.value,
    faultRow: {
      enabled: true,
      label: formData.value.facilityName.trim() || formData.value.name.trim(),
    },
    styles: {
      mergeRules: [],
      defaultRowHeight:  30,
      headerRowHeight:   40,
      borderStyle:       'thin' as 'thin' | 'medium' | 'thick',
    },
    autoCutEnabled: formData.value.autoCutEnabled,
  }

  emit('save', template)
  dialogVisible.value = false
  ElMessage.success(props.template ? '模板已更新' : '模板已创建')
}

function ensureNumericRule(item: InspectionItem) {
  if (item.numericRule?.clauses?.length) return
  if (item.numericRange) {
    item.numericRule = {
      clauses: [
        { op: '>=', value: item.numericRange.min, join: 'AND' },
        { op: '<=', value: item.numericRange.max },
      ],
    }
    return
  }
  item.numericRule = { clauses: [{ op: '>=', value: 0 }] }
}

const NUMERIC_OPS: { label: string; value: NumericOperator }[] = [
  { label: '大于(>)', value: '>' },
  { label: '大于等于(>=)', value: '>=' },
  { label: '小于(<)', value: '<' },
  { label: '小于等于(<=)', value: '<=' },
  { label: '等于(=)', value: '=' },
]

const NUMERIC_JOINS: { label: string; value: NumericJoin }[] = [
  { label: '并且 AND', value: 'AND' },
  { label: '或者 OR', value: 'OR' },
]

function addClause(item: InspectionItem) {
  ensureNumericRule(item)
  const clauses = item.numericRule!.clauses
  if (clauses.length >= MAX_NUMERIC_CLAUSES) return
  if (clauses.length > 0 && !clauses[clauses.length - 1].join) {
    clauses[clauses.length - 1].join = 'AND'
  }
  clauses.push({ op: '>=', value: 0 })
}

function removeClause(item: InspectionItem, idx: number) {
  ensureNumericRule(item)
  const clauses = item.numericRule!.clauses
  clauses.splice(idx, 1)
  if (clauses.length === 0) return
  clauses[clauses.length - 1].join = undefined
}

function onTypeChange(item: InspectionItem) {
  if (item.validationType === 'text') {
    item.textOptions = [...FIXED_TEXT_OPTIONS]
    item.numericRule = undefined
    item.numericRange = undefined
    return
  }
  item.textOptions = undefined
  ensureNumericRule(item)
}
</script>

<template>
  <el-dialog
    v-model="dialogVisible"
    :title="template ? `编辑模板 — ${template.name}` : '新建 L1 点检表模板'"
    width="780px"
    :close-on-click-modal="false"
    destroy-on-close
    class="template-dialog"
  >
    <!-- 基本信息 -->
    <div class="form-section">
      <h4 class="section-title">基本信息</h4>
      <div class="form-row">
        <div class="form-field">
          <label>模板名称 <span class="required">*</span></label>
          <el-input v-model="formData.name" placeholder="如：消防设施、电气设备" />
        </div>
        <div class="form-field">
          <label>设施名称</label>
          <el-input v-model="formData.facilityName" placeholder="显示在表头（可选）" />
        </div>
        <div class="form-field">
          <label>自动切割 (A4)</label>
          <el-switch v-model="formData.autoCutEnabled" active-text="开启" inactive-text="关闭" />
        </div>
      </div>
    </div>

    <!-- 检查项目列表 -->
    <div class="form-section">
      <div class="section-header">
        <h4 class="section-title">检查项目</h4>
        <el-button type="primary" :icon="Plus" size="small" @click="addInspectionItem">
          添加检查项
        </el-button>
      </div>

      <div v-if="inspectionItems.length === 0" class="empty-items">
        <p>暂无检查项目，点击「添加检查项」开始</p>
      </div>

      <div v-else class="items-table">
        <div class="items-header">
          <span class="col-seq">#</span>
          <span class="col-group">检查项目名称</span>
          <span class="col-req">技术要求</span>
          <span class="col-options">下拉选项</span>
          <span class="col-type">类型</span>
          <span class="col-action">操作</span>
        </div>
        <div
          v-for="(item, index) in inspectionItems"
          :key="item.id"
          class="items-row-wrap"
        >
          <div class="items-row">
            <span class="col-seq">{{ index + 1 }}</span>
            <el-input
              v-model="item.groupName"
              class="col-group"
              placeholder="检查项目"
              size="small"
            />
            <el-input
              v-model="item.requirement"
              class="col-req"
              placeholder="技术要求描述"
              size="small"
            />
            <span class="col-options fixed-options">
              {{ item.validationType === 'text' ? '符合, 不符合, /' : '-' }}
            </span>
            <el-select
              v-model="item.validationType"
              class="col-type"
              size="small"
              @change="() => onTypeChange(item)"
            >
              <el-option label="文本" value="text" />
              <el-option label="数值" value="numeric" />
            </el-select>
            <el-button
              class="col-action"
              type="danger"
              :icon="Delete"
              size="small"
              text
              @click="removeInspectionItem(index)"
            />
          </div>

          <div v-if="item.validationType === 'numeric'" class="numeric-rule">
            <div class="numeric-rule-head">
              <span>数值条件</span>
              <el-button
                size="small"
                text
                type="primary"
                :disabled="(item.numericRule?.clauses?.length ?? 0) >= MAX_NUMERIC_CLAUSES"
                @click="addClause(item)"
              >新增条件</el-button>
            </div>
            <div class="numeric-rule-body">
              <div
                v-for="(clause, cIdx) in (item.numericRule?.clauses ?? [])"
                :key="cIdx"
                class="numeric-clause"
              >
                <el-select v-model="clause.op" size="small" style="width: 120px">
                  <el-option v-for="op in NUMERIC_OPS" :key="op.value" :label="op.label" :value="op.value" />
                </el-select>
                <el-input-number v-model="clause.value" size="small" :step="0.1" style="width: 140px" />
                <el-select
                  v-if="cIdx < (item.numericRule?.clauses?.length ?? 0) - 1"
                  v-model="clause.join"
                  size="small"
                  style="width: 120px"
                >
                  <el-option v-for="j in NUMERIC_JOINS" :key="j.value" :label="j.label" :value="j.value" />
                </el-select>
                <span v-else class="join-placeholder"></span>
                <el-button
                  size="small"
                  text
                  type="danger"
                  :disabled="(item.numericRule?.clauses?.length ?? 0) <= 1"
                  @click="removeClause(item, cIdx)"
                >删除</el-button>
              </div>
            </div>
          </div>
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

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
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

/* 检查项目表格 */
.empty-items {
  padding: var(--space-xl) 0;
  text-align: center;
  color: var(--text-tertiary);
  font-size: 13px;
  border: 1px dashed var(--border-color-light);
  border-radius: var(--radius-md);
}

.items-table {
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.items-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--bg-elevated);
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border-color);
}

.items-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  transition: background var(--transition-fast);
}

.items-row-wrap {
  border-bottom: 1px solid var(--border-color);
}

.items-row-wrap:last-child {
  border-bottom: none;
}

.items-row-wrap:hover {
  background: var(--bg-card-hover);
}

.col-seq {
  width: 30px;
  text-align: center;
  color: var(--text-tertiary);
  font-size: 12px;
  flex-shrink: 0;
}

.col-group {
  flex: 2;
  min-width: 0;
}

.col-req {
  flex: 3;
  min-width: 0;
}

.col-options {
  flex: 2;
  min-width: 0;
}

.col-type {
  width: 80px;
  flex-shrink: 0;
}

.col-action {
  width: 36px;
  flex-shrink: 0;
}

.fixed-options {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}

.numeric-rule {
  padding: 8px 12px 10px;
  border-top: 1px dashed var(--border-color-light);
  background: var(--bg-page);
}

.numeric-rule-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.numeric-rule-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.numeric-clause {
  display: flex;
  align-items: center;
  gap: 8px;
}

.join-placeholder {
  width: 120px;
  display: inline-block;
}
</style>
