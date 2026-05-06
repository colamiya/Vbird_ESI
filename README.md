# ESI - 工程安全检查点检管理系统

> **Engineering Safety Inspection** — 基于模板驱动的三级表格管理 + Excel 导出桌面应用

## 📌 项目概述

一个离线桌面应用，用于管理工程质量安全检查报告。核心是围绕 **三级表格结构**（分项点检表 → 分部工程表 → 单位工程总表）实现 **模板化管理 + 自动数据聚合 + Excel 多 Sheet 导出**，取代人工拼 Excel 的低效流程。

- **形态**: 离线桌面应用，打包为 `.exe` / `.msi` 安装包（源码不可见）
- **用户**: 单人使用，完全离线运行
- **核心价值**: 模板一次设计、项目反复复用、导出标准 Excel 交付文件
- **当前状态**: Phase 15-2 完成，已进入端到端验证阶段，并已接入 `BOOT/ONGOING/CHANGELOG` 文档体系

### 2026-04-26 新需求实现状态

- 项目创建已改为“基础信息 + 点位清单初始化向导”：选择 L3 后展开可选 L2/L1，默认空选，按 L1 填单位、数量、点位名称。
- 项目编辑页已新增 `数据录入 / 点位清单 / 结果清单 / 设备清单` 四个项目内视图；点位清单是 L2/L1 结构与 L1 检查点列的主数据源。
- 点位清单录入已改为 `检测部位1~6` 模板式网格，支持从 Excel/文本粘贴后按换行、Tab、逗号、顿号拆分，并自动反推数量与同步 L1 检查点列。
- L1 模板支持重点设备字段和检查项设备关联；模板管理页新增检查设备库。
- 全链路统计术语切换为“设备完好率”，故障台数按 `是否故障=是` 的有效点位统计。
- L2/L3 聚合计算改为样表公式：存在重点项时，重点最低值 `<=` 非重点最低值则取重点最低值，否则按总故障/总量加权。
- L3 总表模板可为关联分部配置权值；计算预览和导出优先按 L3 模板权值计算，项目实例快照仅作缺模板回退；工程总合格率按 `Σ(分部设备完好率 × 权值) / Σ权值` 计算，权值为 0 的分部不参与总合格率。
- Excel 导出前置输出 `检查结果计算表 / 点位清单表 / 结果清单 / 设备清单`，并对非法 Sheet 名字符做净化。
- L1 Excel 导出最后页采用导出专用槽位：非最终块可承接 7 个点位，最终块保留 `6 点位 + 汇总列`，录入界面分段预览仍保持每段 6 点位。
- 系统数据支持单 JSON 全量导出/导入，导入为整体替换模板、项目、设备库。

## 🧭 AI 接手顺序

如果是新一轮 AI 会话，推荐按以下顺序建立上下文：

1. 阅读 `BOOT.md` 了解通用启动协议与文档机制
2. 阅读 `AGENTS.md` 了解本项目硬约束与关键路径
3. 阅读 `ONGOING.md` 获取当前阶段、活跃任务、风险
4. 再阅读本文件 `README.md` 理解稳定背景、架构、命令与核心链路
5. 若旧文档或旧对话提到 `00_BOOT.md`，请将其视为 `ONGOING.md` 的兼容入口

---

## 🚀 开发运行指南

### 环境要求

| 工具 | 版本 | 用途 |
| --- | --- | --- |
| **Node.js** | >= 18.x | 前端构建 |
| **Rust** | >= 1.75 | Tauri 后端编译 |
| **npm** | >= 9.x | 包管理 |
| **WebView2** | Windows 10/11 自带 | Tauri 渲染引擎 |

### 安装依赖

```bash
cd vbird-esi
npm install
```

### 开发模式运行

有两种方式：

#### 方式 1：Tauri 完整模式（推荐，支持文件读写）

```bash
cd vbird-esi
npm run tauri dev
```

