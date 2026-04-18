# Phase15-2 新需求整改计划

**目标**：落地 5 条新增需求：ProjectEditor 增加 L1 二级头部选择；Excel 导出按“全局末尾汇总列”规则输出；模板编辑仅保留下拉/数值两类并提供数值条件配置；并按最新合并/占位规则输出“故障/合格率/备注”三行结构。

---

## 0. 当前状态（基于代码勘察）

### 0.1 项目编辑器 L1 管理现状
- 当前在 [ProjectEditor.vue](file:///d:/Code/Vbird_ESI/vbird-esi/src/views/ProjectEditor/ProjectEditor.vue#L387-L428) 内对 `currentSub.selectedL1Ids` 做 `v-for`，把所有 L1 表“挤在一页”。
- 添加 L1 通过 `<el-select @change="addL1ToSubdivision">` 完成 [ProjectEditor.vue:L387-L405](file:///d:/Code/Vbird_ESI/vbird-esi/src/views/ProjectEditor/ProjectEditor.vue#L387-L405)。
- `addL1ToSubdivision()` 初始化 `inspectionData[l1Id]` [ProjectEditor.vue:L198-L220](file:///d:/Code/Vbird_ESI/vbird-esi/src/views/ProjectEditor/ProjectEditor.vue#L198-L220)。

### 0.2 Excel 导出 L1 现状
- 入口在 [excelExport.ts](file:///d:/Code/Vbird_ESI/vbird-esi/src/utils/excelExport.ts)。
- L1 导出核心在 `buildL1Sheet()` 与 `writeL1SegmentBody()`（两者需按本次新规则再调整）。
- 当前 `writeL1SegmentBody()` 的“合格率/备注”仅在最后段输出（需改为每段都输出，但仅最后段有数值，其余 `/`）。
- 需要修正“最后有效段”判定：必须以**段索引最后一个**为准，而不能假设位于最后 gridRow/gridCol（否则会漏汇总列）。

### 0.3 InspectionTable（UI）现状
- 合格率行与备注行目前只在最后网格行渲染 [InspectionTable.vue:L1005-L1021](file:///d:/Code/Vbird_ESI/vbird-esi/src/components/InspectionTable.vue#L1005-L1021)。
- 用户已确认：本次“每段都要合格率/备注 + 合并规则”**仅作用于 Excel 导出**，UI 可保持现状（但模板类型与数值判定逻辑仍需改）。

### 0.4 模板编辑（L1TemplateDialog）现状
- 每个检查项可选 `validationType: 'text' | 'numeric'`，并允许编辑 `textOptions` 字符串 [L1TemplateDialog.vue:L229-L243](file:///d:/Code/Vbird_ESI/vbird-esi/src/views/TemplateManager/L1TemplateDialog.vue#L229-L243)。
- 类型定义在 [template.ts](file:///d:/Code/Vbird_ESI/vbird-esi/src/types/template.ts#L19-L32)（当前仅支持 `numericRange`，不支持 AND/OR 组合条件）。

---

## 1. 需求锚点（已确认且必须防回归）

### 1.1 ProjectEditor 新增一层（L1 二级头部选择）
- 分部(tab)内新增 L1 二级 Tabs：一次只显示一个 L1 点检表。
- 添加 L1：保留现有下拉，添加后自动切换到对应 L1 Tab。
- 移除 L1：从 Tab 上触发（或 Tab 内按钮），并保持现有确认逻辑。

### 1.2 Excel：每段都要“故障/合格率/备注”，仅最后有效段有数值
- 每个切割块（每 6 地点一段）在 Excel 中都必须输出：故障行、合格率行、备注行。
- 只有“最后一个有效数据段”：
  - 合格率行：汇总列单元格写入全表合格率值
  - 备注行：汇总列单元格写入备注文本
- 其他段：对应位置全部写 `/`（斜杠占位）。
- “最后有效段”以**段索引最后一个**为准（与 gridRow/gridCol 无关）。

### 1.3 Excel：合并/填充规则（用户指定）
对“合格率行 + 备注行”两行，按“段内”执行：
- 左侧：**序号列 + 检查项目列**，在“合格率行 + 备注行”两行范围内合并成一个大单元格（2 列 × 2 行 = 4 格合并），内容填 **设备名称**（优先 `template.faultRow.label`，否则用 `template.name` 或 `facilityName`，执行阶段固定优先级）。
- 技术要求列：合格率行填“合格率”，备注行填“备注”。
- 6 个地点列：每一行各自横向合并成 1 格
  - 合格率行：合并格内容填“合格率”
  - 备注行：合并格内容填“/”
- 汇总列（仅最后有效段存在）：合格率行写“全表合格率数值”；备注行写“备注文本”；非最后段无汇总列。

### 1.4 模板编辑：仅两种类型
- 下拉选项：固定为 `符合 / 不符合 / /`（第三项是斜杠），不可自定义编辑。
- 数值类型：出现“数值条件配置框”；输入的数值满足该条件才算合格（用于汇总列/合格率计算）。

### 1.5 汇总列/合格率/备注均为“全局”
- 用户确认：这些统计口径都以“点检表全局所有地点”计算，只是打印切割导致布局分段。

---

## 2. 仍需确认的最小问题（高影响）

> 这些问题会影响数据结构与计算实现，执行前必须锁定。

1) **数值条件支持的操作符集合**：是否仅 `> >= < <= =`？是否需要区间 `between(a,b)`？  
2) **数值条件为空时的策略**：禁止保存 / 允许保存但永远不合格 / 允许保存但只要是数值就合格（兼容旧数据）。  

---

## 3. 拟修改文件与改动点（决策完备版）

### 3.1 ProjectEditor：新增 L1 二级 Tabs
**文件**：`d:/Code/Vbird_ESI/vbird-esi/src/views/ProjectEditor/ProjectEditor.vue`

**修改内容**
- 新增状态：
  - `activeL1Id = ref<string | null>(null)`
  - `currentL1Ids = computed(() => currentSub.value?.selectedL1Ids ?? [])`
  - `currentL1Template = computed(() => activeL1Id.value ? getL1Template(activeL1Id.value) : undefined)`
  - `currentL1Data = computed(() => activeL1Id.value && currentSub.value ? currentSub.value.inspectionData[activeL1Id.value] : undefined)`
- 行为：
  - 切换分部（`activeSubIndex` 变化）时：将 `activeL1Id` 置为该分部 `selectedL1Ids[0] ?? null`
  - `addL1ToSubdivision(l1Id)` 成功后：将 `activeL1Id = l1Id`
  - `removeL1FromSubdivision(l1Id)` 成功后：
    - 若移除的是当前激活 tab：将 `activeL1Id` 切到移除后列表的第一个（或 `null`）
- UI：
  - 在 “L1 点检表数据录入区” 上方新增一行 Tabs（风格沿用现有分部 tab 样式或采用 `el-tabs`）：
    - 每个 tab 显示 L1 模板名
    - tab 内只渲染一个 `<InspectionTable ...>`
    - 每个 tab 提供“移除”按钮（复用现有逻辑）
- 约束：不改动数据结构，不引入新依赖。

**验收点**
- 同一分部下添加多个 L1 后，仅显示一个表；切换 tab 即切换表。
- 添加 L1 后自动跳到新 tab。
- 移除当前 tab 后自动切换到剩余首个 tab。

### 3.2 模板类型：加入“数值条件”数据结构（替代/补充 numericRange）
**文件**：`d:/Code/Vbird_ESI/vbird-esi/src/types/template.ts`

**新增类型（建议）**
- `NumericOperator = '>' | '>=' | '<' | '<=' | '='`
- `NumericJoin = 'AND' | 'OR'`
- `NumericClause { op: NumericOperator; value: number; join?: NumericJoin }`
  - 约定：第 0 条 `join` 为空；第 i 条（i>0）`join` 表示与前一条的连接关系
- `NumericRule { clauses: NumericClause[] }`
- `InspectionItem.numericRule?: NumericRule`
- 保留 `numericRange?` 仅做向后兼容（执行阶段会补迁移：若 numericRule 缺失但 numericRange 存在，生成等价 clauses）。

**验收点**
- TS 编译通过；旧模板 JSON 读取不崩。

### 3.3 L1TemplateDialog：下拉固定选项 + 数值条件编辑 UI
**文件**：`d:/Code/Vbird_ESI/vbird-esi/src/views/TemplateManager/L1TemplateDialog.vue`

**修改内容**
- 文本类型（text）：
  - 移除 `col-options` 的自由输入框
  - 改为只读显示 “符合 / 不符合 / /”
  - 保存时强制写入 `textOptions: ['符合','不符合','/']`
- 数值类型（numeric）：
  - 在每行新增“条件配置区”（可折叠或直接内联），UI 结构参照用户截图：
    - 每条条件：操作符下拉 + 数值输入 + 连接符下拉（OR/AND，最后一条不显示连接符）
    - 支持“新增条件/删除条件”（限制最大条数，建议 3-5 条，执行阶段定值）
  - 保存前校验：
    - numeric 类型必须至少 1 条 clauses（若用户确认“允许空规则”，则走兼容策略）
- `handleSave()`：将 `numericRule` 一并写入模板。

**验收点**
- 文本类型不再可自定义 options；新增检查项默认固定 options。
- 数值类型可配置条件，保存后再次打开能回显。

### 3.4 数值判定引擎：统一用于 UI 合格率与 Excel 汇总计算
**文件（新增或放入现有 util）**
- 推荐新增：`d:/Code/Vbird_ESI/vbird-esi/src/utils/numericRule.ts`（纯函数，便于复用与测试）

**提供函数**
- `parseNumeric(value): number | null`（空/`/`/非数值 → null）
- `evalClause(n: number, op, v): boolean`
- `evalNumericRule(n: number, rule: NumericRule): boolean`（线性 AND/OR，无括号）
- `isPassedValue(item: InspectionItem, raw: string|number|null|undefined): boolean`
  - text：仅 `raw === '符合'` 为合格；`'不符合'` 不合格；`'/'/空` 不计入统计
  - numeric：`parseNumeric` 成功且 `evalNumericRule` 为 true 才合格；否则不合格；空/`/` 不计入统计

**修改引用点**
- UI：[InspectionTable.vue](file:///d:/Code/Vbird_ESI/vbird-esi/src/components/InspectionTable.vue#L697-L717)
  - 将 `isPassedValue` 改为基于 `items[rowIdx]` 的判定（不再“数值一律合格”）
  - `rowPassRate(rowIdx)` 用该行 item 的规则统计全表 checkpoint（全局口径）
- Excel：[excelExport.ts](file:///d:/Code/Vbird_ESI/vbird-esi/src/utils/excelExport.ts)
  - `calcRowPassRate` 与 `calcTotalPassRate` 改为复用同一套判定（避免 UI/导出漂移）

**验收点**
- 文本：只有“符合”计为合格；“不符合”计为不合格；“/”不计入分母。
- 数值：满足配置条件才计合格；不满足计不合格；空/`/`不计入分母。

### 3.5 Excel 导出：每段都输出“合格率/备注”两行 + 合并规则 + 最后有效段汇总列
**文件**：`d:/Code/Vbird_ESI/vbird-esi/src/utils/excelExport.ts`

**关键调整点**
1) **最后有效段定位**  
在 `buildL1Sheet()` 内得到 segments 数量 `segCount`，定义 `lastSegIndex = segCount - 1`，在渲染每个 seg 时用 `seg.index === lastSegIndex` 判定 `isLastSeg`。

2) **合格率/备注行总是输出**  
在 `writeL1SegmentBody()` 中，无论 `isLastSeg` 与否都输出两行：
- 合格率行：
  - 合并：seq+item（2列）×2行的合并块（跨合格率/备注两行）
  - req 列写“合格率”
  - 6 地点列合并写“合格率”
  - 若 `isLastSeg`：summaryCol 写“全表合格率值”；否则（无 summaryCol）不写数值
- 备注行：
  - req 列写“备注”
  - 6 地点列合并写“/”
  - 若 `isLastSeg`：summaryCol 写 `data.notes`；否则不写
- 对非最后段：涉及可写单元格全部填 `/`（包括合并块内的内容除“设备名/合格率/备注/合格率标签”等固定字样）。

3) **全局口径合格率值**  
合格率行写入的值使用 `faultValues` 全局统计（已有口径），或按用户确认的“点检表全局”口径计算（执行阶段与用户确认一致）。

4) **边框/对齐一致**  
新增合并后，需要保证合并区域边框与现有 `makeBorder()` 风格一致；段间分隔列保持现有策略。

**验收点（Excel）**
- 多段时：每段末尾都有“合格率/备注”两行结构（非最后段数值为 `/`）。
- 仅最后段出现汇总列；且：
  - 每行汇总列为“全表”合格率（按该行所有地点计算）
  - 合格率行汇总列为“全表”合格率（按 faultValues 全局）
  - 备注行汇总列为备注文本
- 合并格式与用户描述一致。

---

## 4. 测试与验证（执行阶段必须逐条跑通）

### 4.1 类型检查
- 运行：`npx vue-tsc --noEmit`
- 预期：退出码 0

### 4.2 UI 验证（ProjectEditor）
- 新建项目 → 添加分部 → 添加多个 L1
- 验证二级 Tabs 可切换，仅渲染当前 L1 表
- 添加后自动切换，移除当前后自动切到剩余

### 4.3 Excel 验证（重点）
准备 3 组数据：
- A：地点数 1~6（单段）
- B：地点数 7~12（两段）
- C：地点数 13+（三段以上，覆盖“最后段不在最后 gridRow”的场景）

逐项检查：
- 每段都有故障/合格率/备注（非最后段 `/`）
- 最后有效段有汇总列；合并规则符合用户描述
- 行汇总列与合格率行/备注行均为全局口径

---

## 5. 执行阶段输出格式约束（防回归）
- 任何涉及“合格率/备注/汇总列/数值条件/切割布局”的代码改动，必须同时更新：
  - `src/utils/excelExport.ts`
  - `src/utils/segmentLayout.ts`（如涉及布局）
  - `src/types/template.ts` / `src/views/TemplateManager/L1TemplateDialog.vue`（如涉及模板字段）
- UI 与导出判定逻辑必须复用同一套数值规则评估函数（避免漂移）。

