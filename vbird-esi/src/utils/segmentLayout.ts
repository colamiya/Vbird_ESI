/**
 * Vbird ESI — 布局浏览工具函数
 *
 * 管理 segmentLayout（各段在输出网格中的位置），提供：
 * - computeSegments:               从 segmentBreaks 推导各段的列范围
 * - getOrMigrateLayout:            获取 segmentLayout（始终自动计算）
 * - buildLayoutGrid:               将 SegmentPosition[] 转为 SegmentInfo[][] 二维结构
 *
 * 注意：手动切割功能已废弃，切割全程自动。
 * - 每段最多 6 个地点
 * - 优先上下排列，超 A4 高度则左右换列
 * - 所有 gridRow 排数对齐（生成占位表填充空白）
 */

import type { InspectionTableData, SegmentPosition } from '@/types/project'

/**
 * A4 布局常量（单位：磅 pt）
 */
export const A4_HEIGHT_PT = 841.89
export const A4_WIDTH_PT = 595.28
export const PAGE_MARGIN_PT = 20
export const ROW_HEIGHT_PT = 18
export const MAX_LOC_PER_SEG = 6

/**
 * L1 固定表头高度（pt）
 * = 标题行(20) + 表头第1行(22) + 表头第2行(22) + 故障判定行(20) + 合格率行(18) + 备注行(20)
 */
export const L1_FIXED_HEIGHT_PT = 20 + 22 + 22 + 20 + 18 + 20

/**
 * 段间空隙（pt）
 */
export const SEGMENT_GAP_PT = 5

// ============================================================
// 公共类型
// ============================================================

/** 一个段的完整描述（含推导字段） */
export interface SegmentInfo {
  /** 段的顺序索引（0-based，对应 segmentBreaks 切分出的第 N 段） */
  index: number
  /** 起始列索引（含，对应 checkpoints 数组下标） */
  startCol: number
  /** 结束列索引（含） */
  endCol: number
  /** 输出网格行（0-indexed） */
  gridRow: number
  /** 输出网格列（0-indexed） */
  gridCol: number
}

// ============================================================
// computeSegments
// ============================================================

/**
 * 从 segmentBreaks 推导各段的列范围（不含位置信息）。
 *
 * @example
 * computeSegments([3, 6], 9)
 * // → [{ index:0, startCol:0, endCol:2 },
 * //    { index:1, startCol:3, endCol:5 },
 * //    { index:2, startCol:6, endCol:8 }]
 */
export function computeSegments(
  segmentBreaks: number[],
  totalCols: number,
): { index: number; startCol: number; endCol: number }[] {
  if (totalCols <= 0) return []

  const breaks = [...new Set(segmentBreaks)]
    .filter(b => b > 0 && b < totalCols)
    .sort((a, b) => a - b)

  const segs: { index: number; startCol: number; endCol: number }[] = []
  let start = 0

  for (const bp of breaks) {
    segs.push({ index: segs.length, startCol: start, endCol: bp - 1 })
    start = bp
  }
  segs.push({ index: segs.length, startCol: start, endCol: totalCols - 1 })

  return segs
}

// ============================================================
// getOrMigrateLayout
// ============================================================

/**
 * 获取 segmentLayout。
 *
 * 始终自动计算（手动切割功能已废弃）：
 * 1. 每段最多 6 个地点
 * 2. 优先上下排列，超 A4 高度则左右换列
 * 3. 所有 gridRow 排数对齐（占位表规则）
 */
export function getOrMigrateLayout(data: InspectionTableData): SegmentPosition[] {
  const totalCols = data.checkpoints.length
  if (totalCols === 0) return []

  return autoComputeSegments(data)
}

/**
 * 核心自动切割算法：按照 A4 大小竖向自动计算段位置。
 *
 * 规则：
 * - 每段最多 MAX_LOC_PER_SEG (6) 个地点
 * - 计算 A4 一列能容纳的段数（按高度）
 * - 优先上下（gridRow）排列，超高度后左右（gridCol）换列
 * - 所有 gridCol 的 gridRow 排数 = segmentsPerCol（占位表对齐）
 *
 * @returns 自动计算的 SegmentPosition[]，同时同步更新 data.segmentBreaks
 */
