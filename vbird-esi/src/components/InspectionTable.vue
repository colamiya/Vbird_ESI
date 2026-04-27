<script setup lang="ts">
/**
 * InspectionTable — L1 点检表数据录入组件 v2
 * 交互：单击选中，双击进入编辑；拖拽框选多格；Ctrl+D/R填充；Delete清空
 * 切割：全程自动（每段6地点，优先上下，超A4高度左右换列）
 */
import { computed, watch, ref, nextTick, reactive, onBeforeUnmount } from 'vue'
import { ElMessageBox, ElMessage } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import type { L1Template } from '@/types/template'
import type { InspectionTableData, Checkpoint } from '@/types/project'
import { generateId } from '@/utils/id'
import SegmentLayoutEditor from '@/components/SegmentLayoutEditor.vue'
import {
  getOrMigrateLayout,
  buildLayoutGrid,
  type SegmentInfo,
} from '@/utils/segmentLayout'
import { isEffectiveValue, isPassed } from '@/utils/numericRule'

const props = defineProps<{
  template: L1Template
  data: InspectionTableData
  headerInfo?: { companyName: string }
}>()

const emit = defineEmits<{ (e: 'update', data: InspectionTableData): void }>()

// ---- Undo 栈 ----
const MAX_UNDO = 50
const undoStack = ref<string[]>([])
function pushUndoSnapshot() {
  undoStack.value.push(JSON.stringify(props.data))
  if (undoStack.value.length > MAX_UNDO) undoStack.value.shift()
}
function undo() {
  if (!undoStack.value.length) { ElMessage.info('没有可撤销的操作'); return }
  Object.assign(props.data, JSON.parse(undoStack.value.pop()!))
  emitUpdate()
  ElMessage.success('已撤销')
}

// ---- 检查项 ----
const items = computed(() => props.template.inspectionItems)

// ---- 行合并 ----
interface GroupMerge { groupId: string; groupName: string; startIdx: number; count: number }
const groupMerges = computed((): GroupMerge[] => {
  const merges: GroupMerge[] = []
  let i = 0
  while (i < items.value.length) {
    const gid = items.value[i].groupId
    let count = 1
    while (i + count < items.value.length && items.value[i + count].groupId === gid) count++
    merges.push({ groupId: gid, groupName: items.value[i].groupName, startIdx: i, count })
    i += count
  }
  return merges
})
function isGroupFirstRow(rowIdx: number) { return groupMerges.value.some(m => m.startIdx === rowIdx) }
function getRowspan(rowIdx: number) { return groupMerges.value.find(m => m.startIdx === rowIdx)?.count ?? 1 }
function isGroupMergedRow(rowIdx: number) { return groupMerges.value.some(m => rowIdx > m.startIdx && rowIdx < m.startIdx + m.count) }

// ============================
// 选区状态机
// ============================
interface CellPos { row: number; col: number }
const selAnchor  = ref<CellPos | null>(null)
const selCurrent = ref<CellPos | null>(null)
const editRow = ref(-1)
const editCol = ref(-1)
const tableWrapperRef = ref<HTMLElement | null>(null)

// ---- 右键上下文菜单状态 ----
const ctxMenu = ref<{ visible: boolean; x: number; y: number; cpIdx: number }>({ visible: false, x: 0, y: 0, cpIdx: -1 })
let _ctxHideHandler: (() => void) | null = null

// 故障行选区（列索引，-1 = 未选中）
const faultAnchor = ref(-1)
const faultCurrent = ref(-1)
// 检查点表头选区（列索引，-1 = 未选中）
const headerAnchor = ref(-1)
const headerCurrent = ref(-1)
// 当前哪一行区域处于活跃状态
type ActiveRegion = 'data' | 'fault' | 'header'
const activeRegion = ref<ActiveRegion>('data')

function normalizedSel() {
  const a = selAnchor.value, c = selCurrent.value ?? selAnchor.value
  if (!a || !c) return null
  return { r1: Math.min(a.row,c.row), r2: Math.max(a.row,c.row), c1: Math.min(a.col,c.col), c2: Math.max(a.col,c.col) }
}
function normalizedFaultSel() {
  if (faultAnchor.value < 0) return null
  const c = faultCurrent.value < 0 ? faultAnchor.value : faultCurrent.value
  return { c1: Math.min(faultAnchor.value, c), c2: Math.max(faultAnchor.value, c) }
}
function normalizedHeaderSel() {
  if (headerAnchor.value < 0) return null
  const c = headerCurrent.value < 0 ? headerAnchor.value : headerCurrent.value
  return { c1: Math.min(headerAnchor.value, c), c2: Math.max(headerAnchor.value, c) }
}
function isInSelection(row: number, col: number) {
  if (activeRegion.value !== 'data') return false
  const s = normalizedSel(); if (!s) return false
  return row >= s.r1 && row <= s.r2 && col >= s.c1 && col <= s.c2
}
function isFaultSelected(cpIdx: number) {
  if (activeRegion.value !== 'fault') return false
  const s = normalizedFaultSel(); if (!s) return false
  return cpIdx >= s.c1 && cpIdx <= s.c2
}
function isHeaderSelected(cpIdx: number) {
  if (activeRegion.value !== 'header') return false
  const s = normalizedHeaderSel(); if (!s) return false
  return cpIdx >= s.c1 && cpIdx <= s.c2
}
function isFillHandleCorner(row: number, col: number) {
  const s = normalizedSel(); if (!s || editRow.value !== -1) return false
  return row === s.r2 && col === s.c2
}
function focusWrapper() { nextTick(() => tableWrapperRef.value?.focus({ preventScroll: true })) }
function exitEditMode() { editRow.value = -1; editCol.value = -1 }

// ---- 单击选中 ----
function onCellClick(row: number, col: number, e: MouseEvent) {
  if (e.shiftKey && selAnchor.value) { selCurrent.value = { row, col } }
  else { selAnchor.value = { row, col }; selCurrent.value = { row, col } }
  exitEditMode(); exitHeaderEdit(); exitFaultEdit()
  fillMenuCol.value = -1
  clearNonDataSel(); activeRegion.value = 'data'
  focusWrapper()
}

// ---- 双击进入编辑 ----
function onCellDblclick(row: number, col: number) {
  pushUndoSnapshot()
  selAnchor.value = { row, col }; selCurrent.value = { row, col }
  editRow.value = row; editCol.value = col
  nextTick(() => {
    const el = document.querySelector(`[data-edit="${row}-${col}"]`) as HTMLElement
    el?.focus(); if (el instanceof HTMLInputElement) el.select()
  })
}

// ---- 数据单元格拖拽框选 ----
let _selMoveHandler: ((e: MouseEvent) => void) | null = null
let _selUpHandler: (() => void) | null = null
function startSelDrag(row: number, col: number, e: MouseEvent) {
  if (e.button !== 0) return
  selAnchor.value = { row, col }; selCurrent.value = { row, col }
  exitEditMode(); exitHeaderEdit(); exitFaultEdit()
  fillMenuCol.value = -1
  clearNonDataSel(); activeRegion.value = 'data'
  _selMoveHandler = (ev: MouseEvent) => {
    const tgt = (ev.target as HTMLElement)?.closest('[data-cell]') as HTMLElement
    if (tgt?.dataset?.cell) { const [r,c] = tgt.dataset.cell.split('-').map(Number); selCurrent.value = { row:r, col:c } }
  }
  _selUpHandler = () => { cleanupSelListeners(); focusWrapper() }
  document.addEventListener('mousemove', _selMoveHandler)
  document.addEventListener('mouseup', _selUpHandler)
}
function cleanupSelListeners() {
  if (_selMoveHandler) { document.removeEventListener('mousemove', _selMoveHandler); _selMoveHandler = null }
  if (_selUpHandler) { document.removeEventListener('mouseup', _selUpHandler); _selUpHandler = null }
}

