# CHANGELOG.md

> 追加式修改日志。只允许在顶部新增，不允许覆盖或删除历史。

## 2026-05-05

### L3 模板分部权值配置
- **需求点**: 用户确认总表权值需要放在模板库的 L3 总表里配置。
- **路径**:
  - `vbird-esi/src/types/template.ts`
  - `vbird-esi/src/types/project.ts`
  - `vbird-esi/src/stores/templateStore.ts`
  - `vbird-esi/src/utils/projectStructure.ts`
  - `vbird-esi/src/views/TemplateManager/L3TemplateDialog.vue`
  - `vbird-esi/src/views/ProjectManager/ProjectManager.vue`
  - `vbird-esi/src/views/ProjectEditor/ProjectEditor.vue`
  - `README.md`
  - `ONGOING.md`
  - `AGENTS.md`
- **结果**:
  - `L3Template` 新增 `subdivisionWeights`，L3 模板弹窗在已关联 L2 下方配置分部权值。
  - 旧 L3 模板加载时按已关联 L2 自动补齐权值 `1`，保存时只保留当前关联 L2 的权值。
  - 新建项目、项目内新增分部和新增点位清单时，从项目关联的 L3 模板带入对应分部权值为项目实例快照。
  - 计算预览和 Excel 导出优先按 L3 模板权值解析，项目实例快照作为缺模板回退。
  - 项目编辑页的“总表权值”改为只读展示，避免与模板库配置入口冲突。
- **验证**:
  - `npx vue-tsc --noEmit` 通过
  - `npm run build` 通过（仅 Vite 大 chunk 警告）

### 点位名称网格表格级操作
- **需求点**: 用户要求点位清单中的点位名称表格像录入表一样支持复制、粘贴、删除等操作。
- **路径**:
  - `vbird-esi/src/components/LocationNamesEditor.vue`
  - `ONGOING.md`
- **结果**:
  - 点位名称网格改为显示态单元格，单击选中，双击或 `F2` / `Enter` 才进入输入。
  - 支持鼠标拖选与 Shift 扩展选区。
  - 支持 `Ctrl+A` 全选、`Ctrl+C` 复制为 TSV、粘贴 Excel 矩阵或普通文本列表。
  - 多单元格选区支持 `Delete` / `Backspace` 清空，并继续通过组件原有 `change` 事件联动数量与点位同步。
- **验证**:
  - `npx vue-tsc --noEmit` 通过
  - `npm run build` 通过（仅 Vite 大 chunk 警告）

## 2026-05-02

### 用户 3 项反馈调整
- **需求点**: 点位清单录入更贴近模板、L1 最后一页点位前移占用原 `/` 列、L3 总表按分部权值计算工程总合格率。
- **路径**:
  - `vbird-esi/src/components/LocationNamesEditor.vue`
  - `vbird-esi/src/types/project.ts`
  - `vbird-esi/src/utils/projectStructure.ts`
  - `vbird-esi/src/utils/projectCalc.ts`
  - `vbird-esi/src/utils/l1PrintLayout.ts`
  - `vbird-esi/src/utils/excelExport.ts`
  - `vbird-esi/src/views/ProjectManager/ProjectManager.vue`
  - `vbird-esi/src/views/ProjectEditor/ProjectEditor.vue`
  - `README.md`
  - `ONGOING.md`
  - `AGENTS.md`
- **结果**:
  - 点位清单录入改为 `检测部位1~6` 网格，支持 Excel/文本粘贴拆分并自动同步数量与 L1 检查点列。
  - 保留缩减点位时的已有数据删除确认；取消后恢复原点位数量和名称。
  - L1 导出使用导出专用末页槽位，最后页非最终块可显示 7 个点位，最终块保留 `6 点位 + 汇总列`。
  - `ProjectSubdivision.summaryWeight` 加入项目实例数据，旧项目默认补齐为 `1`。
  - L3 检查结果计算表新增“权值”列，总合格率改为分部设备完好率加权平均，权值为 0 的分部不参与计算。
