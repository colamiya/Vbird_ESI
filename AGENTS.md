# AGENTS.md — AI 开发协作指南

> 本文件是 AI 开发助手参与 ESI 项目的 **行为规范与知识索引**。任何 AI 在首次介入本项目时，必须先阅读此文件。
>
> 本项目采用“双层启动协议”：`BOOT.md` 负责跨项目通用启动流程，`AGENTS.md` 负责本项目特化约束。
>
> 最后更新: 2026-05-02

> 2026-04-26 补充：`other/20260425-New` 新需求已进入实现。项目新增“项目级点位清单 / 结果清单 / 设备清单 / 检查设备库 / 重点设备 / 设备完好率 / 全量系统数据导入导出”链路。后续判断现状时以代码和 `ONGOING.md` 的 2026-04-26 补充为准。
>
> 2026-05-02 补充：点位清单录入已改为模板式 `检测部位1~6` 网格；L1 导出最后页使用导出专用 7 槽位规则；L3 工程总合格率改为分部设备完好率按项目实例权值加权平均。当前仍保留“总体质量等级”展示字段。

---

## 🚨 首要行动 (MANDATORY FIRST STEP)

```
1. 阅读 `BOOT.md` 了解通用启动协议
2. 阅读本文件 (`AGENTS.md`) 了解本项目硬约束
3. 阅读 `ONGOING.md` 获取当前开发进度与上下文
4. 阅读 `README.md` 了解完整业务需求与架构
5. 根据 `ONGOING.md` 中的 [当前任务] 继续开发
```

**严禁在未阅读以上文件的情况下直接修改代码。**

> 兼容说明：若用户、旧对话或历史文档提到 `00_BOOT.md`，应将其视为 `ONGOING.md` 的兼容入口，而不是主进度文档。

---

## 📚 文档内存系统

- `BOOT.md`：跨项目通用启动协议，不记录本项目具体业务进度
- `AGENTS.md`：AI 在本项目中的行为约束、硬规则、关键路径
- `README.md`：稳定背景、需求、架构、命令与关键链路
- `ONGOING.md`：当前开发阶段、活跃任务、风险、近期结论
- `CHANGELOG.md`：追加式修改日志，只允许在顶部新增，不允许覆盖历史
- `00_BOOT.md`：历史兼容入口，详细进度以 `ONGOING.md` 为准

---

## 📐 架构红线 (ABSOLUTE CONSTRAINTS)

### 1. 三级表格体系不可打破
```
L1 (分项点检表) → L2 (分部工程表) → L3 (单位工程总表)
```
- 数据流向严格**自底向上**：L1 → L2 → L3，不可跳级引用
- 每一级都有独立的**模板**和**实例数据**，不可混用

### 2. 单元格四色语义不可违反
| 颜色 | 含义 | 约束 |
|------|------|------|
| 🔴 红色 | 软件固定 | 系统渲染，用户不可编辑 |
| 🟡 黄色 | 用户自定义 | 模板设计时定义 or 项目中定义列名 |
| 🟢 绿色 | 实际填入 | 用户在项目生产模式中填写 |
| 🟣 紫色 | 自动计算 | 系统实时计算，用户不可编辑 |

参考图: `other/点检表结构.png` 和 `other/分部表结构.png`

### 3. 文件存储规范
- 数据根目录: Tauri `appDataDir`（运行时自动获取，通过 Rust 端 `app.path().app_data_dir()` 取得）
- 模板数据: `{appDataDir}/templates/l1/` `l2/` `l3/` 目录下的 JSON 文件
- 项目数据: `{appDataDir}/projects/` 目录下的 JSON 文件
- 每个模板/项目一个独立 JSON 文件，文件名为 `{id}.json`
- 文件读写通过 **Rust 端 Tauri Command** 实现（`read_json_file` / `write_json_file` 等），前端通过 `src/utils/storage.ts` 封装调用
- 文件写入采用 **原子写入** 策略（tmp→bak→rename），防止断电数据损坏
- **不使用数据库**