// ---- 故障行拖拽选列 ----
let _faultMoveH: ((e: MouseEvent) => void) | null = null
let _faultUpH: (() => void) | null = null
function startFaultDrag(cpIdx: number) {
  selAnchor.value = null; selCurrent.value = null
  editFaultCol.value = -1  // 退出故障编辑态
  exitHeaderEdit(); clearHeaderSel(); activeRegion.value = 'fault'
  faultAnchor.value = cpIdx; faultCurrent.value = cpIdx
  _faultMoveH = (ev: MouseEvent) => {
    const tgt = (ev.target as HTMLElement)?.closest('[data-fault]') as HTMLElement
    if (tgt?.dataset?.fault !== undefined) faultCurrent.value = +tgt.dataset.fault
  }
  _faultUpH = () => { cleanupFaultDrag(); focusWrapper() }
  document.addEventListener('mousemove', _faultMoveH)
  document.addEventListener('mouseup', _faultUpH)
}
function cleanupFaultDrag() {
  if (_faultMoveH) { document.removeEventListener('mousemove', _faultMoveH); _faultMoveH = null }
  if (_faultUpH) { document.removeEventListener('mouseup', _faultUpH); _faultUpH = null }
}
function clearFaultSel() { faultAnchor.value = -1; faultCurrent.value = -1 }

// ---- 检查点表头拖拽选列 ----
let _headerMoveH: ((e: MouseEvent) => void) | null = null
let _headerUpH: (() => void) | null = null
function startHeaderDrag(cpIdx: number) {
  selAnchor.value = null; selCurrent.value = null
  editFaultCol.value = -1  // 退出故障编辑态
  exitHeaderEdit(); clearFaultSel(); activeRegion.value = 'header'
  headerAnchor.value = cpIdx; headerCurrent.value = cpIdx
  _headerMoveH = (ev: MouseEvent) => {
    const tgt = (ev.target as HTMLElement)?.closest('[data-header]') as HTMLElement
    if (tgt?.dataset?.header !== undefined) headerCurrent.value = +tgt.dataset.header
  }
  _headerUpH = () => { cleanupHeaderDrag(); focusWrapper() }
  document.addEventListener('mousemove', _headerMoveH)
  document.addEventListener('mouseup', _headerUpH)
}
function cleanupHeaderDrag() {
  if (_headerMoveH) { document.removeEventListener('mousemove', _headerMoveH); _headerMoveH = null }
  if (_headerUpH) { document.removeEventListener('mouseup', _headerUpH); _headerUpH = null }
}
function clearHeaderSel() { headerAnchor.value = -1; headerCurrent.value = -1 }
function clearNonDataSel() { clearFaultSel(); clearHeaderSel() }

// ---- 检查点表头编辑模式（-1 = 显示态，其他 = 正在编辑的列索引） ----
const editHeaderCol = ref(-1)
function enterHeaderEdit(cpIdx: number) {
  editHeaderCol.value = cpIdx
  nextTick(() => {
    const el = document.querySelector(`[data-header-input="${cpIdx}"]`) as HTMLInputElement
    el?.focus(); el?.select()
  })
}
function exitHeaderEdit() { editHeaderCol.value = -1 }

// ---- 故障行编辑模式（-1 = 显示态，其他 = 正在编辑的列索引） ----
const editFaultCol = ref(-1)
function enterFaultEdit(cpIdx: number) {
  editFaultCol.value = cpIdx
  nextTick(() => {
    const el = document.querySelector(`[data-fault-select="${cpIdx}"]`) as HTMLSelectElement
    if (el) {
      el.focus()
      // 尝试展开下拉（WebView2 支持 showPicker）
      try { (el as any).showPicker?.() } catch { el.click() }
    }
  })
}
function exitFaultEdit() { editFaultCol.value = -1; focusWrapper() }

// ---- 表格级键盘导航（非编辑态） ----
function handleTableKeydown(e: KeyboardEvent) {
  if (editRow.value !== -1) return
  // Ctrl+C/V/Z 全区域通用
  if (e.ctrlKey && e.key === 'c') { e.preventDefault(); copySelection(); return }
  if (e.ctrlKey && e.key === 'v') { e.preventDefault(); pasteSelection(); return }
  if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undo(); return }
  // Delete 全区域通用
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); clearSelection(); return }
  // 以下仅数据区有效
  if (activeRegion.value !== 'data' || !selAnchor.value) return
  if (e.key === 'ArrowDown')  { e.preventDefault(); moveAnchor(1,0,e.shiftKey) }
  else if (e.key === 'ArrowUp')   { e.preventDefault(); moveAnchor(-1,0,e.shiftKey) }
  else if (e.key === 'ArrowRight') { e.preventDefault(); moveAnchor(0,1,e.shiftKey) }
  else if (e.key === 'ArrowLeft')  { e.preventDefault(); moveAnchor(0,-1,e.shiftKey) }
  else if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); onCellDblclick(selAnchor.value.row, selAnchor.value.col) }
  else if (e.key === 'Tab') { e.preventDefault(); moveAnchor(0, e.shiftKey ? -1 : 1, false) }
}
function moveAnchor(dr: number, dc: number, extend: boolean) {
  const maxR = items.value.length-1, maxC = props.data.checkpoints.length-1
  if (!selAnchor.value) return
  if (extend) {
    const cur = selCurrent.value ?? selAnchor.value
    selCurrent.value = { row: Math.min(Math.max(cur.row+dr,0),maxR), col: Math.min(Math.max(cur.col+dc,0),maxC) }
  } else {
    const n = { row: Math.min(Math.max(selAnchor.value.row+dr,0),maxR), col: Math.min(Math.max(selAnchor.value.col+dc,0),maxC) }
    selAnchor.value = n; selCurrent.value = n
  }
}

// ---- 编辑态键盘 ----
function handleEditKeydown(e: KeyboardEvent, rowIdx: number, cpIdx: number) {
  const maxR = items.value.length-1, maxC = props.data.checkpoints.length-1
  if (e.key === 'Enter') {
    e.preventDefault()
    const el = e.target as HTMLInputElement
    if (el.tagName === 'INPUT') updateCell(rowIdx, cpIdx, el.value || null)
    exitEditMode()
    const nr = Math.min(rowIdx+1, maxR)
    selAnchor.value = { row:nr, col:cpIdx }; selCurrent.value = { row:nr, col:cpIdx }
    if (nr !== rowIdx) { pushUndoSnapshot(); editRow.value=nr; editCol.value=cpIdx; nextTick(()=>{ const el=document.querySelector(`[data-edit="${nr}-${cpIdx}"]`) as HTMLElement; el?.focus(); if(el instanceof HTMLInputElement) el.select() }) }
    else focusWrapper()
  } else if (e.key === 'Tab') {
    e.preventDefault()
    const el = e.target as HTMLInputElement
    if (el.tagName === 'INPUT') updateCell(rowIdx, cpIdx, el.value || null)
    exitEditMode()
    const nc = e.shiftKey ? cpIdx-1 : cpIdx+1
    if (nc >= 0 && nc <= maxC) {
      selAnchor.value = { row:rowIdx, col:nc }; selCurrent.value = { row:rowIdx, col:nc }
      pushUndoSnapshot(); editRow.value=rowIdx; editCol.value=nc
      nextTick(()=>{ const el=document.querySelector(`[data-edit="${rowIdx}-${nc}"]`) as HTMLElement; el?.focus(); if(el instanceof HTMLInputElement) el.select() })
    } else focusWrapper()
  } else if (e.key === 'Escape') { e.preventDefault(); exitEditMode(); focusWrapper() }
  else if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undo() }
}

