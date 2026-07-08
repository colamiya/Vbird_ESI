/**
 * Vbird ESI — 单元格语义色标类型
 * 四色语义是整个系统的核心设计约束
 */

/** 单元格颜色语义枚举 */
export enum CellColor {
  /** 🔴 红色 — 软件固定区域，用户不可编辑 */
  RED = 'red',
  /** 🟡 黄色 — 用户自定义区域，模板设计时/项目中定义 */
  YELLOW = 'yellow',
  /** 🟢 绿色 — 实际填入数据，用户在项目中填写 */
  GREEN = 'green',
  /** 🟣 紫色 — 自动计算区域，系统实时计算，用户不可编辑 */
  PURPLE = 'purple',
}

/** 单元格颜色对应的 CSS 背景色 */
export const CellColorMap: Record<CellColor, string> = {
  [CellColor.RED]: '#ff0000',
  [CellColor.YELLOW]: '#ffff00',
  [CellColor.GREEN]: '#92d050',
  [CellColor.PURPLE]: '#7030a0',
}

/** 单元格颜色对应的 CSS 文字色 */
export const CellTextColorMap: Record<CellColor, string> = {
  [CellColor.RED]: '#ffffff',
  [CellColor.YELLOW]: '#000000',
  [CellColor.GREEN]: '#000000',
  [CellColor.PURPLE]: '#ffffff',
}

/** 判断单元格是否可编辑 */
export function isCellEditable(color: CellColor): boolean {
  return color === CellColor.YELLOW || color === CellColor.GREEN
}

/** 单元格数据校验类型 */
export type ValidationType = 'text' | 'numeric' | 'manual'

/** 单元格位置 */
export interface CellPosition {
  row: number
  col: number
}

/** 单元格样式 */
export interface CellStyle {
  color: CellColor
  bold?: boolean
  fontSize?: number
  textAlign?: 'left' | 'center' | 'right'
  borderTop?: boolean
  borderBottom?: boolean
  borderLeft?: boolean
  borderRight?: boolean
}

/** 合并单元格规则 */
export interface MergeRule {
  startRow: number
  startCol: number
  endRow: number
  endCol: number
}
