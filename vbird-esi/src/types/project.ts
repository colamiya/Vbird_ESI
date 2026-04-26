/**
 * Vbird ESI — 项目类型定义
 * 项目 = 基本信息 + 分部结构 + 各张 L1 表的实例数据
 */

/** 一个切割段在输出网格中的位置（布局浏览新数据模型） */
export interface SegmentPosition {
  /** 该段起始列索引（由 segmentBreaks 推导，冗余存储便于读取） */
  startCol: number
  /** 输出网格行位置（0-indexed，同行多段并排共用固定列） */
  gridRow: number
  /** 输出网格列位置（0-indexed，同行内从左到右编号） */
  gridCol: number
}

/** 检查点定义 */
export interface Checkpoint {
  id: string
  name: string                   // 如 "地点1"、"设备1"
  width?: number                 // 列宽（px），用户拖拽调整后存储
}

/** L1 表实例数据（项目中每张点检表的实际数据） */
export interface InspectionTableData {
  /** 使用的 L1 模板 ID */
  l1TemplateId: string
  /** 模板名称快照（防止模板删除后丢失名称） */
  l1TemplateName: string
  /** 对应项目级点位清单条目 */
  locationItemId?: string
  /** 检查点列定义 */
  checkpoints: Checkpoint[]
  /** 数据矩阵 [行索引][检查点索引] */
  values: (string | number | null)[][]
  /** 故障行数据 [检查点索引] */
  faultValues: (string | null)[]
  /** 备注文本 */
  notes: string
  /** 切割点（列索引数组），由自动切割算法生成（每段最多6地点），用户不可手动编辑 */
  segmentBreaks: number[]
  /**
   * 上下切割点，保留以向后兼容旧数据。
   * 当 segmentLayout 存在时，rowBreaks 完全被忽略。
   * @deprecated 迁移到 segmentLayout 后自然废弃
   */
  rowBreaks: number[]
  /**
   * ✨ 布局浏览新字段：各段在输出网格中的位置。
   * 长度必须等于 segmentBreaks.length + 1。
   * 若存在则完全忽略 rowBreaks；不存在时从 segmentBreaks+rowBreaks 自动迁移。
   */
  segmentLayout?: SegmentPosition[]
  /** 列宽调整：每个检查点列的列宽（px），可选，用户拖拽调整后存储 */
  colWidths?: number[]
  /** 每个数据行的行高（px），可选，用户拖拽调整后存储 */
  rowHeights?: number[]
}

/** 扣分数据：key = DeductionItem.id, value = 扣分值 */
export type ScoringData = Record<string, number>

/** 项目中的分部结构实例 */
export interface ProjectSubdivision {
  /** 引用的 L2 模板 ID */
  l2TemplateId: string
  /** L2 模板名称快照 */
  l2TemplateName: string
  /** 实际选择的 L1 模板 ID 列表 */
  selectedL1Ids: string[]
  /** 每张 L1 表的实例数据，key 为 l1TemplateId */
  inspectionData: Record<string, InspectionTableData>
  /** 分部表扣分数据 */
  scoringData: ScoringData
}

/** 项目级点位清单条目，是项目结构与 L1 检查点列的主数据源 */
export interface ProjectLocationItem {
  id: string
  l2TemplateId: string
  l2TemplateName: string
  l1TemplateId: string
  l1TemplateName: string
  unit: string
  quantity: number
  checkpointNames: string[]
}

/** 项目基本信息 */
export interface ProjectInfo {
  companyName: string            // 检查公司
  ownerUnit: string              // 建设单位
  implementUnit: string          // 实施单位
  supervisorUnit: string         // 监理单位
}

/** 项目 */
export interface Project {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  /** 项目基本信息 */
  info: ProjectInfo
  /** 引用的 L3 模板 ID */
  l3TemplateId: string
  /** 数据结构版本；2 起包含项目级点位清单 */
  dataVersion?: number
  /** 项目级点位清单 */
  locationItems?: ProjectLocationItem[]
  /** 项目结构 — 分部列表 */
  subdivisions: ProjectSubdivision[]
}