- 会同时启动 Vite 前端 + Rust 后端
- 全功能可用（文件读写、模板/项目 CRUD）
- 首次启动需编译 Rust，约 1-3 分钟，后续热重载很快
- 数据存储在 `%APPDATA%/com.vbird.esi/` 目录下

#### 方式 2：纯前端模式（快速预览 UI，不支持文件操作）

```bash
cd vbird-esi
npm run dev
```

- 仅启动 Vite 前端（约 0.5 秒）
- 浏览器访问 `http://localhost:1420/`
- ⚠ 注意：此模式下 Tauri invoke 不可用，模板/项目的创建、保存、加载功能均会报错
- 适合纯 UI 布局、样式调试

### 类型检查

```bash
cd vbird-esi
npx vue-tsc --noEmit
```

### 生产构建

```bash
cd vbird-esi
npm run build          # 仅前端构建
npm run tauri build    # 完整打包（生成 .exe / .msi 安装包）
```

打包产物位于 `vbird-esi/src-tauri/target/release/bundle/` 目录下。

## 🏗️ 业务架构

### 三级表格体系

```
┌─────────────────────────────────────────────────────────────────────┐
│ L3 单位工程总表 (检查结果计算表)                                       │
│   ├── 引用 L2 分部表评分数据与项目实例分部权值                          │
│   ├── 按分部设备完好率加权平均计算工程总合格率                           │
│   └── 当前仍保留总体评分与总体质量等级显示                               │
├─────────────────────────────────────────────────────────────────────┤
│ L2 分部工程表 (如: 安全设施、生产设备)                                   │
│   ├── 引用 L1 分项表合格率                                            │
│   ├── 手动填写: 自定义扣分项（可在模板中配置）                           │
│   └── 自动计算: 分部工程实测得分、评分、质量等级                          │
├─────────────────────────────────────────────────────────────────────┤
│ L1 分项点检表 (如: 消防设施、电气安全、机械设备...)                        │
│   ├── 行: 检查项目 + 技术要求（模板固定）                                │
│   ├── 列: 检查点/地点/设备（项目中动态添加，支持批量创建）                 │
│   ├── 数据: 用户逐单元格填入（下拉选择 或 自由输入）                      │
│   ├── 汇总: 自动计算行合格率 + 表合格率                                  │
│   ├── 备注: 每张表底部有备注行                                          │
│   └── 分段: 自动切割（每段最多 6 个地点），按实际内容高度分页，导出时按横向页块排布，页内余高均分给备注行 |                    │
└─────────────────────────────────────────────────────────────────────┘
```

### 模板池结构

```
点检表模板池 (L1)           分部模板池 (L2)              总表模板 (L3)
├── 消防设施               ├── 安全设施                 └── 检查结果计算表
├── 电气安全               │   ├── 可选: 消防设施
├── 防护设施               │   ├── 可选: 电气安全
├── 机械设备               │   └── 可选: 防护设施
├── 特种设备               ├── 生产设备
├── 仪器仪表               │   ├── 可选: 机械设备
└── ...可扩展              │   ├── 可选: 特种设备
                           │   └── 可选: 仪器仪表
                           └── ...可扩展
```

---

## 🎨 单元格语义色标（设计红线）

> 以下颜色标记定义了表格中每个单元格的**数据归属与行为**，是整个系统的核心约束。

### L1 分项点检表

| 颜色 | 语义 | 示例 | 系统行为 |
|------|------|------|---------|
| 🔴 **红色** | 软件固定区域 | 标题行、表头、设施标签、合格率标签、备注标签 | 由系统根据模板自动渲染，用户不可编辑 |
| 🟡 **黄色** | 用户自定义区域 | 设施名称、检查点列名、检查项目名称+技术要求 | 模板设计时定义行结构；项目中定义列名 |
| 🟢 **绿色** | 实际填入数据 | 数据交叉区（下拉选项 或 自由输入）、故障判定 | 用户在项目中逐格填写，支持拖拽填充 |
| 🟣 **紫色** | 自动计算 | 各行合格率、表总合格率 | 系统自动实时计算，用户不可编辑 |