- **验证**:
  - `npx vue-tsc --noEmit` 通过
  - `npm run build` 通过（仅 Vite 大 chunk 警告）

## 2026-04-26

### L1 点检表跨分割块交互统一
- **需求点**: 用户反馈数据格区域无法像地点行、是否故障行一样跨 6 地点分割块拖动选择，要求数据格跨分割块选择、复制、粘贴、删除和拖拽填充行为统一。
- **路径**:
  - `vbird-esi/src/components/InspectionTable.vue`
  - `AGENTS.md`
  - `ONGOING.md`
- **关键函数 / 位置**:
  - `isInSelection()`
  - `pasteSelection()`
  - `applyDragFill()`
- **结果**:
  - 移除数据格选中高亮对 `findSegmentByCol()` 的段内过滤，跨段后选区按完整矩形显示。
  - 移除数据格粘贴时按锚点段末列截断的逻辑，单格广播和 TSV 多格粘贴只按表格边界截断。
  - 删除不再使用的 `findSegmentByCol()` 辅助函数，避免未使用代码残留。
  - 保持分割块仅用于 UI 分段显示和 Excel 导出布局；地点行、是否故障行跨段逻辑保持不变。
- **验证**:
  - `npx vue-tsc --noEmit` 通过
  - `npm run build` 通过（仅 Vite 大 chunk 警告）
  - `git diff --check` 通过（仅 CRLF 提示）

### Excel 导出版式配置集中化
- **需求点**: 用户要求将所有 Excel 页面列宽、比例、打印设置等集中到一个位置，便于统一调整。
- **路径**:
  - `vbird-esi/src/config/excelLayout.ts`
  - `vbird-esi/src/utils/excelExport.ts`
  - `vbird-esi/src/utils/l1PrintLayout.ts`
- **结果**:
  - 新增 `excelLayout.ts`，集中维护 L1/L2/L3/清单/封面页的列宽、行高、页边距、缩放、打印方向、颜色、边框与 L1 前三列比例。
  - `l1PrintLayout.ts` 改为读取 `L1_PRINT_LAYOUT.fixedColumnRatio`，不再在分页工具内硬编码 `1.4:3:5.6`。
  - `excelExport.ts` 删除本地 `LAYOUT_CONFIG` 常量，统一从 `EXCEL_LAYOUT_CONFIG` 读取版式参数。
- **验证**:
  - `npx vue-tsc --noEmit` 通过

### Excel 前置清单与备注键盘删除细节整改
- **需求点**: 对齐 `other/20260425-New/表格模板1.xlsx` 的前置清单版式，并修复 L1 备注框无法用键盘删除的问题。
- **路径**:
  - `vbird-esi/src/utils/excelExport.ts`
  - `vbird-esi/src/utils/l1PrintLayout.ts`
  - `vbird-esi/src/components/InspectionTable.vue`
- **结果**:
  - `检查结果计算表` 实际打印区域限制为 `A:E`，标题与底部行不再占用 F 列。
  - `点位清单表` 改为 A-J 横向 A4，分部独占行，检测部位每行 6 个，超出自动拆行并纵向合并 A-D。
  - `结果清单` 增加公司/标题头，同分部工程纵向合并。
  - `设备清单` 增加公司/标题头，保持 A-F 样表列结构。
  - L1 点检表动态列宽微调为序号稍宽、技术要求稍窄。
  - L1 备注 `textarea` 阻止键盘事件冒泡，`Delete` / `Backspace` 不再触发表格清空选区。
- **验证**:
  - `npx vue-tsc --noEmit` 通过
  - `npm run build` 通过（仅 Vite 大 chunk 警告）
  - `git diff --check` 通过（仅 CRLF 提示）

