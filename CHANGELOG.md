# CHANGELOG.md

> 追加式修改日志。只允许在顶部新增，不允许覆盖或删除历史。

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
