# CHANGELOG.md

> 追加式修改日志。只允许在顶部新增，不允许覆盖或删除历史。

## 2026-07-09

### L1 最终块 5 点位 + 汇总列与备注 3 行规则
- **需求点**: 客户复核消防样本后确认：消防泵房备注超过 3 行时只需要 1 个备注页；灭火器末页结果区仍是 6 个槽位，但最后一个有效表应为 5 个地点 + 1 个汇总列；最终有效表备注至少预留 3 行文本高度，超过 3 行直接独立成页。
- **路径**:
  - `vbird-esi/src/utils/l1PrintLayout.ts`
  - `vbird-esi/src/utils/excelExport.ts`
  - `vbird-esi/scripts/generate-fire-safety-regression-sample.ts`
  - `AGENTS.md`
  - `README.md`
  - `ONGOING.md`
- **结果**:
  - L1 导出最终块的地点槽位改为 5 个，汇总列占用第 6 个结果槽位，不再形成“6 地点 + 汇总列”的 7 槽视觉结构。
  - 2026-07-09 复核修正：最终块是“最多 5 个地点”，不是“必须 5 个地点”；正常按 6 个地点顺序分段，只有最后自然剩余的点位进入最终汇总块。
  - 2026-07-09 补充边界：当真实点位刚好填满 6 点位块（例如最后一页正好 18 个点位）时，真实点位页保持完整，另起最终汇总块，输出 5 个空点位 + 汇总列，并在下方备注区域填满页面。
  - 最终块备注高度至少按 3 行文本估算；备注文本超过 3 行时强制生成独立备注页。
  - 备注独立页只生成 1 个 A4 页块，并从页块首行合并填充到该 A4 打印区域底部。
  - 2026-07-09 复核修正：L1 横向页块写入 Excel 原生列分页符，避免 Excel 自动把 `A:R` 这类双页块错误拆成 3 张 A4。
  - 2026-07-09 再修正：独立备注页不再作为右侧横向页块输出，改为同 Sheet 下方的独立 A4 多打印区域；同时修补 ExcelJS `_xlnm.Print_Area` 多区域写入，避免消防泵房备注继承正文行分页被拆成 3 页。

### L1 末页 6 点位与备注专页修复
- **需求点**: 客户反馈点检表最后一页仍应保持 6 个地点列，最后一排最后一列必须显示合格率；检查体系结构在多个 L2 下应按每个 L2 内部重新编号；最终点位块到页尾导致备注放不下时，应另起一页备注。
- **路径**:
  - `vbird-esi/src/utils/l1PrintLayout.ts`
  - `vbird-esi/src/utils/excelExport.ts`
  - `vbird-esi/scripts/generate-fire-safety-regression-sample.ts`
  - `AGENTS.md`
  - `README.md`
  - `ONGOING.md`
- **结果**:
  - 废弃 L1 导出专用末页 7 槽位规则，Excel 导出恢复为所有点位块最多 6 个地点。
  - 最终点位块保留汇总列，并在“设备完好率”行最后一列写整张 L1 的设备完好率。
  - 分页模型新增备注溢出页：最终点位块可放下但备注放不下时，备注独立生成 A4 页块。
  - 新增消防安全多分部、多点检、多地点回归样本，覆盖 32 点位末页、多个 L2 编号重置和备注专页。
- **验证**:
  - 本地临时副本 `npm run build` 通过（仅 Vite 大 chunk 与动态导入提示）。
  - `git diff --check` 通过（仅 CRLF 提示）。
  - 已生成 `vbird-esi/outputs/excel-style-check/消防安全多点检闭环.xlsx`。
  - 已生成 A4 页块视觉检查图片与 PDF：`vbird-esi/outputs/excel-style-check/print-pages/`。

## 2026-07-08

### ExcelJS 异常打印参数修复
- **问题点**: 消防导出文件在 Excel 打开时提示整个工作簿异常，而非单个 Sheet 内容错误。
- **路径**:
  - `vbird-esi/src/utils/excelExport.ts`
  - `vbird-esi/scripts/generate-fire-export-sample.ts`
- **结果**:
  - 排查 `.xlsx` 内部 XML 后确认 ExcelJS 写入了异常打印参数 `horizontalDpi/verticalDpi=4294967295`，客户模板无该字段。
  - 新增 `sanitizeWorkbookPageSetup()`，在工作簿写出前统一清理异常 DPI、打印机默认值及冲突的缩放字段。
  - 重新生成消防确认文件：`vbird-esi/outputs/excel-style-check/消防设施效果确认.xlsx`。
- **验证**:
  - 解包 XML 确认已无 `4294967295`、`horizontalDpi`、`verticalDpi`。
  - `openpyxl` 可正常读取所有 Sheet。
  - `git diff --check` 通过。
  - `npm run build` 通过（仅 Vite 大 chunk 警告）。

### L1 最后有效备注填满页底
- **问题点**: 最后一页只有上方有效点位块时，备注仅占当前槽位高度，下方空槽未被备注栏填满。
- **路径**:
  - `vbird-esi/src/utils/excelExport.ts`
- **结果**:
  - 最后有效点位块的“备注”标签列和备注内容列改为纵向合并到 L1 打印区域底行。
  - 不调整全局行高，避免影响同一 Sheet 内其他横向页块分页。
- **验证**:
  - 消防样本 `消防设施点检` 打印区域为 `A1:S29`，备注内容合并区域为 `M19:S29`，备注标签合并区域为 `L19:L29`。
  - `git diff --check` 通过。
  - `npm run build` 通过（仅 Vite 大 chunk 警告）。