### 4. 技术栈锁定
```
Tauri v2 + Vue 3 (Script Setup) + TypeScript (strict) + Element Plus + ExcelJS
```
- 不引入其他 UI 框架（如 Ant Design、Vuetify 等）
- 不引入其他表格引擎（Univer 已验证失败并移除）
- 不引入后端数据库（SQLite、IndexedDB 等）
- 不引入 SSR 框架（Nuxt 等）

### 5. UI 主题约束
```
明亮主题（Light Theme）
```
- 全局使用 **明亮白色背景** + 深色文字
- CSS Variables 使用 HSL 语义色令牌（定义在 `global.css`）
- 侧边栏仅显示 **"ESI" 纯文字**，无 Logo 图标
- 所有导航图标使用 **内联 SVG**，不使用 Emoji
- **严禁** 添加 `element-plus/theme-chalk/dark/css-vars.css` 导入
- **严禁** 在 `<html>` 或根 `<div>` 上添加 `dark` 类
- Element Plus 组件颜色通过 `global.css` 中的 `--el-*` 变量覆盖

### 6. 源码保护 & 打包发布

**架构保障**：
- 核心文件 I/O 操作放在 **Tauri Rust 端**（7 个 Tauri Command）
- Excel 导出逻辑在前端 `excelExport.ts`（使用 ExcelJS），二进制写入通过 Rust `write_binary_file`
- Rust 代码编译为 native binary（.exe），无法反编译为可读源码
- 前端 Vue/TS 代码经 Vite 构建后打包为 minified JS/CSS，嵌入二进制中
- **完全离线运行**，不需网络连接

**开发中的注意事项**：
- 不使用 `eval()`、`new Function()` 等动态代码执行（被 CSP 拦截）
- 不从外部 CDN 加载资源
- 所有资源走本地 import，Vite 会自动 bundle
- WebView2 是 Windows 10/11 自带组件，无需用户额外安装

---

## 🗂️ 关键文件索引

> 注意：源码位于 `vbird-esi/` 子目录下，以下路径均相对于 `vbird-esi/`。

