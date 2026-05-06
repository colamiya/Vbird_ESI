<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const props = withDefaults(defineProps<{
  modelValue: string[]
  columns?: number
  minRows?: number
  disabled?: boolean
}>(), {
  columns: 6,
  minRows: 2,
  disabled: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: string[]]
  change: [value: string[]]
}>()

interface GridPos {
  row: number
  col: number
}

const cleanedNames = computed(() => compactNames(props.modelValue))
const columnCount = computed(() => Math.max(1, props.columns))
const rowCount = computed(() =>
  Math.max(props.minRows, Math.ceil((cleanedNames.value.length + 1) / columnCount.value)),
)
const gridRows = computed(() =>
  Array.from({ length: rowCount.value }, (_, rowIdx) =>
    Array.from({ length: columnCount.value }, (_, colIdx) => rowIdx * columnCount.value + colIdx),
  ),
)
const gridStyle = computed(() => ({ '--location-columns': String(columnCount.value) }))
const selectionStart = ref<number | null>(null)
const selectionEnd = ref<number | null>(null)
const isSelecting = ref(false)
const editIndex = ref<number | null>(null)
const gridRef = ref<HTMLElement | null>(null)

const selectionBounds = computed(() => {
  if (selectionStart.value === null || selectionEnd.value === null) return null
  const start = indexToPos(selectionStart.value)
  const end = indexToPos(selectionEnd.value)
  return {
    startRow: Math.min(start.row, end.row),
    endRow: Math.max(start.row, end.row),
    startCol: Math.min(start.col, end.col),
    endCol: Math.max(start.col, end.col),
  }
})

const selectedIndices = computed(() => {
  const bounds = selectionBounds.value
  if (!bounds) return []
  const indices: number[] = []
  for (let row = bounds.startRow; row <= bounds.endRow; row++) {
    for (let col = bounds.startCol; col <= bounds.endCol; col++) {
      indices.push(posToIndex({ row, col }))
    }
  }
  return indices
})

onMounted(() => {
  window.addEventListener('mouseup', stopSelection)
})

onBeforeUnmount(() => {
  window.removeEventListener('mouseup', stopSelection)
})

function cellValue(index: number): string {
  return cleanedNames.value[index] ?? ''
}

function updateCell(index: number, value: string) {
  const next = cleanedNames.value.slice()
  while (next.length <= index) next.push('')
  next[index] = value
  emitNames(next)
}

function commitEdit(index: number, value: string) {
  updateCell(index, value)
  exitEdit()
  focusGrid()
}

function handlePaste(event: ClipboardEvent, index: number) {
  if (editIndex.value !== null) return
  const text = event.clipboardData?.getData('text/plain') ?? ''
  const matrix = parsePastedMatrix(text)
  if (matrix.length === 0) return

  event.preventDefault()
  const next = cleanedNames.value.slice()
  const targetBounds = selectionBounds.value
  const selected = selectedIndices.value

  if (matrix.length === 1 && matrix[0].length === 1 && selected.length > 1) {
    selected.forEach(idx => {
      next[idx] = matrix[0][0]
    })
    emitNames(next)
    return
  }

  const start = targetBounds
    ? { row: targetBounds.startRow, col: targetBounds.startCol }
    : indexToPos(index)

  matrix.forEach((row, rowOffset) => {
    row.forEach((value, colOffset) => {
      const targetIndex = posToIndex({
        row: start.row + rowOffset,
        col: start.col + colOffset,
      })
      next[targetIndex] = value
    })
  })

  emitNames(next)
}

function handleCopy(event: ClipboardEvent) {
  if (editIndex.value !== null) return
  const text = buildSelectionText()
  if (!text) return
  event.clipboardData?.setData('text/plain', text)
  event.preventDefault()
}

function handleKeydown(event: KeyboardEvent) {
  if (props.disabled) return
  if (editIndex.value !== null) return

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
    selectAllCells()
    event.preventDefault()
    focusGrid()
    return
  }

  if ((event.key === 'Enter' || event.key === 'F2') && selectionStart.value !== null) {
    enterEdit(selectionStart.value)
    event.preventDefault()
    return
  }

  if ((event.key === 'Delete' || event.key === 'Backspace') && selectedIndices.value.length > 1) {
    clearSelectedCells()
    event.preventDefault()
  }
}

function handleEditKeydown(event: KeyboardEvent, index: number) {
  if (event.key === 'Enter') {
    commitEdit(index, (event.target as HTMLInputElement).value)
    event.preventDefault()
  } else if (event.key === 'Escape') {
    exitEdit()
    focusGrid()
    event.preventDefault()
  }
}

function startSelection(event: MouseEvent, index: number) {
  if (props.disabled) return
  exitEdit()
  if (event.shiftKey && selectionStart.value !== null) {
    setSelection(selectionStart.value, index)
    event.preventDefault()
    focusGrid()
    return
  }
  setSelection(index, index)
  isSelecting.value = true
  focusGrid()
}

function extendSelection(index: number) {
  if (!isSelecting.value || selectionStart.value === null) return
  selectionEnd.value = index
}

function stopSelection() {
  isSelecting.value = false
}