// ---- Copy / Paste / Delete（Excel TSV 兼容） ----
function ensureRow(r: number) { while (props.data.values.length <= r) props.data.values.push(new Array(props.data.checkpoints.length).fill(null)) }

/**
 * Ctrl+C：将当前活跃区域复制为 TSV（Tab/\n 分隔）写入剪贴板
 * 支持数据单元格区、故障行、检查点表头三种区域
 */
async function copySelection() {
  // 故障行模式
  if (activeRegion.value === 'fault') {
    const s = normalizedFaultSel()
    if (!s) { ElMessage.info('请先选中故障行单元格'); return }
    const cells = []
    for (let c = s.c1; c <= s.c2; c++) cells.push(props.data.faultValues[c] ?? '')
    try {
      await navigator.clipboard.writeText(cells.join('\t'))
      ElMessage.success(cells.length === 1 ? '已复制故障値' : `已复制 ${cells.length} 个故障値`)
    } catch { ElMessage.error('复制失败') }
    return
  }
  // 检查点表头模式
  if (activeRegion.value === 'header') {
    const s = normalizedHeaderSel()
    if (!s) { ElMessage.info('请先选中检查点列头'); return }
    const cells = []
    for (let c = s.c1; c <= s.c2; c++) cells.push(props.data.checkpoints[c]?.name ?? '')
    try {
      await navigator.clipboard.writeText(cells.join('\t'))
      ElMessage.success(cells.length === 1 ? '已复制检查点名' : `已复制 ${cells.length} 个检查点名`)
    } catch { ElMessage.error('复制失败') }
    return
  }
  // 数据单元格模式
  const s = normalizedSel()
  if (!s) { ElMessage.info('请先选中单元格区域'); return }
  const rows: string[] = []
  for (let r = s.r1; r <= s.r2; r++) {
    const cells: string[] = []
    for (let c = s.c1; c <= s.c2; c++) {
      const val = props.data.values[r]?.[c]
      cells.push(val === null || val === undefined ? '' : String(val))
    }
    rows.push(cells.join('\t'))
  }
  try {
    await navigator.clipboard.writeText(rows.join('\n'))
    const rowCount = s.r2 - s.r1 + 1
    const colCount = s.c2 - s.c1 + 1
    ElMessage.success(rowCount === 1 && colCount === 1 ? '已复制单元格' : `已复制 ${rowCount}×${colCount} 区域`)
  } catch {
    ElMessage.error('复制失败：剪贴板权限被拒绝')
  }
}

/**
 * Ctrl+V：从系统剪贴板读取 TSV 并粘贴
 * - 单格内容 → 广播到整个选区（和 Excel Ctrl+V 后 Enter 行为相同）
 * - 多格 TSV（含 Tab/换行）→ 从选区左上角开始写入，边界自动截断
 * - 支持故障行、检查点表头粘贴
 */
async function pasteSelection() {
  let text = ''
  try { text = await navigator.clipboard.readText() } catch { ElMessage.error('粘贴失败：剪贴板权限被拒绝'); return }
  if (!text) return

  // 解析 TSV（去掉 Windows \r，过滤末尾空行）
  const clipRows = text
    .replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    .split('\n')
    .filter((row, idx, arr) => !(idx === arr.length - 1 && row === ''))
    .map(row => row.split('\t').map(v => v === '' ? null : v))
  const clipRowCount = clipRows.length
  const clipColCount = Math.max(...clipRows.map(r => r.length))
  const isOneCell = clipRowCount === 1 && clipColCount === 1

  // ---- 故障行粘贴 ----
  if (activeRegion.value === 'fault') {
    if (faultAnchor.value < 0) { ElMessage.info('请先选中故障行单元格'); return }
    const s = normalizedFaultSel()
    const start = s?.c1 ?? faultAnchor.value
    const end = s?.c2 ?? faultAnchor.value
    pushUndoSnapshot()
    if (isOneCell) {
      // 单格广播到整个故障选区
      const v = (clipRows[0][0] ?? null) as string | null
      for (let c = start; c <= end && c < props.data.checkpoints.length; c++)
        props.data.faultValues[c] = v
    } else {
      // 从锦点开始写入单行
      const vals = clipRows[0]
      const anchor = faultAnchor.value
      for (let ci = 0; ci < vals.length && anchor + ci < props.data.checkpoints.length; ci++)
        props.data.faultValues[anchor + ci] = (vals[ci] ?? null) as string | null
      faultCurrent.value = Math.min(anchor + vals.length - 1, props.data.checkpoints.length - 1)
    }
    emitUpdate(); ElMessage.success('已粘贴到故障行')
    return
  }

  // ---- 检查点表头粘贴 ----
  if (activeRegion.value === 'header') {
    if (headerAnchor.value < 0) { ElMessage.info('请先选中检查点列头'); return }
    const s = normalizedHeaderSel()
    const start = s?.c1 ?? headerAnchor.value
    const end = s?.c2 ?? headerAnchor.value
    if (isOneCell) {
      const name = clipRows[0][0] ?? ''
      for (let c = start; c <= end && c < props.data.checkpoints.length; c++)
        renameCheckpoint(c, name as string)
    } else {
      const vals = clipRows[0]
      const anchor = headerAnchor.value
      for (let ci = 0; ci < vals.length && anchor + ci < props.data.checkpoints.length; ci++)
        renameCheckpoint(anchor + ci, (vals[ci] ?? '') as string)
      headerCurrent.value = Math.min(anchor + vals.length - 1, props.data.checkpoints.length - 1)
    }
    ElMessage.success('已粘贴到检查点名')
    return
  }

  // ---- 数据单元格粘贴 ----
  if (!selAnchor.value) { ElMessage.info('请先选中目标单元格'); return }
  const maxR = items.value.length - 1
  const maxC = props.data.checkpoints.length - 1
  const s = normalizedSel()
  const anchRow = selAnchor.value.row
  const anchCol = selAnchor.value.col
  pushUndoSnapshot()

  if (isOneCell) {
    const val = clipRows[0][0] ?? null
    const r1 = s?.r1 ?? anchRow, r2 = s?.r2 ?? anchRow
    const c1 = s?.c1 ?? anchCol, c2 = s?.c2 ?? anchCol
    for (let r = r1; r <= r2; r++) {
      ensureRow(r)
      for (let c = c1; c <= c2 && c <= maxC; c++) props.data.values[r][c] = val
    }
    emitUpdate(); ElMessage.success(`已粘贴到 ${r2-r1+1}×${c2-c1+1} 区域`)
  } else {
    let pastedRows = 0, pastedCols = 0
    for (let ri = 0; ri < clipRowCount; ri++) {
      const r = anchRow + ri
      if (r > maxR) break
      ensureRow(r)
      const rowData = clipRows[ri]
      for (let ci = 0; ci < rowData.length; ci++) {
        const c = anchCol + ci
        if (c > maxC) break
        props.data.values[r][c] = rowData[ci]
        pastedCols = Math.max(pastedCols, ci + 1)
      }
      pastedRows = ri + 1
    }
    selAnchor.value = { row: anchRow, col: anchCol }
    selCurrent.value = {
      row: Math.min(anchRow + pastedRows - 1, maxR),
      col: Math.min(anchCol + pastedCols - 1, maxC),
    }
    emitUpdate(); ElMessage.success(`已粘贴 ${pastedRows}×${pastedCols} 区域`)
  }
}

function clearSelection() {
  // 故障行清空
  if (activeRegion.value === 'fault') {
    const s = normalizedFaultSel(); if (!s) return
    pushUndoSnapshot()
    for (let c = s.c1; c <= s.c2; c++) props.data.faultValues[c] = null
    emitUpdate(); return
  }
  // 检查点表头清空
  if (activeRegion.value === 'header') {
    const s = normalizedHeaderSel(); if (!s) return
    for (let c = s.c1; c <= s.c2; c++) renameCheckpoint(c, '')
    return
  }
  // 数据单元格清空
  const s = normalizedSel(); if (!s) return
  pushUndoSnapshot()
  for (let r=s.r1;r<=s.r2;r++) { ensureRow(r); for (let c=s.c1;c<=s.c2;c++) props.data.values[r][c]=null }
  emitUpdate()
}