| 文件 | 用途 | 修改频率 |
|------|------|---------|
| `BOOT.md` (项目根) | 通用启动协议、文档机制、接管 SOP | 低 |
| `README.md` (项目根) | 完整需求文档、数据模型、架构设计 | 低 |
| `AGENTS.md` (项目根) | AI 开发规范（本文件） | 低 |
| `ONGOING.md` (项目根) | 当前开发进度、活跃任务、风险 | **高** |
| `CHANGELOG.md` (项目根) | 追加式修改日志 | 中 |
| `00_BOOT.md` (项目根) | 兼容跳转入口（请优先看 `ONGOING.md`） | 低 |
| `src/types/cell.ts` | 四色语义枚举、颜色映射、可编辑判定 | 低 |
| `src/types/template.ts` | L1/L2/L3 模板类型（含 DeductionItem / **GradeThreshold**） | 中 |
| `src/types/project.ts` | 项目、分部、点检实例（含 notes/**segmentBreaks**/**segmentLayout**/rowBreaks/ScoringData/**summaryWeight**） | 中 |
| `src/types/device.ts` | 检查设备库类型（设备名称/型号/单位/用途），设备清单数量固定为 1 | 中 |
| `src/stores/templateStore.ts` | 模板三级 CRUD 状态管理 (Pinia) | 中 |
| `src/stores/projectStore.ts` | 项目 CRUD + 当前项目跟踪 (Pinia) | 中 |
| `src/config/excelLayout.ts` | Excel 导出版式集中配置：L1 打印页边距/列宽/比例、L2/L3/清单列宽、行高、打印缩放、颜色与边框 | 高 |
| `src/utils/storage.ts` | 文件存储封装（前端→Rust） | 中 |
| `src/utils/backup.ts` | 单 JSON 全量系统数据导入导出（模板/项目/设备库），导入为整体替换 | 中 |
| `src/utils/id.ts` | UUID 生成 + 时间戳工具 | 低 |
| `src/utils/projectStructure.ts` | 项目级点位清单迁移与同步工具，负责点位清单 ↔ L2/L1/检查点列结构同步 | 高 |
| `src/utils/segmentLayout.ts` | **【Phase 11/15 重构】** 坐标式布局工具函数（computeSegments / getOrMigrateLayout / buildLayoutGrid / getMaxGridRow / getMaxGridCol），主要服务 UI 分段与旧布局兼容 | 中 |
| `src/utils/l1PrintLayout.ts` | **【新增】** L1 打印分页工具：读取 `excelLayout.ts` 配置，负责动态行高估算 / 逻辑分页 + Worksheet 页块布局 + 页型动态列宽；`buildL1PrintPages` 供 UI 预览，`buildL1ExportPrintPages` 供导出末页 7 槽位 | 中 |
| `src/utils/projectCalc.ts` | **【新增】** 项目/L3 汇总计算共享工具（总量 / 故障数量 / 合格率 / 分部评分 / 分部权值加权总合格率 / 检查结果计算预览），供 `excelExport.ts` 与 `ProjectEditor.vue` 共用 | 中 |
| `src/utils/numericRule.ts` | 数值条件判定引擎（UI/导出复用）：`parseNumeric / evalNumericRule / isPassed` | 中 |
| `src/utils/excelExport.ts` | Excel 导出核心逻辑：读取 `excelLayout.ts` 配置，复用 `l1PrintLayout.ts` + `projectCalc.ts`；L1 显式写入 Excel `pageSetup`、按横向页块排布；列宽按页型动态铺满；同位次备注行共享高度；末页汇总列按段索引判定 | 中 |
| `src/views/TemplateManager/TemplateManager.vue` | 模板管理主页：三级 Tab + 搜索 + 迷你预览 | 高 |
| `src/views/TemplateManager/L1TemplateDialog.vue` | L1 模板创建/编辑对话框（文本下拉固定 + 数值条件配置） | 中 |
| `src/views/TemplateManager/L2TemplateDialog.vue` | L2 模板创建/编辑 + 穿梭框关联 L1 | 中 |
| `src/views/TemplateManager/L3TemplateDialog.vue` | L3 模板创建/编辑 + 穿梭框关联 L2 | 中 |
| `src/views/ProjectManager/ProjectManager.vue` | 项目列表 + 创建对话框 + 搜索 | 高 |
| `src/views/ProjectEditor/ProjectEditor.vue` | 项目编辑器：面包屑导航 + 分部 Tab + **L1 二级 Tabs** + 评分 + 数据录入 + **检查结果计算预览弹窗** | 高 |
| `src/components/LocationNamesEditor.vue` | 点位清单模板式网格录入组件：`检测部位1~6` 横向网格，支持 Excel/文本粘贴拆分并自动同步点位名称数组 | 中 |
| `src/components/SegmentLayoutEditor.vue` | **【Phase 11/15 重构】** 从拖拽式编辑组件改为只读预览组件，显示"本表将自动分为 N 段，共 M 页"及分段详情 | 中 |
| `src/components/InspectionTable.vue` | ⚠️ **最复杂组件** — 选区模型+多段渲染+拖拽填充+Undo+右键菜单，见下方警告 | 高 |
| `src/components/layout/AppLayout.vue` | 主布局：侧边栏(ESI文字+SVG图标)+内容区 | 低 |
| `src/router/index.ts` | 路由配置 | 低 |
| `src/assets/styles/global.css` | 全局 CSS 明亮主题（HSL 令牌 + EP 覆盖） | 低 |
| `src-tauri/src/lib.rs` | Rust 后端：7 个 Tauri Command + 原子写入 | 中 |
| `src-tauri/tauri.conf.json` | Tauri 窗口/构建/应用配置 (CSP 已收紧) | 低 |
| `src-tauri/capabilities/default.json` | Tauri 权限声明 | 低 |

---

## ⚠️ 常见陷阱 & 注意事项

### 1. ⚠️ InspectionTable.vue 复杂度警告（最重要！）

**这是全项目最复杂的组件，修改前务必理解其内部机制：**

- **document 级事件**：拖拽填充注册了 `document.addEventListener('mousemove'/'mouseup')`，必须在 `onBeforeUnmount` 中清理
- **fillMenu 浮层**：列头填充菜单是绝对定位浮层，关闭时需重置 `fillMenuCol`
- **Undo 栈**：`pushUndoSnapshot()` 保存深拷贝，最多 50 步
- **数据流**：通过 `emit('update', props.data)` + nextTick 防抖向父组件通信。注意：组件直接 mutate `props.data` 属性（Vue 反模式但可工作），禁止改为 shallowRef 传入
- **el-dialog 嵌套**：在对话框内使用此组件时，**必须用 `append-to-body`**，**禁止用 `destroy-on-close`**（会导致 overlay 残留），用 `v-if` 控制内容渲染
- **跨段交互**：`segmentBreaks` 只影响 UI 分段显示和 Excel 导出布局；数据格区域、检查点表头、故障行均允许跨分割块拖选、复制、粘贴、删除和拖拽填充
- **右键菜单**：`ctxMenu` ref + `_ctxHideHandler` 变量，`showCtxMenu/hideCtxMenu` 管理生命周期，使用 `<Teleport to="body">` 避免被 `overflow:hidden` 裁剪。`onBeforeUnmount` 中必须清理 `_ctxHideHandler`
- **@mousedown.left.exact**：列头 `<th>` 使用 `.left.exact` 修饰符（而非 `.exact`），避免右键触发拖拽

### 2. Tauri v2 API 差异（与 v1 不同）
- 前端通过 `@tauri-apps/api/core` 的 `invoke()` 调用 Rust 命令
- **注意**: Tauri v2 中 `path_resolver()` 已移除，改用 `app.path()` (需 `use tauri::Manager;`)
- 文件对话框：前端 `@tauri-apps/plugin-dialog`，Rust 端 `tauri-plugin-dialog`
- 文件 I/O：本项目选择 **Rust 端 std::fs** 而非前端 plugin-fs
- 权限声明在 `src-tauri/capabilities/default.json` 中，不在 `tauri.conf.json`

### 3. Excel 导出精度 & 分页布局
- ExcelJS 的合并单元格 API: `worksheet.mergeCells(startRow, startCol, endRow, endCol)`
- 列宽单位与 Excel 不同，需要换算系数
- **UI 分段系统**：`segmentLayout: SegmentPosition[]` 存储各段的 2D 网格坐标，由 `segmentLayout.ts` 管理，主要用于录入界面与旧数据兼容
- **打印分页系统**：L1 导出改由 `l1PrintLayout.ts` 按“实际内容高度 + Excel 常规页边距打印区”分页，不能再假设 `rowCount * 固定行高`
- **旧数据兼容**：`getOrMigrateLayout()` 自动将旧 `rowBreaks` 数据迁移，加载旧项目时透明处理
- **分页关键点**：技术要求行高、备注基础行高、每页余高均分给备注行、打印安全余量，这四者都会影响最终页数
- **打印落地方式**：L1 先按真实打印区做逻辑分页，再在同一张 Sheet 内按横向页块排布；同位次备注行按跨页块共享高度，打印顺序使用 `overThenDown`

### 4. 数据一致性
- 模板被项目引用后，模板修改不应影响已有项目数据
- 项目创建时应**深拷贝**模板结构快照（存 `l1TemplateName`/`l2TemplateName`），而非仅引用模板 ID
- 考虑模板删除时的校验（是否有项目在使用）

### 5. el-dialog 使用规范
- 包含复杂组件的 el-dialog **必须加 `append-to-body`**
- **禁止对含 InspectionTable 的弹窗使用 `destroy-on-close`**
- 用 `v-if` 控制弹窗内容的创建/销毁，而非依赖 `destroy-on-close`

### 6. CSS 主题规范
- 所有颜色必须使用 `global.css` 中定义的 CSS Variables
- **禁止** 使用 `#1a1a2e` 等暗色硬编码值
- 使用 `--color-primary` 替代 `--color-primary-light` 作为文字色（白色背景对比度要求）
- 新增 Element Plus 组件时，检查 `global.css` 底部的 EP 覆盖区是否需要补充
- 四色语义有**两套变量**：`--cell-red`（Excel 导出纯色）和 `--cell-red-ui`（UI 展示半透明色），**组件必须用 `-ui` 后缀变量**

### 7. 模板删除引用检查
- `handleDeleteL1` 会检查全部 L2 的 `availableL1Ids`，被引用时弹出**红色**警告后允许删除
- `handleDeleteL2` 会检查全部 L3 的 `availableL2Ids`，被引用时弹出**红色**警告后允许删除
- 警告后允许用户自行决定是否继续删除，不强制阻断

### 8. L2 质量等级配置
- 等级阈值存在 `L2Template.scoring.gradeThresholds: GradeThreshold[]`
- 导出时按 `minScore` 降序排序，第一个匹配者为等级
- **兼容旧模板**：`gradeThresholds` 为空时回落到默认 85/70 阈值逻辑
- L3 总表工程总合格率按各分部设备完好率与项目实例 `summaryWeight` 加权平均；权值为 0 或完好率无效的分部不参与
- L3 当前仍保留“总体质量等级”展示字段，等级基于现有总体评分逻辑；后续若模板要求移除，以代码和新需求为准

### 9. ~~模板自定义表格样式~~（已移除）
- `L1Template.columns.dataColumnWidth` / `summaryColumnWidth`：导出列宽，现固化为默认常量（90px / 100px），不再暴露 UI 入口
- `L1Template.styles.defaultRowHeight` / `headerRowHeight`：导出行高（30px / 40px），固化常量
- L1 模板创建/编辑对话框**已删除**「表格样式」配置区，保存时直接写入默认值

### 10. Cargo 国内镜像
- 全局配置 `~/.cargo/config.toml` 使用 USTC sparse 镜像
- 与其他项目共用同一份全局配置，**严禁随意修改**

### 11. ⚠️ WebView2 HTML5 DnD 特殊要求

Tauri 在 Windows 上使用 WebView2（Chromium 内核），但其行为与标准 Chrome **有差异**：

> `body { user-select: none }` 在 WebView2 中会**隐式禁止**任何 `draggable="true"` 元素触发 `dragstart`，导致整个拖拽 API 失效。

**必须**在所有需要拖拽的元素上显式声明：

```css
.draggable-element {
  -webkit-user-drag: element;  /* WebView2 专属修复 */
}
```

**同时注意**：`onDragLeave` 在子元素触发时会冒泡到父元素，导致 drop zone 高亮闪烁。使用 `relatedTarget` 过滤：

```typescript
function onDragLeave(e: DragEvent) {
  if ((e.currentTarget as Element)?.contains(e.relatedTarget as Node)) return
  dragOverCell.value = null
}
```

### 12. `toggleCut` 已废弃（手动切割 → 全程自动）

手动切割功能已废弃，`InspectionTable.vue` 中 `toggleCut`/`isCut` 函数已移除。

**自动切割规则（2026-04-18 更新）**：
- 每段最多 **6 个地点**，自动计算 `segmentBreaks`
- L1 导出显式写入 **A4 竖向 + 常规页边距（上下 1.91cm、左右 1.78cm、页眉页脚 0.76cm）+ 100% 缩放**
- L1 导出分页按**实际内容高度**判断：标题行、技术要求自动行高、故障行、合格率行、备注基础行高全部计入
- 当前页放不下下一个表格时，后续表格整体移动到下一页，不再按固定 `segmentsPerCol` 预估
- 同一张 L1 Sheet 内按页**横向页块排布**，后续逻辑页显示在右侧页块而不是下方
- 每一页剩余高度会**平均分配到该页所有表格的备注行**，确保页面纵向铺满
- 同位次表格的备注行高度按跨页块共享值统一，避免左右页块因行高不同而错位
- **汇总列 / 末页 7 槽位**：UI 分段预览仍每段最多 6 个地点；Excel 导出最后页非最终块可使用原汇总/占位列作为第 7 个点位槽，最终块保留 `6 个地点 + 汇总列`；仅最终块写入真实合格率和备注
- **设施名称标题行**：整行不显示边框，避免打印出现多余线框
- **列宽**：无汇总页地点列 = 10；有汇总页地点列 = 8、汇总列 = 10；`序号 / 检查项目 / 技术要求` 按 `1:3:6` 分配该页剩余可打印宽度，使每个页块横向铺满

**InspectionTable 折叠面板**：保留 `SegmentLayoutEditor` 只读预览入口，实时显示切割信息，无编辑能力。

---

## 📊 业务术语表

| 术语 | 英文标识 | 含义 |
|------|---------|------|
| 分项点检表 | L1 / InspectionTable | 最底层采集表，逐检查点打分 |
| 分部工程表 | L2 / SubdivisionTable | 中间聚合层，汇总分项合格率 |
| 单位工程总表 | L3 / SummaryTable | 顶层汇总，算总评分 |
| 点检表模板池 | L1Pool | 所有 L1 模板集合 |
| 分部模板池 | L2Pool | 所有 L2 模板集合 |
| 检查点 | Checkpoint | 点检表的动态列（地点/设备） |
| 检查项目 | InspectionItem | 点检表的固定行（检查内容） |
| 技术要求 | Requirement | 每个检查项目的判定标准 |
| 下拉选项 | textOptions | 每个检查项可配的快速选择值 |
| 穿梭框 | TransferBox | 批量选择组件，用于选取模板 |
| 合格率 | PassRate | 自动计算的合格百分比 |
| 色标 | ColorCode | 红/黄/绿/紫四色单元格语义标记 |
| 扣分项 | DeductionItem | L2 自定义的扣分配置 |
| 分段切割 | SegmentBreak | L1 表按列索引切割，导出时分段排列 |
| 布局浏览| SegmentPosition | 各段在 2D 网格中的坐标（gridRow/gridCol），由 segmentLayout.ts 管理 |
| 布局编辑器 | SegmentLayoutEditor | 只读预览组件，显示"本表将自动分为 N 段，共 M 页"及分段详情，无编辑能力 |

---

## 🔄 文档更新触发条件

当以下情况发生时，必须同步更新对应文件：

| 事件 | 更新 README.md | 更新 AGENTS.md | 更新 ONGOING.md | 更新 CHANGELOG.md |
|------|:-:|:-:|:-:|:-:|
| 需求变更 | ✅ | 可能 | ✅ | 视是否进入实现而定 |
| 架构调整 | ✅ | ✅ | ✅ | ✅ |
| 新增/删除核心文件 | ✅ | ✅ (文件索引) | ✅ | ✅ |
| 开发进度变化 | | | ✅ | 可能 |
| 发现新的技术陷阱 | | ✅ | 可能 | 可能 |
| 技术栈变更 | ✅ | ✅ | ✅ | ✅ |
| UI 主题变更 | ✅ | ✅ (§5 约束) | ✅ | ✅ |

补充说明：

- `BOOT.md` 是通用协议，通常只在“跨项目启动机制”变化时更新，不随普通业务迭代频繁修改
- `CHANGELOG.md` 只能追加，不能删除或覆盖历史
- `ONGOING.md` 是当前活跃进度的唯一主文档，`00_BOOT.md` 仅保留兼容入口作用