export function autoComputeSegments(data: InspectionTableData): SegmentPosition[] {
  const totalCols = data.checkpoints.length
  const rowCount = data.values.length

  if (totalCols === 0) return []

  // ① 自动生成 segmentBreaks（每 MAX_LOC_PER_SEG 个一切）
  const breaks: number[] = []
  for (let i = MAX_LOC_PER_SEG; i < totalCols; i += MAX_LOC_PER_SEG) {
    breaks.push(i)
  }
  data.segmentBreaks = breaks

  const segments = computeSegments(breaks, totalCols)
  if (segments.length === 0) {
    return [{ startCol: 0, gridRow: 0, gridCol: 0 }]
  }

  // ② 计算单个段的高度
  const segmentHeight = L1_FIXED_HEIGHT_PT + rowCount * ROW_HEIGHT_PT

  // ③ 计算 A4 一列能容纳多少个段
  const availableHeight = A4_HEIGHT_PT - (PAGE_MARGIN_PT * 2)
  const segmentsPerCol = Math.max(1, Math.floor((availableHeight - L1_FIXED_HEIGHT_PT) / (segmentHeight + SEGMENT_GAP_PT)))

  // ④ 分配 gridRow / gridCol
  // 前 segmentsPerCol 个段放在 gridCol=0（左侧，纵向排列）
  // 后续依次放到 gridCol=1, 2, 3...（右侧）
  const layout: SegmentPosition[] = []
  for (let i = 0; i < segments.length; i++) {
    layout.push({
      startCol: segments[i].startCol,
      gridRow: i % segmentsPerCol,
      gridCol: Math.floor(i / segmentsPerCol),
    })
  }

  return layout
}

// ============================================================
// buildLayoutGrid
// ============================================================

/**
 * 将 SegmentPosition[] + segmentBreaks 转为二维 SegmentInfo[][] 结构。
 *
 * 返回值：rows[gridRow] 是该行所有段的有序数组（按 gridCol 升序）。
 *
 * @example
 * // layout: [{startCol:0, gridRow:0, gridCol:0}, {startCol:3, gridRow:0, gridCol:1}, ...]
 * buildLayoutGrid(layout, [3], 6)
 * // → [[{index:0, startCol:0, endCol:2, gridRow:0, gridCol:0},
 * //      {index:1, startCol:3, endCol:5, gridRow:0, gridCol:1}]]
 */
export function buildLayoutGrid(
  layout: SegmentPosition[],
  segmentBreaks: number[],
  totalCols: number,
): SegmentInfo[][] {
  const segments = computeSegments(segmentBreaks, totalCols)

  const len = Math.min(layout.length, segments.length)
  const infos: SegmentInfo[] = []

  for (let i = 0; i < len; i++) {
    const pos = layout[i]
    const seg = segments[i]
    infos.push({
      index: i,
      startCol: seg.startCol,
      endCol: seg.endCol,
      gridRow: pos.gridRow,
      gridCol: pos.gridCol,
    })
  }

  // 按 gridRow 分组，组内按 gridCol 排序
  const rowMap = new Map<number, SegmentInfo[]>()
  for (const info of infos) {
    if (!rowMap.has(info.gridRow)) rowMap.set(info.gridRow, [])
    rowMap.get(info.gridRow)!.push(info)
  }

  // 返回有序行数组（行号连续）
  const maxRow = infos.length > 0 ? Math.max(...infos.map(i => i.gridRow)) : 0
  const result: SegmentInfo[][] = []
  for (let r = 0; r <= maxRow; r++) {
    const row = (rowMap.get(r) ?? []).slice().sort((a, b) => a.gridCol - b.gridCol)
    result.push(row)
  }

  return result
}

/**
 * 计算全局最大 gridRow 排数。
 * 用于占位表对齐：所有 gridCol 页必须有相同的 gridRow 排数。
 */
export function getMaxGridRow(layout: SegmentPosition[]): number {
  if (layout.length === 0) return 0
  return Math.max(...layout.map(p => p.gridRow)) + 1
}

/**
 * 计算全局最大 gridCol 数。
 */
export function getMaxGridCol(layout: SegmentPosition[]): number {
  if (layout.length === 0) return 0
  return Math.max(...layout.map(p => p.gridCol)) + 1
}