**点检表固定结构**：
```
行1:   [红] 检查公司：[绿]XXX公司                          ← 检查公司行（L2 表头）
行2:   [红] 设施名称：[黄]                                 ← 标题行
行3:   [红] 序号 | 检查项目 | 技术要求 | [红]测试点单项结果 | [红]汇总列  ← 表头行
行4:   [红]                              | [黄]地点1 | [黄]地点2 | ... ← 检查点名称行
行5~N: [黄]序号 | [黄]检查项目 | [黄]技术要求 | [绿]数据 | [绿]数据 | ... | [紫]行汇总  ← 数据行
行N+1: [红]XX设施 | [红]是否故障 | [绿]是/否 | [绿]是/否 | ...          ← 故障判定行
行N+2: [红] | [红]合格率 | [红]合格率 | ... | [紫]总合格率              ← 合格率行
行N+3: [红]备注 | [绿]备注内容                                        ← 备注行
```

### L2 分部工程表

| 颜色 | 语义 | 示例 | 系统行为 |
|------|------|------|---------|
| 🔴 **红色** | 软件固定区域 | 标题行、表头、评分区标签 | 固定渲染 |
| 🟡 **黄色** | 用户自定义 | 分部名称、自定义扣分项（模板中配置） | 模板设计时定义 |
| 🟢 **绿色** | 实际填入 | 单位名称、扣分项数值 | 用户手动输入 |
| 🟣 **紫色** | 自动计算 | 合格率列、分部工程实测得分、评分/质量等级 | 系统自动计算 |

---

## 🔄 核心工作流

### 1. 模板管理流程
```
用户在模板管理器中操作：
  1. 创建 L1 点检表模板 → 定义检查项目行（文本型固定下拉：符合/不符合//；数值型配置条件 AND/OR）
  2. 创建 L2 分部表模板 → 配置自定义扣分项 + **质量等级阈值** + 关联可选的 L1 模板
  3. 创建 L3 总表模板 → 关联可选的 L2 模板列表，并配置各分部总表权值
  4. 所有模板存入模板池，可随时编辑（**删除模板时会提示被引用情况**）
```

### 2. 项目生产流程
```
  1. 新建项目 → 填写基本信息 + 关联 L3 模板
  2. 添加分部 → 从 L2 分部模板池选择
  3. 在每个分部下，添加多个 L1 点检表，并在分部内通过二级 Tabs 切换录入（一次只显示一个表）
  4. 进入点位清单页 → 按 `检测部位1~6` 网格批量粘贴或逐格录入点位名称，数量自动联动
  5. 进入数据录入界面 → 类 Excel 编辑体验
     - 逐格填写数据（绿色区域），有下拉选项时自动渲染为 select
     - 自动切割分段（每段最多 6 个地点，按实际内容高度自动分页）
     - 支持拖拽填充、键盘导航(Tab/Enter/方向键)、Ctrl+Z 撤销
     - 系统实时计算汇总数据（紫色区域）
  6. 数据录入完成后 → 导出 Excel
```