// ============================
// 填充柄（拖拽，从选区右下角出发）
// ============================
const isDragging = ref(false)
const dragEndRow = ref(-1), dragEndCol = ref(-1)
const dragSourceRow = ref(-1), dragSourceCol = ref(-1)
const dragSourceValue = ref<string|number|null>(null)
let _dragMoveHandler: ((e: MouseEvent) => void) | null = null
let _dragUpHandler: (() => void) | null = null

function handleFillHandleDown(e: MouseEvent, cornerRow: number, cornerCol: number) {
  e.preventDefault(); e.stopPropagation()
  pushUndoSnapshot()
  isDragging.value = true
  const anchor = selAnchor.value ?? { row:cornerRow, col:cornerCol }
  dragSourceRow.value = anchor.row; dragSourceCol.value = anchor.col
  dragEndRow.value = cornerRow; dragEndCol.value = cornerCol
  dragSourceValue.value = props.data.values[anchor.row]?.[anchor.col] ?? null
  const maxR = items.value.length-1, maxC = props.data.checkpoints.length-1
  _dragMoveHandler = (ev: MouseEvent) => {
    const tgt = (ev.target as HTMLElement)?.closest('[data-cell]') as HTMLElement
    if (tgt?.dataset?.cell) { const [r,c]=tgt.dataset.cell.split('-').map(Number); dragEndRow.value=Math.min(Math.max(r,0),maxR); dragEndCol.value=Math.min(Math.max(c,0),maxC) }
  }
  _dragUpHandler = () => { cleanupDragListeners(); applyDragFill(); isDragging.value=false; focusWrapper() }
  document.addEventListener('mousemove', _dragMoveHandler)
  document.addEventListener('mouseup', _dragUpHandler)
}
function cleanupDragListeners() {
  if (_dragMoveHandler) { document.removeEventListener('mousemove', _dragMoveHandler); _dragMoveHandler=null }
  if (_dragUpHandler) { document.removeEventListener('mouseup', _dragUpHandler); _dragUpHandler=null }
}
function applyDragFill() {
  const s = normalizedSel()
  const r1 = Math.min(s?.r1 ?? dragSourceRow.value, dragEndRow.value)
  const r2 = Math.max(s?.r2 ?? dragSourceRow.value, dragEndRow.value)
  const c1 = Math.min(s?.c1 ?? dragSourceCol.value, dragEndCol.value)
  const c2 = Math.max(s?.c2 ?? dragSourceCol.value, dragEndCol.value)
  const val = dragSourceValue.value
  let changed = false
  for (let r=r1;r<=r2;r++) for (let c=c1;c<=c2;c++) { if (r<items.value.length && c<props.data.checkpoints.length) { ensureRow(r); props.data.values[r][c]=val; changed=true } }
  if (changed) { selAnchor.value={row:r1,col:c1}; selCurrent.value={row:r2,col:c2}; emitUpdate() }
}
function isInDragRange(rowIdx: number, cpIdx: number) {
  if (!isDragging.value) return false
  const s = normalizedSel()
  const r1=Math.min(s?.r1??dragSourceRow.value,dragEndRow.value), r2=Math.max(s?.r2??dragSourceRow.value,dragEndRow.value)
  const c1=Math.min(s?.c1??dragSourceCol.value,dragEndCol.value), c2=Math.max(s?.c2??dragSourceCol.value,dragEndCol.value)
  return rowIdx>=r1&&rowIdx<=r2&&cpIdx>=c1&&cpIdx<=c2
}

// NOTE: onBeforeUnmount 已合并到列宽拖拽区块末尾，统一清理所有 document 事件

// ============================
// 检查点列管理
// ============================
function addCheckpoint() {
  pushUndoSnapshot()
  const cp: Checkpoint = { id: generateId(), name: `地点${props.data.checkpoints.length+1}` }
  props.data.checkpoints.push(cp)
  for (const row of props.data.values) row.push(null)
  props.data.faultValues.push(null)
  emitUpdate()
}
async function batchAddCheckpoints() {
  try {
    const { value } = await ElMessageBox.prompt('请输入地点/设备数量', '批量添加检查点', {
      inputPattern: /^[1-9]\d*$/, inputErrorMessage: '请输入正整数', inputValue: '6', confirmButtonText: '添加',
    })
    const count = parseInt(value); if (count<=0||count>200) return
    pushUndoSnapshot()
    const startIdx = props.data.checkpoints.length
    for (let i=0;i<count;i++) {
      props.data.checkpoints.push({ id:generateId(), name:`地点${startIdx+i+1}` })
      for (const row of props.data.values) row.push(null)
      props.data.faultValues.push(null)
    }
    emitUpdate(); ElMessage.success(`已添加 ${count} 个检查点`)
  } catch { /* 取消 */ }
}
async function removeCheckpoint(cpIndex: number) {
  if (!props.data.checkpoints.length) return
  const name = props.data.checkpoints[cpIndex]?.name ?? `检查点${cpIndex+1}`
  try { await ElMessageBox.confirm(`确定删除检查点「${name}」？该列所有数据将不可恢复。`, '删除确认', { type:'warning', confirmButtonText:'删除', cancelButtonText:'取消' }) } catch { return }
  pushUndoSnapshot()
  props.data.checkpoints.splice(cpIndex, 1)
  for (const row of props.data.values) row.splice(cpIndex, 1)
  props.data.faultValues.splice(cpIndex, 1)
  props.data.segmentBreaks = (props.data.segmentBreaks ?? []).filter(b => b !== cpIndex).map(b => b > cpIndex ? b - 1 : b)
  props.data.rowBreaks = (props.data.rowBreaks ?? []).filter(b => b !== cpIndex).map(b => b > cpIndex ? b - 1 : b)
  props.data.segmentLayout = undefined  // 删列后强制从新 segmentBreaks 重新推导布局
  selAnchor.value = null; selCurrent.value = null
  emitUpdate()
}
function renameCheckpoint(cpIndex: number, newName: string) {
  if (props.data.checkpoints[cpIndex].name === newName) return
  props.data.checkpoints[cpIndex].name = newName
  emitUpdate()
}

/** 在指定列索引之后插入一列新检查点（右键菜单 / 快捷键） */
function insertCheckpointAfter(cpIdx: number) {
  pushUndoSnapshot()
  const newIdx = cpIdx + 1
  const cp: Checkpoint = { id: generateId(), name: `地点${props.data.checkpoints.length + 1}` }
  props.data.checkpoints.splice(newIdx, 0, cp)
  for (const row of props.data.values) row.splice(newIdx, 0, null)
  props.data.faultValues.splice(newIdx, 0, null)
  // segmentBreaks / rowBreaks 中大于等于 newIdx 的位置全部右移 1
  props.data.segmentBreaks = (props.data.segmentBreaks ?? []).map(b => b >= newIdx ? b + 1 : b)
  props.data.rowBreaks = (props.data.rowBreaks ?? []).map(b => b >= newIdx ? b + 1 : b)
  props.data.segmentLayout = undefined  // 列变化后强制重新推导布局
  emitUpdate()
  ElMessage.success(`已插入「${cp.name}」`)
}