### 20260425 新需求整改实现
- **需求点**: 落地 `other/20260425-New` 中确认后的新需求：项目级点位清单、结果清单、设备清单、设备库、重点设备、设备完好率、全量系统数据导入导出。
- **路径**:
  - `vbird-esi/src/types/device.ts`
  - `vbird-esi/src/types/project.ts`
  - `vbird-esi/src/types/template.ts`
  - `vbird-esi/src/utils/projectStructure.ts`
  - `vbird-esi/src/utils/projectCalc.ts`
  - `vbird-esi/src/utils/backup.ts`
  - `vbird-esi/src/utils/excelExport.ts`
  - `vbird-esi/src/views/ProjectManager/ProjectManager.vue`
  - `vbird-esi/src/views/ProjectEditor/ProjectEditor.vue`
  - `vbird-esi/src/views/TemplateManager/TemplateManager.vue`
  - `vbird-esi/src/views/TemplateManager/L1TemplateDialog.vue`
  - `vbird-esi/src/components/InspectionTable.vue`
- **结果**:
  - 新建项目改为 L3 后建项向导，默认空选 L2/L1，并按 L1 初始化单位、数量、点位名称。
  - 项目编辑页新增 `数据录入 / 点位清单 / 结果清单 / 设备清单` 四个项目内 Tab，点位清单成为项目结构主数据源。
  - 旧项目加载时自动从已有 L1 检查点反推项目级点位清单。
  - L1 模板支持重点设备字段与检查项设备关联；模板管理新增检查设备库。
  - 计算口径改为有效点位、真实故障数量与重点设备最低项规则，术语统一为设备完好率。
  - Excel 导出前置输出 `检查结果计算表 / 点位清单表 / 结果清单 / 设备清单`，并净化非法 Sheet 名。
  - 系统数据导入导出采用单 JSON 全量备份包；导入时整体替换现有模板、项目、设备库。
- **验证**:
  - `npx vue-tsc --noEmit` 通过
  - `npm run build` 通过（仅 Vite 大 chunk 警告）

## 2026-04-18

### 18:47:58 — 恢复 L1 页型动态列宽

- **需求点**: 用户要求恢复 L1 列宽规则：无汇总页地点列宽 `10`；有汇总页地点列宽 `8`、汇总列宽 `10`；其余可打印宽度由 `序号 / 检查项目 / 技术要求` 按 `1:3:6` 分配。
- **路径**:
  - `vbird-esi/src/utils/l1PrintLayout.ts`
  - `vbird-esi/src/utils/excelExport.ts`
  - `AGENTS.md`
  - `README.md`
  - `ONGOING.md`
- **关键函数 / 位置**:
  - `getPrintableWidthPt()`
  - `getL1PageBlockSpec()`
  - `buildL1WorksheetLayout()`
  - `setL1ColWidths()`
- **结果**:
  - L1 列宽改为按页型动态生成，不再整张表复用同一套固定列宽
  - 无汇总页只占 9 列，有汇总页占 10 列；后续页块列起点按实际列数连续累加
  - `printArea` 改为覆盖所有实际页块，不再保留无汇总页的隐式空汇总列
  - 高度与分页逻辑保持现状，仅调整列宽链路

### 18:07:51 — 恢复 L1 同 Sheet 左右页块布局

- **需求点**: 修正 L1 导出被改成同 sheet 纵向堆叠后，第 3/4 表落到下方而不是显示在第 1/2 表右侧的问题。
- **路径**:
  - `vbird-esi/src/utils/l1PrintLayout.ts`
  - `vbird-esi/src/utils/excelExport.ts`
  - `AGENTS.md`
  - `README.md`
  - `ONGOING.md`
- **关键函数 / 位置**:
  - `buildL1PrintPages()`
  - `buildL1WorksheetLayout()`
  - `buildL1Sheet()`