### 3. Excel 导出规则
```
  - 一个项目 → 一个 .xlsx 文件
  - Sheet 结构: [封面页] + [L3 总表] + [L2 分部表 + L1 分项表×N] × 分部数
  - 格式保真: 合并单元格、边框（模板设置）、行高（模板设置）
  - 列宽: 无汇总页地点列 `10`；有汇总页地点列 `8`、汇总列 `10`；`序号 / 检查项目 / 技术要求` 按 `1:3:6` 分配该页剩余可打印宽度（Excel 列宽单位）
  - L2: 质量等级由模板中配置的阈值判定（兼容无阈值的旧模板）
  - L3: 分部合计行显示 L3 模板配置的分部权值；工程总合格率按分部设备完好率加权平均；当前仍保留总体质量等级字段
  - 分段: 全程自动切割，每段最多 6 个地点；按标题/技术要求/备注等实际高度分页；放不下则整表移到下一页
  - 打印基准: L1 导出显式写入 Excel `pageSetup`（A4 竖向、上下 1.91cm、左右 1.78cm、页眉页脚 0.76cm、100% 缩放）
  - 分页落地: L1 在同一张 Sheet 内按横向页块排布；每个逻辑页占一组固定列块，打印顺序使用 `overThenDown`
  - 备注补齐: 每一页剩余高度平均分配到该页所有表格的备注行；同位次备注行按跨页块共享高度，保证左右页块顶对齐且页面纵向铺满
  - 汇总列: UI 分段仍每段最多 6 个地点；L1 导出最后页非最终块第 7 槽承接后续点位，最终块保留 `6 点位 + 汇总列`；仅最终块承载真实合格率与备注
  - 三行结构: Excel 导出 L1 每段都输出“是否故障/合格率/备注”三行；非末段内容位置统一用 `/` 占位
  - 合格判定: 文本型仅“符合”算合格；数值型必须满足 numericRule 条件才算合格；`/` 不计入分母（UI 与导出共用判定引擎）
  - 数据: 导出计算结果值（不保留活公式）
```

---

## 🛠️ 技术栈

| 层 | 技术 | 说明 |
|---|---|---|
| **桌面壳** | Tauri v2 | Rust 后端，源码编译为二进制，天然保护 |
| **前端框架** | Vue 3 (Script Setup) | Composition API + TypeScript |
| **类型系统** | TypeScript (strict) | 全量 TS，严格模式 |
| **UI 组件库** | Element Plus | 布局、表单、穿梭框、对话框等标准 UI |
| **表格组件** | 自写 InspectionTable | 基于 HTML Table + 四色语义 + 拖拽填充 + 键盘导航 |
| **Excel 导出** | ExcelJS | 前端生成 .xlsx，Rust 端 write_binary_file 写入磁盘 |
| **数据存储** | JSON 文件 | 模板和项目数据存为本地 JSON 文件 |
| **构建工具** | Vite | 前端打包 |

> **注**: 早期计划使用 Univer 作为表格引擎，但在 Tauri v2 WebView 中验证失败（React 渲染层崩溃），已于 2026-04-03 彻底移除，改用自写 InspectionTable 组件替代。

---

## 📅 开发阶段

### ✅ 已完成

- [x] **Phase 0**: 框架搭建（Tauri + Vue3 + TS + Element Plus + 明亮主题 + 侧边栏布局）
- [x] **Phase 1**: L1/L2/L3 模板 CRUD + 模板池管理 UI
- [x] **Phase 2**: 项目管理系统 + 数据录入 + 合格率计算
- [x] **Phase 3**: Excel 导出（多 Sheet + 四色 + 分段 + 封面页）
- [x] **Phase 4**: UI 打磨 + 代码审查修复（原子写入/Undo/拖拽/键盘导航）
- [x] **Phase 5-6**: 模板下拉选项配置 + 备注行 + 分段切割 + 检查公司表头
- [x] **Phase 7**: UI/UX 深度重构（SVG 图标/骨架屏/面包屑/卡片色条/迷你预览）
- [x] **Phase 8**: 明亮主题切换 + 暗色残留审计清理 + 对话框 overlay bug 修复
- [x] **Phase 9-14**: 持续迭代（白屏修复/故障行Bug/右键菜单/地点命名/表格样式移除/窗口自适应等）
- [x] **Phase 15**: Excel 自动切割重构（全程自动 + 占位表对齐 + 列宽重配置 + SegmentLayoutEditor 只读预览）
- [x] **Phase 15-2**: 二级 L1 Tabs + 数值条件（AND/OR）+ Excel 三行合并/占位 + 末段判定修正

### ⏳ 待完成

- [ ] 端到端测试（`npm run tauri dev` 全流程验证）
- [ ] Excel 导出样式对照原始模板微调
- [ ] 响应式适配（不同屏幕尺寸）
- [ ] 项目归档/复制（ZIP 导出备份）
- [ ] 模板版本管理