// ============================
// 右键上下文菜单
// ============================
function showCtxMenu(e: MouseEvent, cpIdx: number) {
  // 在表头区选中该列
  selAnchor.value = null; selCurrent.value = null
  exitEditMode(); exitFaultEdit()
  clearFaultSel(); fillMenuCol.value = -1
  headerAnchor.value = cpIdx; headerCurrent.value = cpIdx
  activeRegion.value = 'header'
  ctxMenu.value = { visible: true, x: e.clientX, y: e.clientY, cpIdx }
  // 注册一次性点击外部关闭
  if (_ctxHideHandler) document.removeEventListener('click', _ctxHideHandler)
  _ctxHideHandler = hideCtxMenu
  nextTick(() => document.addEventListener('click', _ctxHideHandler!))
}
function hideCtxMenu() {
  ctxMenu.value.visible = false
  if (_ctxHideHandler) { document.removeEventListener('click', _ctxHideHandler); _ctxHideHandler = null }
}
async function ctxDeleteColumn() {
  const idx = ctxMenu.value.cpIdx
  hideCtxMenu()
  await removeCheckpoint(idx)
}
function ctxInsertColumnAfter() {
  const idx = ctxMenu.value.cpIdx
  hideCtxMenu()
  insertCheckpointAfter(idx)
}

// ============================
// 列头一键填充（▼菜单）
// ============================
const fillMenuCol = ref(-1)
function toggleFillMenu(cpIdx: number) { fillMenuCol.value = fillMenuCol.value===cpIdx ? -1 : cpIdx }
function fillColumn(cpIdx: number, value: string) {
  pushUndoSnapshot()
  for (let r=0;r<items.value.length;r++) { ensureRow(r); props.data.values[r][cpIdx]=value }
  emitUpdate(); ElMessage.success(`已将整列填充为「${value}」`); fillMenuCol.value=-1
}
function getFillOptions(): string[] {
  const opts = new Set<string>()
  for (const item of items.value) {
    if (item.validationType==='text') { opts.add('符合'); opts.add('不符合'); opts.add('/') }
  }
  opts.add('/')
  return [...opts]
}

// ============================
// 单元格数据
// ============================
const validationErrors = reactive<Record<string, string>>({})
function updateCell(rowIdx: number, cpIdx: number, value: string|number|null) {
  ensureRow(rowIdx)
  const item = items.value[rowIdx], key=`${rowIdx}-${cpIdx}`
  if (value && value!=='/' && item?.validationType==='numeric') {
    const num = Number(value); if (isNaN(num)) { validationErrors[key]='请输入数值'; return }
    if (item.numericRange) {
      if (num<item.numericRange.min||num>item.numericRange.max) validationErrors[key]=`范围: ${item.numericRange.min}-${item.numericRange.max}`
      else delete validationErrors[key]
    } else delete validationErrors[key]
    props.data.values[rowIdx][cpIdx]=num
  } else { delete validationErrors[key]; props.data.values[rowIdx][cpIdx]=value }
  emitUpdate()
}
function updateFault(cpIdx: number, value: string|null) { props.data.faultValues[cpIdx]=value; emitUpdate() }
// 使用 nextTick 防抖：同一 tick 内多次调用只触发一次 emit（避免 SegmentLayoutEditor
// 同步发 update-breaks + update-layout 导致父组件重复保存）
let _emitPending = false
function emitUpdate() {
  if (_emitPending) return
  _emitPending = true
  nextTick(() => {
    _emitPending = false
    emit('update', props.data)
  })
}
function getTextOptions(item: typeof items.value[number]): string[] {
  if (item.validationType==='text') return ['符合', '不符合', '/']
  return []
}
function shouldUseSelect(rowIdx: number) { return getTextOptions(items.value[rowIdx]).length>0 }
function displayValue(rowIdx: number, cpIdx: number): string {
  const val = props.data.values[rowIdx]?.[cpIdx]
  return (val===null||val===undefined||val==='') ? '' : String(val)
}

// ============================
// 设备完好率
// ============================
function rowPassRate(rowIdx: number): string {
  const row=props.data.values[rowIdx]; if (!row||!row.length) return '-'
  const item = items.value[rowIdx]
  let t=0,p=0
  for (const v of row) {
    if (isEffectiveValue(v)) {
      t++
      if (item && isPassed(item, v)) p++
    }
  }
  return t===0?'-':((p/t)*100).toFixed(1)+'%'
}
/** 总设备完好率：基于 faultValues（是否故障），非故障检查点数 / 有效检查点总数 */
const totalPassRate = computed(() => {
  const valid = props.data.faultValues.filter(v => v!==null && v!==undefined && v!=='' && v!=='/')
  if (valid.length===0) return '-'
  const passed = valid.filter(v => v==='否').length
  return ((passed/valid.length)*100).toFixed(1)+'%'
})

watch(() => [items.value.length, props.data.checkpoints.length], () => {
  const rC=items.value.length, cC=props.data.checkpoints.length
  while (props.data.values.length<rC) props.data.values.push(new Array(cC).fill(null))
  while (props.data.faultValues.length<cC) props.data.faultValues.push(null)
}, { immediate: true })

function updateNotes(val: string) { props.data.notes = val; emitUpdate() }

// ============================
// 布局浏览（只读预览模式）
// ============================
const showLayoutEditor = ref(false)

const layoutGrid = computed((): SegmentInfo[][] => {
  const layout = getOrMigrateLayout(props.data)
  return buildLayoutGrid(layout, props.data.segmentBreaks ?? [], props.data.checkpoints.length)
})

function segCols(seg: SegmentInfo): number[] {
  return Array.from({ length: seg.endCol - seg.startCol + 1 }, (_, i) => seg.startCol + i)
}

const lastGridRowTotalDataCols = computed((): number => {
  const lastRow = layoutGrid.value[layoutGrid.value.length - 1] ?? []
  let total = 0
  lastRow.forEach((seg, i) => {
    if (i > 0) total += 1
    total += seg.endCol - seg.startCol + 1
  })
  return total
})

// ============================
// 列宽拖拽调整（Excel 风格）
// ============================
const MIN_COL_W = 48  // 最小列宽 px
const colResizing = ref<{ cpIdx: number; startX: number; startW: number } | null>(null)

function getColWidth(cpIdx: number): number {
  return props.data.colWidths?.[cpIdx] ?? props.template.columns.dataColumnWidth ?? 90
}

function onResizeHandleMousedown(e: MouseEvent, cpIdx: number) {
  e.preventDefault()
  e.stopPropagation()
  colResizing.value = { cpIdx, startX: e.clientX, startW: getColWidth(cpIdx) }
  document.body.style.userSelect = 'none'   // P1-3: 禁止框选干扰列宽拖拽
  document.addEventListener('mousemove', onResizeMousemove)
  document.addEventListener('mouseup', onResizeMouseup)
}

function onResizeMousemove(e: MouseEvent) {
  if (!colResizing.value) return
  const { cpIdx, startX, startW } = colResizing.value
  const delta = e.clientX - startX
  const newW = Math.max(MIN_COL_W, startW + delta)
  if (!props.data.colWidths) props.data.colWidths = []
  // 确保数组足够长
  while (props.data.colWidths.length <= cpIdx) props.data.colWidths.push(90)
  props.data.colWidths[cpIdx] = newW
}

function onResizeMouseup() {
  if (!colResizing.value) return
  colResizing.value = null
  document.body.style.userSelect = ''  // 恢复正常选择
  document.removeEventListener('mousemove', onResizeMousemove)
  document.removeEventListener('mouseup', onResizeMouseup)
  emitUpdate()
}

// 统一清理所有 document 级事件监听器（合并自旧的双 onBeforeUnmount block）
onBeforeUnmount(() => {
  // 填充柄 / 框选拖拽
  cleanupDragListeners()
  cleanupSelListeners()
  // 列宽拖拽
  document.removeEventListener('mousemove', onResizeMousemove)
  document.removeEventListener('mouseup', onResizeMouseup)
  // 故障行 / 检查点表头拖拽
  cleanupFaultDrag()
  cleanupHeaderDrag()
  // 右键菜单
  if (_ctxHideHandler) document.removeEventListener('click', _ctxHideHandler)
  // 重置拖拽状态
  isDragging.value = false
  fillMenuCol.value = -1
  ctxMenu.value.visible = false
})
</script>