- **结果**:
  - L1 保留“按真实打印区高度做逻辑分页”，但 worksheet 落盘改回同 sheet 横向页块排布
  - 每个逻辑页占一组固定列块，后续逻辑页显示在前一页块右侧，打印顺序回到 `overThenDown`
  - 同位次表格的备注行高度按跨页块共享值统一，缺失位次自动补占位表，避免左右页块错位
  - 删除纵向 `rowBreaks` 分页落地，`printArea` 改为覆盖整块二维页块区域

### 17:34:12 — 修正 L1 横向误分页

- **需求点**: 修正导出后第 2/3 页在 Excel 中跑到第一页侧边，没有按纵向连续分页展示的问题。
- **路径**:
  - `vbird-esi/src/utils/l1PrintLayout.ts`
  - `vbird-esi/src/utils/excelExport.ts`
  - `AGENTS.md`
  - `README.md`
  - `ONGOING.md`
- **关键函数 / 位置**:
  - `L1_PRINT_LAYOUT`
  - `buildL1Sheet()`
- **结果**:
  - `pageOrder` 从 `overThenDown` 改为 `downThenOver`
  - L1 单页列宽从临界值回收为 `Seq:5 / Item:10 / Req:15 / Loc:7.5 / Sum:9`
  - `row.addPageBreak(1, printColCount)` 改为全宽 `row.addPageBreak()`，避免最右侧汇总列未被分页符覆盖
  - 后续页面不再因横向误分页跑到第一页旁边

### 17:16:09 — Excel pageSetup 对齐与 L1 显式分页符

- **需求点**: 修正 L1 自动行高后分页仍与 Excel 实际打印区不一致的问题，要求按 Excel 常规页边距分页，并避免第三个表越过打印区。
- **路径**:
  - `vbird-esi/src/utils/l1PrintLayout.ts`
  - `vbird-esi/src/utils/excelExport.ts`
  - `AGENTS.md`
  - `README.md`
  - `ONGOING.md`
- **关键函数 / 位置**:
  - `buildL1PrintPages()`
  - `estimateWrappedRowHeight()`
  - `buildL1Sheet()`
- **结果**:
  - L1 导出显式写入 Excel `pageSetup`：A4 竖向、上下 1.91cm、左右 1.78cm、页眉页脚 0.76cm、100% 缩放
  - L1 同一张 Sheet 内按页纵向顺排，并通过 `row.addPageBreak()` 显式分页，避免不同打印页共享行高
  - 行高估算改为基于 Excel 列宽近似像素宽度，同时加入打印安全余量，降低临界页越界风险
  - 导出 `printArea` 只覆盖实际使用区域，打印预览与分页预览更一致
- **引出关系**: 由用户继续反馈“第三个表仍然超过打印区”，进一步追查到 pageSetup 与实际打印区未对齐触发

### 16:37:29 — Excel 内容感知分页与备注补齐

- **需求点**: 修正 L1 导出在技术要求自动行高后仍按固定高度分页，导致第三个表越页判断错误；同时要求每页余高均分到备注行，并将设施名称标题整行去边框。
- **路径**:
  - `vbird-esi/src/utils/l1PrintLayout.ts`
  - `vbird-esi/src/utils/excelExport.ts`
  - `vbird-esi/src/components/SegmentLayoutEditor.vue`
  - `AGENTS.md`
  - `README.md`
  - `ONGOING.md`
- **关键函数 / 位置**:
  - `buildL1PrintPages()`
  - `writeL1SegmentBody()`
  - `SegmentLayoutEditor.vue` 页数预览
- **结果**:
  - L1 导出分页改为按实际内容高度判断，不再用固定 `segmentsPerCol` 预估
  - 同一页的剩余高度平均分配到该页所有表格的备注行，页面纵向铺满
  - 设施名称标题整行取消边框，打印时不再显示线框
  - 自动切割预览页数与新的导出分页逻辑保持一致
- **引出关系**: 由用户继续反馈自动行高后分页错误与备注行补齐需求触发

### 16:15:28 — Excel 标题行补齐与检查结果计算预览

