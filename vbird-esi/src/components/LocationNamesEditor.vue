<script setup lang="ts">
import { computed } from 'vue'

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

function cellValue(index: number): string {
  return cleanedNames.value[index] ?? ''
}

function updateCell(index: number, value: string) {
  const next = cleanedNames.value.slice()
  while (next.length <= index) next.push('')
  next[index] = value
  emitNames(next)
}

function handlePaste(event: ClipboardEvent, index: number) {
  const text = event.clipboardData?.getData('text/plain') ?? ''
  const pasted = parsePastedNames(text)
  if (pasted.length === 0) return

  event.preventDefault()
  if (index === 0) {
    emitNames(pasted)
    return
  }

  const next = cleanedNames.value.slice()
  while (next.length < index) next.push('')
  next.splice(index, pasted.length, ...pasted)
  emitNames(next)
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

function parsePastedNames(text: string): string[] {
  return text
    .split(/[\t\r\n,，、;；]+/)
    .map(name => name.trim())
    .filter(Boolean)
}
</script>

<template>
  <div class="location-names-editor">
    <div class="location-grid" :style="gridStyle">
      <div
        v-for="col in columnCount"
        :key="`header-${col}`"
        class="location-header"
      >
        检测部位{{ col }}
      </div>
      <template v-for="row in gridRows" :key="row[0]">
        <input
          v-for="index in row"
          :key="index"
          class="location-input"
          :value="cellValue(index)"
          :disabled="disabled"
          @input="event => updateCell(index, (event.target as HTMLInputElement).value)"
          @paste="event => handlePaste(event, index)"
        >
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
.location-input {
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

.location-input {
  padding: 0 7px;
  color: var(--text-primary);
  background: var(--cell-green-ui);
  outline: none;
}

.location-input:focus {
  box-shadow: inset 0 0 0 1px var(--color-primary);
}

.location-input:disabled {
  color: var(--text-tertiary);
  background: var(--bg-elevated);
}
</style>