<template>
  <div class="inspection-table">
    <!-- 表头信息 -->
    <div v-if="headerInfo?.companyName" class="table-company-header">{{ headerInfo.companyName }}</div>
    <div class="table-header-bar">
      <h4 class="table-title">
        <span class="title-label">设施名称：</span>
        <span class="title-value">{{ template.facilityName || template.name }}</span>
      </h4>
      <div class="table-actions">
        <el-button size="small" text :disabled="undoStack.length===0" @click="undo" title="撤销 (Ctrl+Z)">↩ 撤销</el-button>
        <el-button size="small" @click="batchAddCheckpoints">批量添加</el-button>
        <el-button type="primary" :icon="Plus" size="small" @click="addCheckpoint">添加检查点</el-button>
        <el-button size="small" :type="showLayoutEditor ? 'primary' : 'default'" @click="showLayoutEditor = !showLayoutEditor">
          {{ showLayoutEditor ? '关闭布局浏览' : '📐 布局浏览' }}
        </el-button>
      </div>
    </div>

    <!-- 操作提示 -->
    <div class="table-hint">
      <span>单击选中 · 双击编辑 · 拖拽框选区域 · <kbd>Ctrl+C</kbd> 复制 · <kbd>Ctrl+V</kbd> 粘贴（兼容 Excel）· <kbd>Delete</kbd> 清空 · 右下角 <span class="hint-handle">■</span> 拖动复制 · <b>拖动列头右边框</b>调列宽</span>
    </div>

    <!-- 布局浏览折叠面板（只读预览） -->
    <div v-if="showLayoutEditor" class="layout-editor-panel">
      <SegmentLayoutEditor
        :data="data"
        :template="template"
      />
    </div>

    <!-- 主表格区（多段分组渲染：每个 gridRow 一张 table） -->
    <div
      class="table-scroll-wrapper"
      ref="tableWrapperRef"
      tabindex="0"
      @keydown="handleTableKeydown"
      @mousedown.self="() => { selAnchor=null; selCurrent=null; exitEditMode() }"
    >
      <div class="segment-grid">
        <template v-for="(gridRow, gridRowIdx) in layoutGrid" :key="gridRowIdx">
          <table class="data-table seg-table" cellspacing="0" cellpadding="0">
            <thead>
              <tr>
                <th class="cell-red fixed-col col-seq">#</th>
                <th class="cell-red fixed-col col-item">检查项目</th>
                <th class="cell-red fixed-col col-req">技术要求</th>
                <template v-for="(seg, segIdxInRow) in gridRow" :key="seg.index">
                  <th v-if="segIdxInRow > 0" class="seg-divider-th"></th>
                  <th
                    v-for="cpIdx in segCols(seg)"
                    :key="cpIdx"
                    class="cell-yellow col-data"
                    :class="{ 'th-selected': isHeaderSelected(cpIdx) }"
                    :data-header="cpIdx"
                    :style="{ width: getColWidth(cpIdx)+'px', minWidth: getColWidth(cpIdx)+'px', position: 'relative' }"
                    @mousedown.left.exact="startHeaderDrag(cpIdx)"
                    @dblclick="enterHeaderEdit(cpIdx)"
                    @contextmenu.prevent.stop="showCtxMenu($event, cpIdx)"
                  >
                    <div class="cp-header">
                      <span v-if="editHeaderCol !== cpIdx" class="cp-name-display">{{ data.checkpoints[cpIdx]?.name || '(空)' }}</span>
                      <input v-else class="cp-name-input"
                        :data-header-input="cpIdx"
                        :value="data.checkpoints[cpIdx]?.name"
                        @mousedown.stop
                        @change="(e) => { renameCheckpoint(cpIdx, (e.target as HTMLInputElement).value); exitHeaderEdit() }"
                        @keydown.enter.stop="(e: KeyboardEvent) => { renameCheckpoint(cpIdx, (e.target as HTMLInputElement).value); exitHeaderEdit(); focusWrapper() }"
                        @keydown.escape.stop="() => { exitHeaderEdit(); focusWrapper() }"
                        @blur="exitHeaderEdit"
                      />
                      <button class="cp-fill-btn" @mousedown.stop @click="toggleFillMenu(cpIdx)" title="一键填充整列">▼</button>
                      <button class="cp-delete-btn" @mousedown.stop @click="removeCheckpoint(cpIdx)" title="删除此列">×</button>
                    </div>
                    <div v-if="fillMenuCol === cpIdx" class="fill-menu">
                      <div v-for="opt in getFillOptions()" :key="opt" class="fill-menu-item" @click="fillColumn(cpIdx, opt)">
                        全列填「{{ opt }}」
                      </div>
                    </div>
                    <div class="col-resize-handle"
                         @mousedown.stop="onResizeHandleMousedown($event, cpIdx)"
                         title="拖拽调整列宽"></div>
                  </th>
                </template>
                <th v-if="gridRowIdx === layoutGrid.length - 1" class="cell-red col-summary">设备完好率</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(item, rowIdx) in items" :key="item.id">
                <td v-if="isGroupFirstRow(rowIdx)" class="cell-red fixed-col col-seq" :rowspan="getRowspan(rowIdx)">
                  {{ groupMerges.findIndex(m => m.startIdx === rowIdx) + 1 }}
                </td>
                <td v-else-if="!isGroupMergedRow(rowIdx)" class="cell-red fixed-col col-seq">{{ rowIdx + 1 }}</td>
                <td v-if="isGroupFirstRow(rowIdx)" class="cell-yellow fixed-col col-item" :rowspan="getRowspan(rowIdx)">{{ item.groupName }}</td>
                <td v-else-if="!isGroupMergedRow(rowIdx)" class="cell-yellow fixed-col col-item">{{ item.groupName }}</td>
                <td class="cell-yellow fixed-col col-req">{{ item.requirement }}</td>
                <template v-for="(seg, segIdxInRow) in gridRow" :key="seg.index">
                  <td v-if="segIdxInRow > 0" class="seg-divider-td"></td>
                  <td
                    v-for="cpIdx in segCols(seg)"
                    :key="cpIdx"
                    class="cell-green col-data"
                    :class="{
                      'cell-selected': isInSelection(rowIdx, cpIdx),
                      'drag-highlight': isDragging && isInDragRange(rowIdx, cpIdx),
                    }"
                    :data-cell="`${rowIdx}-${cpIdx}`"
                    @mousedown.exact="startSelDrag(rowIdx, cpIdx, $event)"
                    @click="onCellClick(rowIdx, cpIdx, $event)"
                    @dblclick="onCellDblclick(rowIdx, cpIdx)"
                  >
                    <div class="cell-wrapper">
                      <select
                        v-if="editRow === rowIdx && editCol === cpIdx && shouldUseSelect(rowIdx)"
                        class="cell-select"
                        :data-edit="`${rowIdx}-${cpIdx}`"
                        :value="data.values[rowIdx]?.[cpIdx] ?? ''"
                        @mousedown.stop @click.stop
                        @change="(e) => { updateCell(rowIdx, cpIdx, (e.target as HTMLSelectElement).value || null); exitEditMode(); focusWrapper() }"
                        @keydown="(e) => handleEditKeydown(e, rowIdx, cpIdx)"
                      >
                        <option value="">-</option>
                        <option v-for="opt in getTextOptions(item)" :key="opt" :value="opt">{{ opt }}</option>
                      </select>
                      <input
                        v-else-if="editRow === rowIdx && editCol === cpIdx"
                        class="cell-input"
                        :class="{ 'cell-error': validationErrors[`${rowIdx}-${cpIdx}`] }"
                        :data-edit="`${rowIdx}-${cpIdx}`"
                        :value="data.values[rowIdx]?.[cpIdx] ?? ''"
                        :placeholder="item.validationType === 'numeric' ? '数值' : '输入值'"
                        :title="validationErrors[`${rowIdx}-${cpIdx}`] || ''"
                        @mousedown.stop
                        @change="(e) => updateCell(rowIdx, cpIdx, (e.target as HTMLInputElement).value || null)"
                        @keydown="(e) => handleEditKeydown(e, rowIdx, cpIdx)"
                        @blur="exitEditMode"
                      />
                      <span v-else class="cell-display">{{ displayValue(rowIdx, cpIdx) }}</span>
                      <div
                        v-if="isFillHandleCorner(rowIdx, cpIdx)"
                        class="fill-handle"
                        @mousedown.stop="handleFillHandleDown($event, rowIdx, cpIdx)"
                        title="拖动以批量填充"
                      ></div>
                    </div>
                  </td>
                </template>
                <td v-if="gridRowIdx === layoutGrid.length - 1" class="cell-purple col-summary">{{ rowPassRate(rowIdx) }}</td>
              </tr>

              <!-- 故障判定行（N2 Bug修复：每个网格行均渲染，各段独立可编辑） -->
              <tr v-if="template.faultRow?.enabled" class="fault-row">
                <td class="cell-red fixed-col col-seq"></td>
                <td class="cell-red fixed-col col-item">{{ template.faultRow.label || '故障判定' }}</td>
                <td class="cell-red fixed-col col-req">是否故障</td>
                <template v-for="(seg, segIdxInRow) in gridRow" :key="seg.index">
                  <td v-if="segIdxInRow > 0" class="seg-divider-td"></td>
                  <td
                    v-for="cpIdx in segCols(seg)"
                    :key="cpIdx"
                    class="cell-green col-data"
                    :class="{ 'cell-selected': isFaultSelected(cpIdx) }"
                    :data-fault="cpIdx"
                    @mousedown.exact="startFaultDrag(cpIdx)"
                    @dblclick="enterFaultEdit(cpIdx)"
                  >
                    <span v-if="editFaultCol !== cpIdx" class="cell-display fault-display">{{ data.faultValues[cpIdx] || '-' }}</span>
                    <select v-else class="cell-select"
                      :data-fault-select="cpIdx"
                      :value="data.faultValues[cpIdx] ?? ''"
                      @mousedown.stop
                      @change="(e) => { updateFault(cpIdx, (e.target as HTMLSelectElement).value || null); exitFaultEdit() }"
                      @blur="exitFaultEdit"
                      @keydown.escape.stop="exitFaultEdit"
                    >
                      <option value="">-</option>
                      <option value="是">是</option>
                      <option value="否">否</option>
                      <option value="/">/</option>
                    </select>
                  </td>
                </template>
                <td v-if="gridRowIdx === layoutGrid.length - 1" class="cell-purple col-summary">-</td>
              </tr>

              <!-- 设备完好率行（只在最后网格行） -->
              <tr v-if="gridRowIdx === layoutGrid.length - 1" class="summary-row">
                <td class="cell-red fixed-col col-seq"></td>
                <td class="cell-red fixed-col col-item">设备完好率</td>
                <td :colspan="lastGridRowTotalDataCols + 2" class="cell-purple total-rate">{{ totalPassRate }}</td>
              </tr>

              <!-- 备注行（只在最后网格行） -->
              <tr v-if="gridRowIdx === layoutGrid.length - 1" class="notes-row">
                <td class="cell-red fixed-col col-seq"></td>
                <td class="cell-red fixed-col col-item">备注</td>
                <td :colspan="lastGridRowTotalDataCols + 2" class="notes-cell">
                  <textarea class="notes-input" :value="data.notes ?? ''"
                    @keydown.stop
                    @copy.stop
                    @cut.stop
                    @paste.stop
                    @input="(e) => updateNotes((e.target as HTMLTextAreaElement).value)"
                    @change="(e) => updateNotes((e.target as HTMLTextAreaElement).value)"
                    placeholder="点检备注信息（可选）" rows="2"></textarea>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-if="gridRowIdx < layoutGrid.length - 1" class="seg-row-gap"></div>
        </template>
      </div>
    </div>

    <div v-if="data.checkpoints.length === 0" class="no-checkpoints">
      <p>暂无检查点列，点击「添加检查点」开始数据录入</p>
    </div>

    <!-- 右键上下文菜单 — Teleport 到 body 层避免被 overflow:hidden 裁剪 -->
    <Teleport to="body">
      <div
        v-if="ctxMenu.visible"
        class="inspection-ctx-menu"
        :style="{ position: 'fixed', left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }"
        @click.stop
      >
        <div class="ctx-item ctx-item-insert" @click="ctxInsertColumnAfter">
          <svg class="ctx-icon" viewBox="0 0 16 16" fill="none">
            <path d="M8 2v12M2 8h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          在此列后插入
        </div>
        <div class="ctx-divider"></div>
        <div class="ctx-item ctx-item-delete" @click="ctxDeleteColumn">
          <svg class="ctx-icon" viewBox="0 0 16 16" fill="none">
            <path d="M2 4h12M5 4V2h6v2M6 7v5M10 7v5M3 4l1 10h8l1-10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          删除此列
        </div>
      </div>
    </Teleport>
  </div>