## 2026-07-07

### L1 多点位分页尾部结构修正
- **需求点**: 用户用 32 个点位核对 `视频监控外观点检` 后反馈：右侧页块末尾空地点段应删除；除最后点位段外，其他段不应输出“设备完好率/备注”；最后点位段备注应填充到该打印页末尾。
- **路径**:
  - `vbird-esi/src/utils/l1PrintLayout.ts`
  - `vbird-esi/src/utils/excelExport.ts`
  - `vbird-esi/scripts/generate-export-style-sample.ts`
- **结果**:
  - `applyLastPageSevenSlotMetrics()` 改为最后一个有点位的槽才作为最终槽，32 点位场景不再生成空的第三个右侧占位段。
  - L1 非最终导出块只写到“是否故障”行，不再写“设备完好率/备注”。
  - 最终导出块写“设备完好率/备注”，备注内容区域纵向合并到该页块底部。
  - 测试脚本将 `视频监控外观点检` 扩展为 32 个点位，便于持续核对分页。
- **验证**:
  - `npm run build` 通过（仅 Vite 大 chunk 警告）

### 结果清单标度列补充
- **需求点**: 客户确认 `结果清单` 新增“标度”列即评定等级，应按所属 L2 模板“质量等级配置”对每个 L1/组合完好率进行判定；“检查体系结构”的检测方法来自 L1 模板创建时填写。
- **路径**:
  - `vbird-esi/src/utils/projectCalc.ts`
  - `vbird-esi/src/utils/excelExport.ts`
  - `vbird-esi/src/config/excelLayout.ts`
  - `vbird-esi/src/views/ProjectEditor/ProjectEditor.vue`
- **结果**:
  - 新增 `calcGradeByThresholds()`，按 L2 `gradeThresholds` 从高到低匹配 L1/组合完好率，旧模板无阈值时回退默认优良/合格/不合格。
  - 项目页 `结果清单` 新增“标度”列。
  - Excel `结果清单` 扩展为 `序号/分部工程/分项工程/设备总数/故障台数/设备完好率/标度`，并按客户截图将“设备总数”和“标度”列填充黄色底。
- **验证**:
  - `npx vue-tsc --noEmit` 通过

## 2026-07-05

### 客户补充口径初版
- **需求点**: 客户明确 L1 分拆表现为多个独立分项点检表，只在结果中按权重合并最终完好率；手动判定作为第三种检查项类型；项目级技术要求需支持文本与数值范围。
- **路径**:
  - `vbird-esi/src/types/cell.ts`
  - `vbird-esi/src/types/project.ts`
  - `vbird-esi/src/utils/projectCalc.ts`
  - `vbird-esi/src/utils/projectRequirement.ts`
  - `vbird-esi/src/utils/numericRule.ts`
  - `vbird-esi/src/utils/excelExport.ts`
  - `vbird-esi/src/components/InspectionTable.vue`
  - `vbird-esi/src/views/TemplateManager/L1TemplateDialog.vue`
  - `vbird-esi/src/views/ProjectManager/ProjectManager.vue`
  - `vbird-esi/src/views/ProjectEditor/ProjectEditor.vue`
- **结果**:
  - 检查项类型新增 `manual` 手动判定：数据格自由输入，默认合格，可单格切换为不合格，行合格率按手动判定统计。
  - 点位清单和新建项目向导新增“结果组合/权重”：同一分部下组合名相同的多个 L1 独立录入、独立导出 L1 Sheet，但在 L2/结果清单/L3 汇总中合并为一条最终完好率。
  - 项目级技术要求覆盖从纯文本升级为结构化覆盖，模板技术要求留空时项目中可选择文本或数值范围；数值范围会参与该行合格率判定。
- **验证**:
  - `npx vue-tsc --noEmit` 通过
  - `npm run build` 通过（仅 Vite 大 chunk 警告）

### 第一批客户新模板确定变更
- **需求点**: 落地设备编号、结果清单设备总数、检查体系结构 Sheet、项目级可填写技术要求与导出前缺失拦截；Word 导出不实施。
- **路径**:
  - `vbird-esi/src/types/device.ts`
  - `vbird-esi/src/types/template.ts`
  - `vbird-esi/src/types/project.ts`
  - `vbird-esi/src/utils/projectRequirement.ts`
  - `vbird-esi/src/utils/projectCalc.ts`
  - `vbird-esi/src/utils/projectStructure.ts`
  - `vbird-esi/src/utils/excelExport.ts`
  - `vbird-esi/src/views/TemplateManager/TemplateManager.vue`
  - `vbird-esi/src/views/TemplateManager/L1TemplateDialog.vue`
  - `vbird-esi/src/views/ProjectEditor/ProjectEditor.vue`
  - `vbird-esi/src/views/ProjectManager/ProjectManager.vue`
- **结果**:
  - 设备库新增 `serialNumber`，设备清单页面与 Excel 导出新增“设备编号”列。
  - 结果清单页面与 Excel 导出新增“设备总数”列，取 L1 有效点位总数。
  - L1 检查项新增 `inspectionMethod`，Excel 前置 Sheet 新增“检查体系结构/检查内容及方法清单”。
  - L1 模板技术要求允许留空；模板留空的检查项可在项目点检表技术要求列填写，保存时仅提醒，导出前强制补齐。
  - L1 导出使用项目级有效技术要求，旧项目缺少 `requirementOverrides` 时自动兼容。
- **验证**:
  - `npx vue-tsc --noEmit` 通过
  - `npm run build` 通过（仅 Vite 大 chunk 警告）

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