---

## 📁 项目目录结构

```text
d:\Code\Vbird_ESI\
├── BOOT.md                    # 通用 AI 启动协议（跨项目通用）
├── README.md                  # 本文件 — 完整需求文档
├── AGENTS.md                  # AI 开发协作指南
├── ONGOING.md                 # 当前开发进度、活跃任务、风险
├── CHANGELOG.md               # 追加式修改日志
├── 00_BOOT.md                 # 兼容入口（详细进度请看 ONGOING.md）
├── other/                     # 参考资料（不进入打包）
└── vbird-esi/                 # ⬇️ Tauri 应用主目录
    ├── src-tauri/             # Tauri Rust 后端
    │   ├── src/lib.rs         # 文件 CRUD 命令(7个) + 原子写入 + 插件注册
    │   ├── capabilities/      # 权限声明 (fs/dialog/opener)
    │   ├── Cargo.toml
    │   └── tauri.conf.json
    ├── src/                   # Vue3 前端
    │   ├── assets/styles/     # CSS 明亮主题系统（HSL 语义色令牌）
    │   ├── components/        # 通用组件
    │   │   ├── layout/        # AppLayout.vue（侧边栏仅显示 ESI 文字）
    │   │   └── InspectionTable.vue  # L1 数据录入表格（核心复杂组件）
    │   ├── config/            # 集中配置 (excelLayout.ts)
    │   ├── views/             # 页面视图
    │   │   ├── TemplateManager/  # 模板管理（含 L1/L2/L3 对话框）
    │   │   ├── ProjectManager/   # 项目列表
    │   │   └── ProjectEditor/    # 项目编辑器（分部 Tab + 评分 + 数据录入 + 检查结果计算预览）
    │   ├── stores/            # Pinia 状态管理
    │   ├── types/             # TypeScript 类型定义
    │   ├── utils/             # 工具函数 (storage.ts, id.ts, segmentLayout.ts, l1PrintLayout.ts, projectCalc.ts, excelExport.ts)
    │   ├── router/            # Vue Router
    │   ├── App.vue
    │   └── main.ts
    ├── index.html
    ├── package.json
    ├── tsconfig.json
    └── vite.config.ts
```

> **注意**: 用户数据存储在 Tauri `appDataDir` 目录下（`%APPDATA%/com.vbird.esi/`），不在项目目录内。

---

## 📊 核心数据模型

> 以下类型定义与 `src/types/` 目录下的代码保持同步（最后同步: 2026-04-04）

### L1Template (点检表模板)
```typescript
interface L1Template {
  id: string;
  name: string;                  // 模板名称，如 "消防设施"
  facilityName: string;          // 设施名称（显示在表头）
  createdAt: string;
  updatedAt: string;

  columns: {
    fixedColumns: FixedColumn[];  // 固定列: 序号、检查项目、技术要求
    dataColumnWidth: number;      // 检查点列的默认列宽
    summaryColumnWidth: number;   // 汇总列的列宽
  };

  inspectionItems: InspectionItem[];  // 检查项目行

  faultRow: {
    enabled: boolean;
    label: string;               // 如 "消防设施"
  };

  styles: TableStyles;
}

interface InspectionItem {
  id: string;
  groupId: string;               // 所属检查项目组（用于行合并）
  groupName: string;             // 检查项目名称
  requirement: string;           // 技术要求
  validationType: 'text' | 'numeric';
  textOptions?: string[];        // 文本型固定选项：["符合","不符合","/"]（不再提供模板自定义编辑）
  numericRule?: {                // 数值条件（线性 AND/OR，最多 5 条）
    clauses: Array<{
      op: '>' | '>=' | '<' | '<=' | '=';
      value: number;
      join?: 'AND' | 'OR';       // 第 i 条 join 表示与下一条的连接关系（最后一条无 join）
    }>;
  };
  numericRange?: { min: number; max: number }; // 旧字段：向后兼容（读取时可迁移到 numericRule）
  rowHeight?: number;
}
```