</template>


<style scoped>
.inspection-table { width: 100%; }

.table-company-header { font-size: 14px; font-weight: 600; color: var(--text-primary); margin-bottom: 4px; padding: 4px 0; }
.table-header-bar { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-xs); }
.table-title { font-size: 15px; font-weight: 600; color: var(--text-primary); display: flex; align-items: center; gap: 4px; }
.title-label { color: var(--text-secondary); font-weight: 400; }
.title-value { color: var(--color-primary); }
.table-actions { display: flex; align-items: center; gap: var(--space-xs); }

.table-hint { font-size: 11px; color: var(--text-tertiary); margin-bottom: var(--space-xs); padding: 4px 8px; background: hsla(217,72%,50%,0.05); border-radius: var(--radius-sm); border-left: 2px solid var(--color-primary); }
.table-hint kbd { background: var(--bg-elevated); border: 1px solid var(--border-color); border-radius: 3px; padding: 0 4px; font-size: 10px; }
.hint-handle { display: inline-block; width: 8px; height: 8px; background: var(--color-primary); font-size: 0; vertical-align: middle; }

/* 布局浏览面板 */
.layout-editor-panel { margin-bottom: var(--space-sm); }

.table-scroll-wrapper { overflow-x: auto; border: 1px solid var(--border-color); border-radius: var(--radius-md); outline: none; }
.table-scroll-wrapper:focus-within { box-shadow: 0 0 0 2px hsla(217,72%,50%,0.15); }

/* 多段布局结构 */
.segment-grid { display: flex; flex-direction: column; }
.seg-row-gap { height: 16px; background: repeating-linear-gradient(90deg, transparent, transparent 4px, var(--border-color-light) 4px, var(--border-color-light) 5px); opacity: 0.4; }
.seg-table { border-collapse: collapse; width: 100%; }

/* 段间分隔列 */
.seg-divider-th { width: 8px !important; min-width: 8px !important; background: var(--border-color-light) !important; padding: 0 !important; border: none !important; }
.seg-divider-td { width: 8px !important; min-width: 8px !important; background: var(--border-color-light) !important; padding: 0 !important; border: none !important; }