function enterEdit(index: number) {
  if (props.disabled) return
  setSelection(index, index)
  editIndex.value = index
  requestAnimationFrame(() => {
    const input = document.querySelector<HTMLInputElement>(`[data-location-edit="${index}"]`)
    input?.focus()
    input?.select()
  })
}

function exitEdit() {
  editIndex.value = null
}

function isSelected(index: number): boolean {
  return selectedIndices.value.includes(index)
}

function setSelection(start: number, end: number) {
  selectionStart.value = start
  selectionEnd.value = end
}

function selectAllCells() {
  const lastIndex = Math.max(cleanedNames.value.length - 1, 0)
  setSelection(0, lastIndex)
}

function clearSelectedCells() {
  const next = cleanedNames.value.slice()
  selectedIndices.value.forEach(index => {
    next[index] = ''
  })
  emitNames(next)
}

function focusGrid() {
  requestAnimationFrame(() => gridRef.value?.focus())
}

function buildSelectionText(): string {
  const bounds = selectionBounds.value
  if (!bounds) return ''

  const rows: string[] = []
  for (let row = bounds.startRow; row <= bounds.endRow; row++) {
    const values: string[] = []
    for (let col = bounds.startCol; col <= bounds.endCol; col++) {
      values.push(cellValue(posToIndex({ row, col })))
    }
    rows.push(values.join('\t'))
  }
  return rows.join('\n')
}

function emitNames(names: string[]) {
  const next = compactNames(names)
  emit('update:modelValue', next)
  emit('change', next)
}

function compactNames(names: string[]): string[] {
  return names
    .map(name => `${name ?? ''}`.trim())
    .filter(Boolean)
}

function parsePastedMatrix(text: string): string[][] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
  if (!normalized) return []

  if (normalized.includes('\t')) {
    return normalized
      .split('\n')
      .map(row => row.split('\t').map(name => name.trim()))
      .filter(row => row.some(Boolean))
  }

  const cells = normalized
    .split(/[\n,，、;；]+/)
    .map(name => name.trim())
    .filter(Boolean)
  return cells.length > 0 ? [cells] : []
}

function indexToPos(index: number): GridPos {
  return {
    row: Math.floor(index / columnCount.value),
    col: index % columnCount.value,
  }
}

function posToIndex(pos: GridPos): number {
  return (pos.row * columnCount.value) + pos.col
}
</script>

<template>
  <div class="location-names-editor">
    <div
      ref="gridRef"
      class="location-grid"
      :style="gridStyle"
      tabindex="0"
      @copy="handleCopy"
      @paste="event => handlePaste(event, selectionStart ?? 0)"
      @keydown="handleKeydown"
    >
      <div
        v-for="col in columnCount"
        :key="`header-${col}`"
        class="location-header"
      >
        检测部位{{ col }}
      </div>
      <template v-for="row in gridRows" :key="row[0]">
        <div
          v-for="index in row"
          :key="index"
          class="location-cell"
          :class="{ selected: isSelected(index) }"
          @mousedown.left.exact="event => startSelection(event, index)"
          @mouseenter="extendSelection(index)"
        >
          <input
            v-if="editIndex === index"
            class="location-input"
            :data-location-edit="index"
            :value="cellValue(index)"
            :disabled="disabled"
            @mousedown.stop
            @copy.stop
            @paste.stop
            @input="event => updateCell(index, (event.target as HTMLInputElement).value)"
            @keydown="event => handleEditKeydown(event, index)"
            @blur="event => commitEdit(index, (event.target as HTMLInputElement).value)"
          >
          <span
            v-else
            class="location-display"
            @dblclick.stop="enterEdit(index)"
          >{{ cellValue(index) }}</span>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.location-names-editor {
  width: 100%;
}

.location-grid {
  display: grid;
  grid-template-columns: repeat(var(--location-columns), minmax(96px, 1fr));
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  overflow: auto;
  background: var(--bg-card);
}

.location-header,
.location-cell {
  min-width: 0;
  height: 30px;
  border: 0;
  border-right: 1px solid var(--border-color);
  border-bottom: 1px solid var(--border-color);
  font-size: 12px;
  line-height: 1.2;
}

.location-header {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 6px;
  color: var(--text-primary);
  background: var(--cell-yellow-ui);
  font-weight: 600;
  white-space: nowrap;
}

.location-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-primary);
  background: var(--cell-green-ui);
  outline: none;
  user-select: none;
}

.location-display {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  padding: 0 7px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: default;
}

.location-input {
  width: 100%;
  height: 100%;
  padding: 0 7px;
  border: 0;
  color: var(--text-primary);
  background: var(--cell-green-ui);
  outline: none;
  text-align: center;
}

.location-cell.selected {
  background: hsla(217, 72%, 50%, 0.14);
  box-shadow: inset 0 0 0 1px var(--color-primary);
}

.location-cell.selected .location-input,
.location-input:focus {
  background: var(--cell-green-ui);
  box-shadow: inset 0 0 0 2px var(--color-primary);
}

.location-input:disabled,
.location-cell:has(.location-input:disabled) {
  color: var(--text-tertiary);
  background: var(--bg-elevated);
}
</style>
