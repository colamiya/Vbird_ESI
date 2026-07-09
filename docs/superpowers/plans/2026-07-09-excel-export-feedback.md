# Excel Export Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按客户反馈修正 L1 点检表末页列数、合格率位置、检查体系结构序号回归保护，以及备注独立页特殊场景。

**Architecture:** 保持现有 ExcelJS 导出链路不变，改动集中在 `l1PrintLayout.ts` 的分页模型和 `excelExport.ts` 的 L1 落盘渲染。`检查体系结构` 现有代码已按每个 L2 分部内 `l1Idx + 1` 重新编号，本次只补充多 L2 回归样本与校验，防止被误改为全局连续序号。

**Tech Stack:** Tauri v2 + Vue 3 + TypeScript strict + ExcelJS。

## Global Constraints

- 始终使用简体中文说明、注释和文档字符串。
- 不改变 L1 -> L2 -> L3 数据流。
- 不引入新 UI 框架、表格引擎、数据库或外部网络依赖。
- Excel 导出继续使用 `src/utils/excelExport.ts` + ExcelJS。
- 代码修改后检查是否需要同步 `ONGOING.md` 与 `CHANGELOG.md`。

---

## Current Understanding

1. `Test.xlsx` 中 `消防设施点检` 有 32 个点位。当前导出将最后逻辑页重排为每块 7 个点位：`19~25`、`26~32`，因此最终块没有汇总列，`设备完好率` 行最后一列为空。
2. 客户要求“最后一页还是做成 6 列”，即取消当前导出专用的末页 7 槽位规则，所有点检块仍最多 6 个点位，最终块保留第 7 列作为汇总列。
3. 客户要求“最后一排最后一列还需要合格率”，即最终块 `设备完好率` 行的汇总列必须写入整张 L1 的总完好率。
4. `检查体系结构` 的现有实现位于 `src/utils/excelExport.ts`，每个 `sub.selectedL1Ids.forEach((l1Id, l1Idx) => ...)` 内写 `l1Idx + 1`，已经是每个 L2 分部内从 1 重新编号。需要补充多 L2 样本验证。
5. 特殊备注页规则：如果最终点位块到达页尾，导致按正常结构放不下备注，则新增一个只承载备注的空白逻辑页，不再把备注压到最终点位块中。

## Files

- Modify: `vbird-esi/src/utils/l1PrintLayout.ts`
  - 移除或停用 `buildL1ExportPrintPages()` 的末页 7 槽位重排。
  - 增加备注独立页的布局表达，例如 `isNotesOnly?: boolean`。
- Modify: `vbird-esi/src/utils/excelExport.ts`
  - L1 渲染时不再根据最后页无汇总列使用 `maxLocPerSeg + 1`。
  - 增加备注独立页写入函数，备注内容纵向合并到该逻辑页打印区域底部。
- Modify: `vbird-esi/scripts/generate-fire-export-sample.ts`
  - 继续用 32 点位样本回归末页 6 点位 + 汇总列。
- Modify or Create: `vbird-esi/scripts/generate-export-style-sample.ts`
  - 增加多 L2、多 L1 的检查体系结构样本或校验。
- Modify: `ONGOING.md`
  - 追加本次客户反馈和验证重点。
- Modify: `CHANGELOG.md`
  - 顶部追加本次 Excel 导出规则修正。

## Tasks

### Task 1: 取消 L1 导出末页 7 槽位

**Files:**
- Modify: `vbird-esi/src/utils/l1PrintLayout.ts`
- Modify: `vbird-esi/src/utils/excelExport.ts`

- [ ] 在 `buildL1ExportPrintPages()` 中停止传入 `useLastPageSevenSlots = true`，改为复用每段最多 6 点位的普通分页。
- [ ] 删除或保留未调用的 `applyLastPageSevenSlotMetrics()`；如果保留，注释必须说明该旧规则已废弃，避免误用。
- [ ] 在 `buildL1Sheet()` 中把 `locationSlotCount` 固定为 `LAYOUT_CONFIG.l1.maxLocPerSeg`，不再因最后页且无汇总列改成 7。
- [ ] 确认最终段 `hasSummarySlot = true` 且 `isLastEffectiveSeg = true`，使 `writeL1SegmentBody()` 在汇总列写入 `calcTotalPassRate(...)`。

### Task 2: 实现备注独立页特殊规则

**Files:**
- Modify: `vbird-esi/src/utils/l1PrintLayout.ts`
- Modify: `vbird-esi/src/utils/excelExport.ts`

- [ ] 在分页计算中拆分“最终点位块高度”和“备注高度”：最终点位块先包含标题、表头、数据行、是否故障、设备完好率。
- [ ] 当最终点位块可放入当前页，但剩余高度小于备注最小高度 `L1_PRINT_LAYOUT.notesRowH` 时，追加一个 `isNotesOnly` 逻辑页。
- [ ] `isNotesOnly` 页使用同一页宽规格：前三固定列 + 6 个点位宽 + 汇总列，打印区域仍按 A4 竖向页块生成。
- [ ] 在 `excelExport.ts` 增加备注页写入逻辑：左侧写设备名称或留空，`技术要求`列写 `备注`，内容从第一个点位列开始合并到汇总列，并纵向合并到该页底部。
- [ ] 非特殊场景继续保持现有行为：备注留在最终点位块，并向下合并到打印区域底行。

### Task 3: 补充检查体系结构多 L2 回归

**Files:**
- Modify or Create: `vbird-esi/scripts/generate-export-style-sample.ts`

- [ ] 构造至少 2 个 L2 分部，每个 L2 下至少 2 个 L1。
- [ ] 生成工作簿后读取 `检查体系结构` Sheet，断言每个 L2 分部后的 L1 序号均从 `1` 开始。
- [ ] 保持现有 `buildInspectionSystemSheet()` 中 `l1Idx + 1` 的局部分部编号逻辑，不改为全局计数器。

### Task 4: 生成样本并做结构校验

**Files:**
- Modify: `vbird-esi/scripts/generate-fire-export-sample.ts`

- [ ] 重新生成 32 点位样本。
- [ ] 校验 `消防设施点检` 中最后页不再出现 7 个点位列。
- [ ] 校验最终点位块存在汇总列，且 `设备完好率` 行最后一列为总完好率，例如当前样本应为 `90.6%`。
- [ ] 增加一个“最终点位块到页尾”的长表样本，确认生成独立备注页。

### Task 5: 构建与文档同步

**Files:**
- Modify: `ONGOING.md`
- Modify: `CHANGELOG.md`

- [ ] 运行 `npm run build`。
- [ ] 运行 `git diff --check`。
- [ ] 在 `ONGOING.md` 记录本次客户反馈、已改规则和待回归点。
- [ ] 在 `CHANGELOG.md` 顶部追加本次 Excel 导出修正记录。

## Verification Commands

```powershell
cd Z:\repos\002_VbirdP\Vbird_ESI\vbird-esi
npm run build
npx tsx scripts/generate-fire-export-sample.ts
git -c safe.directory="Z:/repos/002_VbirdP/Vbird_ESI" diff --check
```

## Acceptance Criteria

- 32 点位 L1 导出末页仍按 6 点位一块排布。
- 最后一个有效点位块显示汇总列。
- `设备完好率` 行最后一列写入整张 L1 的总合格率。
- 多 L2 场景下，`检查体系结构` 每个 L2 内的 L1 序号均从 1 开始。
- 最终点位块到页尾且备注放不下时，新增备注专页，备注内容合并填满该页可打印区域。