.data-table { width: 100%; border-collapse: collapse; font-size: 12px; min-width: 600px; }
.data-table th, .data-table td { border: 1px solid var(--border-color); padding: 5px 6px; text-align: center; vertical-align: middle; white-space: nowrap; }
.data-table tbody tr:nth-child(even) td { background-color: hsla(220,14%,50%,0.04); }

/* 四色语义 — BUG-6: 改用 global.css 定义的 --cell-*-ui 变量，统一维护点 */
.cell-red    { background: var(--cell-red-ui);    color: var(--text-primary); font-weight: 500; }
.cell-yellow { background: var(--cell-yellow-ui); color: var(--text-primary); }
.cell-green  { background: var(--cell-green-ui);  cursor: default; }
.cell-purple { background: var(--cell-purple-ui); color: hsl(270,55%,42%); font-weight: 600; }

/* 固定列 */
.col-seq     { width: 36px; min-width: 36px; }
.col-item    { width: 110px; min-width: 110px; text-align: left; padding-left: 8px !important; }
.col-req     { width: 180px; min-width: 160px; text-align: left; font-size: 11px; padding-left: 8px !important; }
.col-data    { min-width: 80px; width: 90px; padding: 2px !important; font-size: 12px; position: relative; }
.col-summary { width: 72px; min-width: 72px; font-variant-numeric: tabular-nums; }

/* 选中高亮 */
.cell-selected { background: rgba(59,130,246,0.12) !important; outline: 1px solid rgba(59,130,246,0.5); outline-offset: -1px; }
.th-selected { background: rgba(59,130,246,0.12) !important; outline: 1px solid rgba(59,130,246,0.5); outline-offset: -1px; }

/* 检查点显示态文字 */
.cp-name-display {
  display: block; width: 100%; text-align: center; font-size: 12px; color: var(--text-primary);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  pointer-events: none; user-select: none;
}

/* 拖拽填充预览 */
.drag-highlight { background: rgba(59,130,246,0.18) !important; outline: 1px dashed var(--color-primary); }

/* 列头 */
.cp-header { display: flex; align-items: center; gap: 2px; justify-content: center; }
.cp-name-input { background: transparent; border: none; border-bottom: 1px dashed var(--border-color-light); color: var(--text-primary); text-align: center; font-size: 12px; width: 56px; padding: 2px; outline: none; }
.cp-name-input:focus { border-bottom-color: var(--color-primary); }
.cp-fill-btn, .cp-cut-btn, .cp-delete-btn { background: none; border: none; cursor: pointer; line-height: 1; padding: 0 1px; opacity: 0; transition: opacity var(--transition-fast); }
.cp-header:hover .cp-fill-btn,
.cp-header:hover .cp-cut-btn,
.cp-header:hover .cp-delete-btn { opacity: 1; }
.cp-fill-btn   { color: var(--text-tertiary); font-size: 10px; }
.cp-fill-btn:hover { color: var(--color-primary); }
.cp-cut-btn    { color: var(--text-tertiary); font-size: 12px; }
.cp-cut-btn:hover, .cp-cut-btn.cut-active { color: hsl(217,72%,50%); opacity: 1; }
.cp-cut-btn.cut-active { font-weight: 700; }
.cp-delete-btn { color: var(--text-tertiary); font-size: 14px; }
.cp-delete-btn:hover { color: var(--color-danger); }

/* 填充菜单 */
.fill-menu { position: absolute; top: 100%; left: 50%; transform: translateX(-50%); z-index: 100; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md); box-shadow: var(--shadow-md); min-width: 120px; padding: 4px 0; }
.fill-menu-item { padding: 6px 12px; font-size: 12px; color: var(--text-primary); cursor: pointer; white-space: nowrap; transition: background var(--transition-fast); }
.fill-menu-item:hover { background: var(--color-primary-bg); color: var(--color-primary); }

/* 单元格容器 */
.cell-wrapper { position: relative; display: flex; align-items: center; justify-content: center; min-height: 24px; }

/* 显示态 */
.cell-display { font-size: 12px; color: var(--text-primary); text-align: center; width: 100%; padding: 2px; min-height: 20px; display: flex; align-items: center; justify-content: center; user-select: none; }

/* 编辑态 input */
.cell-input { background: rgba(34,197,94,0.1); border: none; outline: 1px solid var(--color-success); color: var(--text-primary); text-align: center; font-size: 12px; width: 100%; padding: 2px; }
.cell-input::placeholder { color: var(--text-tertiary); font-size: 11px; }
.cell-error { outline: 1px solid var(--color-danger) !important; background: rgba(239,68,68,0.08) !important; }

/* 编辑态 select */
.cell-select { background: transparent; border: none; color: var(--text-primary); text-align: center; font-size: 12px; width: 100%; cursor: pointer; outline: none; -webkit-appearance: none; appearance: none; padding: 2px 12px 2px 4px;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M3 5l3 3 3-3' fill='none' stroke='%239aa0b4' stroke-width='1.5'/%3E%3C/svg%3E");
  background-repeat: no-repeat; background-position: right 2px center; background-size: 10px; }
.cell-select:focus { outline: 1px solid var(--color-success); }
.cell-select option { background: var(--bg-card); color: var(--text-primary); }

/* 填充柄 */
.fill-handle { position: absolute; right: -4px; bottom: -4px; width: 10px; height: 10px; background: var(--color-primary); border: 2px solid var(--bg-card); cursor: crosshair; z-index: 10; border-radius: 2px; }
.fill-handle:hover { background: hsl(217,72%,40%); transform: scale(1.2); }

/* 汇总 */
.summary-row { font-weight: 600; }
.total-rate { color: var(--color-primary); font-size: 14px; }
.fault-row td { font-size: 12px; }

/* 备注 */
.notes-row td { white-space: normal !important; }
.notes-cell { text-align: left !important; padding: 0 !important; }
.notes-input { width: 100%; border: none; background: transparent; color: var(--text-primary); font-size: 12px; padding: 6px 8px; outline: none; resize: vertical; font-family: inherit; }
.notes-input:focus { background: rgba(34,197,94,0.06); }

/* 空状态 */
.no-checkpoints { text-align: center; padding: var(--space-lg); color: var(--text-tertiary); font-size: 13px; border: 1px dashed var(--border-color); border-top: none; border-radius: 0 0 var(--radius-md) var(--radius-md); }

/* Excel 风格列宽拖拽把手 */
.col-resize-handle { position: absolute; top: 0; right: 0; width: 5px; height: 100%; cursor: col-resize; z-index: 10; background: transparent; transition: background 0.15s; }
.col-resize-handle:hover,
.col-resize-handle:active { background: var(--color-primary, #409eff); opacity: 0.6; }

/* 右键菜单 — Teleport 到 body，使用 :global 穿透 scoped */
:global(.inspection-ctx-menu) {
  z-index: 9999;
  background: #ffffff;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  box-shadow: 0 4px 16px rgba(0,0,0,0.12);
  min-width: 160px;
  padding: 4px 0;
  user-select: none;
  animation: ctx-fadein 0.1s ease-out;
}
@keyframes ctx-fadein {
  from { opacity: 0; transform: translateY(-4px); }
  to   { opacity: 1; transform: translateY(0); }
}
:global(.ctx-item) {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  font-size: 12px;
  color: var(--text-primary);
  cursor: pointer;
  transition: background 0.1s;
  white-space: nowrap;
}
:global(.ctx-item:hover) { background: var(--bg-card-hover); }
:global(.ctx-item-insert:hover) { background: var(--color-primary-bg); color: var(--color-primary); }
:global(.ctx-item-delete) { color: var(--color-danger); }
:global(.ctx-item-delete:hover) { background: hsla(0, 72%, 51%, 0.06); }
:global(.ctx-icon) { width: 14px; height: 14px; flex-shrink: 0; }
:global(.ctx-divider) { height: 1px; background: var(--border-color); margin: 4px 0; }
</style>