- **需求点**: 修正 L1 占位段也要显示设施名称、设施名称标题行右侧去边框，以及在项目编辑页提供导出前的《检查结果计算》数值预览。
- **路径**:
  - `vbird-esi/src/utils/excelExport.ts`
  - `vbird-esi/src/utils/projectCalc.ts`
  - `vbird-esi/src/views/ProjectEditor/ProjectEditor.vue`
  - `AGENTS.md`
  - `README.md`
  - `ONGOING.md`
- **关键函数 / 位置**:
  - `writeL1SegmentBody()`
  - `buildProjectCalcPreview()`
  - `ProjectEditor.vue` 顶部“检查结果计算预览”按钮与弹窗
- **结果**:
  - L1 所有导出块（含占位段）左上角统一显示设施名称
  - L1 设施名称标题行右侧数据区取消边框，打印更干净
  - 新增共享汇总计算工具，统一导出页与页面预览的总量 / 故障数量 / 合格率 / 分部评分计算
  - 项目编辑页新增“检查结果计算预览”弹窗，可在导出前查看项目总览与分部/L1 明细
- **引出关系**: 由用户继续追补 Excel 导出细节与导出前预览需求触发

### 16:01:19 — Excel 导出设施名称合并与行高自适应

- **需求点**: 修正 L1 点检表左上角“设施名称”标题未占满固定三列，以及长技术要求换行后被固定行高裁切的问题。
- **路径**:
  - `vbird-esi/src/utils/excelExport.ts`
- **关键函数 / 位置**:
  - `buildL1Sheet()`
  - `writeL1SegmentBody()`
  - `estimateWrappedRowHeight()`
- **结果**:
  - L1 每个导出段新增“设施名称”标题行，并合并当前段的“序号 / 检查项目 / 技术要求”三列
  - 技术要求行高改为按文本长度、列宽、显式换行自动估算，并保留原最小高度兜底
  - 备注行同步复用自动高度估算，避免长文本在导出 Excel 中被遮挡
- **引出关系**: 由用户提出 Excel 导出结构与长文本显示问题触发

### 15:07:03 — 文档内存系统统一

- **需求点**: 将新的 `BOOT.md` 通用启动协议整合进当前项目，建立统一、可持续的 AI 开发文档体系。
- **路径**:
  - `BOOT.md`
  - `AGENTS.md`
  - `README.md`
  - `ONGOING.md`
  - `00_BOOT.md`
  - `CHANGELOG.md`
- **关键位置**:
  - `AGENTS.md`：首要行动 / 文档内存系统 / 文档更新触发条件
  - `README.md`：AI 接手顺序 / 项目目录结构 / 当前状态
  - `00_BOOT.md`：兼容跳转入口
- **结果**:
  - 新增 `ONGOING.md` 作为当前活跃进度主文档
  - 新增 `CHANGELOG.md` 作为追加式日志
  - `00_BOOT.md` 降级为兼容入口，避免和 `ONGOING.md` 双写漂移
  - 项目根文档职责统一为：`BOOT + AGENTS + README + ONGOING + CHANGELOG`
- **引出关系**: 由用户新增 `BOOT.md` 并要求整合进项目文档体系触发

### 15:07:03 — Excel 导出三处版式微调

- **需求点**: 修正封面页居中打印、分部页空白占位行结构对齐、L1 点检表备注行合并范围。
- **路径**:
  - `vbird-esi/src/utils/excelExport.ts`
- **关键函数 / 位置**:
  - `buildCoverSheet()`
  - `buildL2Sheet()`
  - `writeL1SegmentBody()`
- **结果**:
  - 封面页第 20 行改为 `A:J` 合并并居中
  - 分部页空白占位行补齐 `B:C` 与 `E:G` 合并
  - 备注内容区按是否存在汇总列动态扩展合并范围
- **引出关系**: 由用户提出 Excel 导出排版细节调整需求触发