### L2Template (分部工程表模板)
```typescript
/** 自定义扣分项 */
interface DeductionItem {
  id: string;
  label: string;                 // 扣分项名称，如 "外观缺陷扣分"
}

interface L2Template {
  id: string;
  name: string;                  // 如 "安全设施"
  createdAt: string;
  updatedAt: string;

  availableL1Ids: string[];      // 关联的 L1 模板（可选池）

  headerInfo: {
    title: string;               // "分部工程质量检验评定表"
    fields: {
      companyName: string;
      subdivisionName: string;
      implementUnit: string;
      ownerUnit: string;
      supervisorUnit: string;
    };
  };

  // 评分区 — 自定义扣分项列表 + 质量等级阈值（均可在模板中任意配置）
  scoring: {
    deductionItems: DeductionItem[];
    gradeThresholds: GradeThreshold[];  // 按分数降序排列，第一个匹配者为等级
  };
  // 注: L2Template 不再有 styles 字段，样式由 L1Template.styles 控制
}
```

```typescript
/** 质量等级阈值（L2 模板中用户自定义）*/
interface GradeThreshold {
  label: string;     // 等级名称，如 "优良"、"合格"、"不合格"
  minScore: number;  // 该等级最低分（包含），如 85
}
```

### L3Template (单位工程总表模板)
```typescript
interface L3SubdivisionWeight {
  l2TemplateId: string;           // 引用的 L2 模板 ID
  weight: number;                 // 工程总合格率加权权值，0 表示不参与
}

interface L3Template {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  availableL2Ids: string[];       // 关联的 L2 模板（可选池）
  subdivisionWeights?: L3SubdivisionWeight[]; // 旧模板缺失时按 1 处理
}
```

### Project (项目)
```typescript
interface Project {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  info: ProjectInfo;
  l3TemplateId: string;          // 引用的 L3 模板
  subdivisions: ProjectSubdivision[];
}

interface ProjectInfo {
  companyName: string;           // 检查公司
  ownerUnit: string;
  implementUnit: string;
  supervisorUnit: string;
}

/** 扣分数据：key = DeductionItem.id, value = 扣分值 */
type ScoringData = Record<string, number>;

interface ProjectSubdivision {
  l2TemplateId: string;
  l2TemplateName: string;        // 名称快照（防模板删除后丢失）
  selectedL1Ids: string[];
  inspectionData: Record<string, InspectionTableData>;
  scoringData: ScoringData;      // 动态扣分项数据
  summaryWeight: number;         // L3 模板带入的项目实例快照，缺模板时作为回退
}

interface InspectionTableData {
  l1TemplateId: string;          // 使用的 L1 模板 ID
  l1TemplateName: string;        // 模板名称快照
  checkpoints: Checkpoint[];     // 检查点列定义
  values: (string | number | null)[][];  // 数据矩阵 [行][检查点]
  faultValues: (string | null)[];        // 故障行数据
  notes: string;                 // 备注文本
  segmentBreaks: number[];       // 切割点（列索引），由自动切割算法生成（每段最多6地点）
  colWidths?: number[];          // 每个检查点列的列宽（px），用户拖拽后存储（InspectionTable 列宽调整功能保留）
  rowHeights?: number[];         // 每个数据行的行高（px），预留字段
}

interface Checkpoint {
  id: string;
  name: string;                  // 如 "地点1"、"设备1"
  width?: number;                // 列宽（px），可选
}
```

---

## 📎 参考资料

所有原始需求资料位于 `other/` 目录：
- `架构示意图.png` — 三级池结构与生产应用关系
- `表格模板.xlsx` — 实际 Excel 模板样例（11 个 Sheet）
- `需求描述.docx` — 原始需求文字描述
- `点检表结构.png` — L1 点检表色标结构图
- `分部表结构.png` — L2 分部表色标结构图
- `docx_images/image4.png` — 穿梭框交互参考图
