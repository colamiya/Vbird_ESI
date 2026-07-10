# 2026-07-10 新对话交接：模板顺序、L1 结果组合、单对象导入导出

## 当前结论

客户已确认实施 `docs/superpowers/specs/2026-07-10-template-order-grouping-and-single-package-design.md` 中的方案。该设计文档已提交：`2cb9e5d docs: add template order and package design`。

本次尚未修改业务代码，也尚未执行构建验证。新对话应先完成设计对应的实施计划，再开始代码改动。

## 启动顺序

1. 在项目根目录执行 `git status --short --branch`。
2. 阅读 `BOOT.md`、`AGENTS.md`、`ONGOING.md`、`README.md`。
3. 阅读已确认设计文档和本交接文档。
4. 按当前运行环境要求读取 `writing-plans` 技能，并以已确认设计为依据编写实施计划；无需重新向客户确认需求。

## 客户已确认的功能

1. L2 内 L1、L3 内 L2 均需可手动排序。排序入口位于模板关联穿梭框右侧；保存后，项目向导、项目分部/L1 Tab、点位清单、检查体系结构、结果清单、检查结果计算表和 Excel 导出均遵循此顺序。输出序号必须连续为 `1、2、3……`。
2. L1 模板新增“结果组合名称、组合权值”。同一 L2 内同名的 L1 独立录入和独立导出，但点位清单、检查体系结构、结果清单、L2/L3 汇总按组合后的设施展示和计算。
3. 组合配置采用模板默认、项目快照：项目创建或新增 L1 时复制模板值；修改模板不影响已有项目；项目点位清单不再编辑组合名和权值。
4. L1 Excel 同页多个表块之间必须保持固定间隔，剩余高度只能填充最下方最后一个有效表块的备注区域；放不下的表块整体换页。
5. 每个项目、L1、L2、L3 都需要单独导出/导入。对象包必须携带所需依赖，导入默认创建副本并重映射冲突 ID，不能默认覆盖本机数据。全量系统备份的整体替换行为维持不变。

## 当前代码定位

### 顺序

- `vbird-esi/src/types/template.ts`：`L2Template.availableL1Ids`、`L3Template.availableL2Ids` 已是有序数组，可直接作为唯一顺序来源。
- `vbird-esi/src/views/TemplateManager/L2TemplateDialog.vue`、`L3TemplateDialog.vue`：现有穿梭框没有排序控制。
- `vbird-esi/src/views/ProjectManager/ProjectManager.vue`：新建项目向导目前按模板 Store 过滤顺序遍历，必须改为先按 L3 的 `availableL2Ids`，再按 L2 的 `availableL1Ids`。
- `vbird-esi/src/utils/excelExport.ts`：前置清单目前多处遍历 `project.subdivisions` 或 `selectedL1Ids`；需通过集中排序辅助函数统一处理。
- `vbird-esi/src/utils/projectStructure.ts`：`syncLocationItemToProject()` 目前向 `selectedL1Ids` 末尾追加，应在同步后按对应 L2 模板排序。

提供的备份中 L3 `隧道检查` 顺序为“供配电、照明、通风、消防、监控与通信”，但导出的样例前置清单从消防开始，正好可作回归依据。

### 结果组合

- `vbird-esi/src/types/project.ts` 已有 `ProjectLocationItem`、`InspectionTableData` 的 `resultGroupName`、`resultWeight`。
- `vbird-esi/src/utils/projectCalc.ts` 的 `buildSubdivisionL1Rows()` 已按项目级组合名合并并做加权计算。
- `vbird-esi/src/views/ProjectManager/ProjectManager.vue`、`ProjectEditor.vue` 目前让用户在项目向导/点位清单输入组合名和权值；需要改为从 L1 模板取默认值，并移除这些项目级编辑入口。
- `vbird-esi/src/views/TemplateManager/L1TemplateDialog.vue`、`vbird-esi/src/types/template.ts` 需要新增 L1 模板组合字段和表单项。
- `vbird-esi/src/utils/projectStructure.ts` 中 `createInspectionData()`、`syncLocationItemToProject()` 需要把模板默认值复制为快照；旧项目不能在加载时强行改写。
- `vbird-esi/src/utils/excelExport.ts` 的 `buildLocationListSheet()`、`buildInspectionSystemSheet()`、`buildResultListSheet()` 要统一使用组合后的行模型；L1 Sheet 导出仍按单个 L1。

### L1 分页

- `vbird-esi/src/utils/l1PrintLayout.ts` 中 `buildL1PrintPagesCore()` 按 `remainingHeight / pageMetrics.length` 平均分配余高。
- `buildL1WorksheetLayout()` 也按 `remainingHeight / maxSegmentsPerPage` 计算同位次共享备注高度。
- 两处都要改为固定 `pageGapPt`，并将可用余高只加到最下方槽位。注意横向页块行高共享的现有约束，以及最终汇总块、独立备注页规则不可回退。

### 单对象包

- 现有全量备份位于 `vbird-esi/src/utils/backup.ts`，`FullBackupPackage` 版本为 1，导入会清空所有目录再整体替换。
- 新增独立的版本化对象包工具，不要破坏全量备份接口。
- `L1` 包携带引用的设备库条目；`L2` 包携带 L1 与设备；`L3` 包携带 L2/L1 与设备；项目包携带项目关联的 L3/L2/L1 与设备。
- 导入前先校验包类型和引用闭包；ID 冲突时递归重映射包内关联，保存成“（导入）”副本。导入失败不能部分写入。
- UI 入口放在项目管理与模板管理各对象的操作区域，按类型过滤导入文件。

## 样例资料

- Excel 样例：`C:/Users/Gene/AppData/Local/Temp/vmware-Gene/VMwareDnD/16e221e6/隧道检查.xlsx`
- 全量备份：`C:/Users/Gene/AppData/Local/Temp/vmware-Gene/VMwareDnD/5915ba38/ESI-backup-2026-07-10-1.json`

这些路径位于当前虚拟机临时目录；若新环境无法访问，应从对话附件重新取得或向用户索取副本。

## 验证要求

1. 增加或扩展定向回归样本，至少覆盖 L3/L2/L1 自定义排序、三张同组合 L1、独立 L1、零权值和无效完好率。
2. 导出并检查“点位清单表、检查体系结构、结果清单、检查结果计算表”和 L1 独立 Sheet 的顺序、连续序号、组合内容与权值结果。
3. 覆盖三表同页、页尾两表、独立备注页，确认只有最底部备注区拉伸。
4. 覆盖项目/L1/L2/L3 单对象包导出、跨空数据环境导入、冲突副本导入和非法包拒绝。
5. 执行 `npx vue-tsc --noEmit`、`npm run build`、`git diff --check`。共享盘 `node_modules` 曾有半安装 `ENOTEMPTY` 问题，若复现，在本地临时副本验证，不要随意删除共享盘依赖。

## 文档与 Git 注意事项

- 实现完成后同步更新 `README.md`、`AGENTS.md`、`ONGOING.md`、`CHANGELOG.md`；其中 `CHANGELOG.md` 仅能在顶部追加。
- 当前分支为 `main`，已比 `origin/main` 多一个设计文档提交。
- 工作区已有一个与本任务无关的已删除 Excel 临时锁文件：`vbird-esi/outputs/excel-style-check/~$消防安全多点检闭环_20260709_18点位满页验证.xlsx`。不要恢复、暂存或删除它。
