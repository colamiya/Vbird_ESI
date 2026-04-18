<script setup lang="ts">
/**
 * L3TemplateDialog — L3 单位工程总表模板 创建/编辑 对话框
 * 包含基本信息 + 穿梭框关联 L2 模板
 */
import { ref, watch, computed } from 'vue'
import { ElMessage } from 'element-plus'
import type { L3Template } from '@/types'
import { generateId, nowISO } from '@/utils/id'
import { useTemplateStore } from '@/stores/templateStore'

const props = defineProps<{
  visible: boolean
  template: L3Template | null
}>()

const emit = defineEmits<{
  (e: 'update:visible', val: boolean): void
  (e: 'save', template: L3Template): void
}>()

const store = useTemplateStore()

const dialogVisible = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val),
})

const formData = ref({
  name: '',
  title: '检查结果计算表',
  companyName: '',
  projectName: '',
})

const selectedL2Ids = ref<string[]>([])

// ---- 穿梭框数据源（独占模型：已被其他 L3 占用的 L2 不显示；无 L1 的 L2 也不显示） ----
const transferData = computed(() => {
  // 收集被其他 L3 模板占用的 L2 ID
  const usedL2Ids = new Set<string>()
  for (const l3 of store.l3Templates) {
    if (props.template && l3.id === props.template.id) continue
    for (const id of l3.availableL2Ids) usedL2Ids.add(id)
  }

  return store.l2Templates
    .filter(t => {
      // 排除没有关联任何 L1 的 L2（空壳模板不可选）
      if (t.availableL1Ids.length === 0) return false
      // 排除已被其他 L3 占用的 L2
      return !usedL2Ids.has(t.id)
    })
    .map(t => ({
      key: t.id,
      label: t.name,
      disabled: false,
    }))
})

watch(() => props.visible, (val) => {
  if (val) {
    if (props.template) {
      formData.value = {
        name: props.template.name,
        title: props.template.headerInfo.title,
        companyName: props.template.headerInfo.fields.companyName,
        projectName: props.template.headerInfo.fields.projectName,
      }
      selectedL2Ids.value = [...props.template.availableL2Ids]
    } else {
      formData.value = { name: '', title: '检查结果计算表', companyName: '', projectName: '' }
      selectedL2Ids.value = []
    }
  }
})

function handleSave() {
  if (!formData.value.name.trim()) {
    ElMessage.warning('请输入模板名称')
    return
  }

  const now = nowISO()
  const template: L3Template = {
    id: props.template?.id ?? generateId(),
    name: formData.value.name.trim(),
    createdAt: props.template?.createdAt ?? now,
    updatedAt: now,
    availableL2Ids: selectedL2Ids.value,
    headerInfo: {
      title: formData.value.title.trim(),
      fields: {
        companyName: formData.value.companyName.trim(),
        projectName: formData.value.projectName.trim(),
      },
    },
    styles: {
      mergeRules: [],
      defaultRowHeight: 30,
      headerRowHeight: 40,
      borderStyle: 'thin',
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
    :title="template ? `编辑 L3 模板 — ${template.name}` : '新建 L3 总表模板'"
    width="680px"
    :close-on-click-modal="false"
    destroy-on-close
  >
    <div class="form-section">
      <h4 class="section-title">基本信息</h4>
      <div class="form-row">
        <div class="form-field">
          <label>模板名称 <span class="required">*</span></label>
          <el-input v-model="formData.name" placeholder="如：检查结果计算表" />
        </div>
        <div class="form-field">
          <label>表标题</label>
          <el-input v-model="formData.title" />
        </div>
      </div>
      <div class="form-row" style="margin-top: 12px">
        <div class="form-field">
          <label>检查公司</label>
          <el-input v-model="formData.companyName" placeholder="默认留空" />
        </div>
        <div class="form-field">
          <label>项目名称</label>
          <el-input v-model="formData.projectName" placeholder="默认留空" />
        </div>
      </div>
    </div>

    <div class="form-section">
      <h4 class="section-title">关联 L2 分部表模板</h4>
      <p class="section-desc">将可用的 L2 模板从左侧选入右侧</p>
      <el-transfer
        v-model="selectedL2Ids"
        :data="transferData"
        :titles="['可用模板', '已关联']"
        filterable
        filter-placeholder="搜索模板"
      />
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
.form-section { margin-bottom: var(--space-lg); }
.section-title { font-size: 15px; font-weight: 600; color: var(--text-primary); margin-bottom: var(--space-sm); }
.section-desc { font-size: 12px; color: var(--text-tertiary); margin-bottom: var(--space-sm); }
.form-row { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-md); }
.form-field { display: flex; flex-direction: column; gap: 4px; }
.form-field label { font-size: 13px; color: var(--text-secondary); }
.required { color: var(--color-danger); }
</style>
