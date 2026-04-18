<script setup lang="ts">
/**
 * SegmentLayoutEditor — 坐标式分段布局只读预览组件
 *
 * 功能：显示自动切割预览信息（不再支持手动编辑）
 * - 实时显示本表将自动分为 N 段，共 M 页
 * - 列出每段的地点范围
 */
import { computed } from 'vue'
import type { InspectionTableData } from '@/types/project'
import type { L1Template } from '@/types/template'
import { buildL1PrintPages } from '@/utils/l1PrintLayout'

const props = defineProps<{
  data: InspectionTableData
  template: L1Template
}>()

const pages = computed(() => buildL1PrintPages(props.template, props.data))
const segments = computed(() =>
  pages.value.flatMap(page =>
    page.segments.map(seg => ({
      index: seg.index,
      startCol: seg.startCol,
      endCol: seg.endCol,
    })),
  ),
)

const segmentSummary = computed(() => {
  const segs = segments.value
  if (segs.length === 0) return []
  return segs.map(seg => {
    const startName = props.data.checkpoints[seg.startCol]?.name ?? `地点${seg.startCol + 1}`
    const endName = props.data.checkpoints[seg.endCol]?.name ?? `地点${seg.endCol + 1}`
    const label = startName === endName ? startName : `${startName} ~ ${endName}`
    return {
      index: seg.index,
      label,
      cols: seg.endCol - seg.startCol + 1,
    }
  })
})

const totalPages = computed(() => pages.value.length)
</script>

<template>
  <div class="seg-preview">
    <div class="preview-info">
      <div class="info-icon">📋</div>
      <div class="info-text">
        <div class="info-title">自动切割预览</div>
        <div class="info-desc">
          本表将自动分为 <strong>{{ segments.length }}</strong> 段，共 <strong>{{ totalPages }}</strong> 页
          <span class="per-page">（每段最多 6 个地点）</span>
        </div>
      </div>
    </div>

    <div v-if="segments.length > 0" class="seg-list">
      <div class="seg-list-title">分段详情</div>
      <div class="seg-items">
        <div
          v-for="seg in segmentSummary"
          :key="seg.index"
          class="seg-item"
        >
          <span class="seg-badge">段 {{ seg.index + 1 }}</span>
          <span class="seg-range">{{ seg.label }}</span>
          <span class="seg-count">{{ seg.cols }} 个地点</span>
        </div>
      </div>
    </div>

    <div v-else class="no-seg-hint">
      添加检查点后自动计算分段
    </div>
  </div>
</template>

<style scoped>
.seg-preview {
  padding: var(--space-sm) var(--space-md);
  background: hsla(217, 72%, 50%, 0.03);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

.preview-info {
  display: flex;
  align-items: flex-start;
  gap: var(--space-sm);
}

.info-icon {
  font-size: 20px;
  line-height: 1;
  flex-shrink: 0;
}

.info-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.info-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.info-desc {
  font-size: 12px;
  color: var(--text-secondary);
}

.info-desc strong {
  color: var(--color-primary);
  font-weight: 600;
}

.per-page {
  color: var(--text-tertiary);
  font-size: 11px;
}

.seg-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.seg-list-title {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.seg-items {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.seg-item {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  padding: 4px 8px;
  background: var(--bg-card);
  border: 1px solid var(--border-color-light);
  border-radius: var(--radius-sm);
  font-size: 12px;
}

.seg-badge {
  padding: 1px 6px;
  background: hsl(217, 72%, 95%);
  color: hsl(217, 72%, 40%);
  border-radius: 10px;
  font-size: 10px;
  font-weight: 600;
  flex-shrink: 0;
}

.seg-range {
  color: var(--text-primary);
  flex: 1;
}

.seg-count {
  color: var(--text-tertiary);
  font-size: 11px;
  flex-shrink: 0;
}

.no-seg-hint {
  font-size: 12px;
  color: var(--text-tertiary);
  text-align: center;
  padding: var(--space-sm);
  background: var(--bg-page);
  border-radius: var(--radius-sm);
  border: 1px dashed var(--border-color);
}
</style>
