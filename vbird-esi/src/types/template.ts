/**
 * Vbird ESI — 模板类型定义
 * L1 (分项点检表) / L2 (分部工程表) / L3 (单位工程总表)
 */

import type { MergeRule, ValidationType } from './cell'

// ========================
// L1 — 分项点检表模板
// ========================

export type NumericOperator = '>' | '>=' | '<' | '<=' | '='
export type NumericJoin = 'AND' | 'OR'

export interface NumericClause {
  op: NumericOperator
  value: number
  join?: NumericJoin
}

export interface NumericRule {
  clauses: NumericClause[]
}

/** 固定列定义（序号/检查项目/技术要求） */
export interface FixedColumn {
  id: string
  label: string          // 列标题，如 "序号"、"检查项目"、"技术要求"
  width: number          // 列宽（px）
}

/** 检查项目行（黄色区域行定义） */
export interface InspectionItem {
  id: string
  groupId: string        // 所属检查项目组（用于行合并, 如 "安全设施" 下有多行）
  groupName: string      // 检查项目名称，如 "安全设施"
  requirement: string    // 技术要求；允许为空，空值表示项目中填写
  inspectionMethod?: string // 检测方法/检查方式，用于检查体系结构导出
  validationType: ValidationType
  textOptions?: string[] // 文本类可选值，如 ["符合", "不符合"]
  numericRule?: NumericRule
  numericRange?: {       // 数值范围
    min: number
    max: number
  }
  /** 关联设备库条目；该行任一地点存在非空且非 "/" 的内容时进入设备清单 */
  deviceId?: string
  rowHeight?: number     // 行高（px）
}

/** 表格样式配置 */
export interface TableStyles {
  mergeRules: MergeRule[]      // 合并单元格规则
  defaultRowHeight: number     // 默认行高
  headerRowHeight: number      // 表头行高
  borderStyle: 'thin' | 'medium' | 'thick'
}

/** L1 点检表模板 */
export interface L1Template {
  id: string
  name: string                 // 模板名称，如 "消防设施"
  facilityName: string         // 设施名称（显示在表头）
  /** 重点设备标记；界面/导出显示为名称后缀 "*"，计算按字段判断 */
  isCritical?: boolean
  /** 同一 L2 内同名 L1 按权值合并展示；留空则保持独立 */
  resultGroupName?: string
  /** 结果组合加权计算权值，缺失时按 1 处理，0 表示不参与 */
  resultWeight?: number
  createdAt: string
  updatedAt: string

  // 表格结构
  columns: {
    fixedColumns: FixedColumn[]      // 固定列: 序号、检查项目、技术要求
    dataColumnWidth: number          // 检查点列的默认列宽
    summaryColumnWidth: number       // 单项检测结果汇总列的列宽
  }

  // 检查项目行（黄色区域行定义）
  inspectionItems: InspectionItem[]

  // 故障判定行配置
  faultRow: {
    enabled: boolean
    label: string                    // 如 "消防设施"
  }

  // 样式
  styles: TableStyles
  /** ✨ 是否启用自动切割（A4 竖向布局），默认开启 */
  autoCutEnabled?: boolean
}

// ========================
// L2 — 分部工程表模板
// ========================

/** 质量等级阈值定义（用户在 L2 模板中自定义） */
export interface GradeThreshold {
  label: string        // 等级名称，如 "优良"、"合格"、"不合格"
  minScore: number     // 该等级最低分（包含）
}

/** 扣分项定义（可自定义，如"外观缺陷扣分""资料扣分"等） */
export interface DeductionItem {
  id: string
  label: string           // 扣分项名称，如 "外观缺陷扣分"
}

/** L2 分部工程表模板 */
export interface L2Template {
  id: string
  name: string                       // 如 "安全设施"
  createdAt: string
  updatedAt: string

  // 关联的 L1 模板（可选池）
  availableL1Ids: string[]

  // 分部表自身格式
  headerInfo: {
    title: string                    // "分部工程质量检验评定表"
    fields: {
      companyName: string            // 检查公司
      subdivisionName: string        // 分部工程名称
      implementUnit: string          // 实施单位
      ownerUnit: string              // 建设单位
      supervisorUnit: string         // 监理单位
    }
  }

  // 评分区配置 — 手动扣分项 + 质量等级阈值
  scoring: {
    deductionItems: DeductionItem[]
    /** 质量等级，按 minScore 降序排列，第一个匹配者即为等级 */
    gradeThresholds: GradeThreshold[]
  }
}

// ========================
// L3 — 单位工程总表模板
// ========================

/** L3 总表内各分部工程的权值配置 */
export interface L3SubdivisionWeight {
  /** 引用的 L2 模板 ID */
  l2TemplateId: string
  /** 工程总合格率加权平均时使用的权值，0 表示不参与 */
  weight: number
}

/** L3 单位工程总表模板 */
export interface L3Template {
  id: string
  name: string                       // 如 "检查结果计算表"
  createdAt: string
  updatedAt: string

  // 关联的 L2 模板（可选池）
  availableL2Ids: string[]
  /** 关联 L2 在总表工程总合格率中的权值，旧模板缺失时按 1 处理 */
  subdivisionWeights?: L3SubdivisionWeight[]

  // 总表自身格式
  headerInfo: {
    title: string
    fields: {
      companyName: string
      projectName: string
    }
  }

  styles: TableStyles
}
