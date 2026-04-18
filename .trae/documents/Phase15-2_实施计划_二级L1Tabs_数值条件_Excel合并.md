# Phase15-2 实施计划：二级 L1 Tabs + 数值条件 + Excel 三行合并/占位

**Goal**：按已确认的 5 条新需求，对 UI（ProjectEditor/L1TemplateDialog/InspectionTable 判定）与 Excel 导出（L1 版式与汇总）做“无损增量修改”，并提供防回归验证步骤。

---

## Step 1：影响面与边界预判（Impact Analysis）

### 1.1 上下文涟漪审查

**A. ProjectEditor 二级 Tabs（显示一个 L1）**
- 上游依赖：
  - `currentSub.selectedL1Ids` 与 `currentSub.inspectionData` 的数据结构初始化与保存节流逻辑不变 [ProjectEditor.vue:L189-L249](file:///d:/Code/Vbird_ESI/vbird-esi/src/views/ProjectEditor/ProjectEditor.vue#L189-L249)
- 下游影响：
  - `InspectionTable` 只渲染一个实例，减少 DOM 与事件监听负载（正向）。
  - 移除/新增 L1 后需要正确更新“当前激活 L1”，否则可能出现空白或引用已删除的 key。

**B. L1 模板编辑：固定下拉 + 数值条件**
- 上游依赖：
  - 现有类型：`InspectionItem.validationType` + `textOptions?` + `numericRange?` [template.ts:L19-L32](file:///d:/Code/Vbird_ESI/vbird-esi/src/types/template.ts#L19-L32)
  - 现有模板编辑 UI：允许自定义 `textOptions`（需移除）[L1TemplateDialog.vue:L229-L243](file:///d:/Code/Vbird_ESI/vbird-esi/src/views/TemplateManager/L1TemplateDialog.vue#L229-L243)
- 下游影响：
  - UI（InspectionTable）当前把“数值型”当作自动合格（`typeof val==='number'`）[InspectionTable.vue:L700-L705](file:///d:/Code/Vbird_ESI/vbird-esi/src/components/InspectionTable.vue#L700-L705)，会导致新需求失效，必须替换为“基于 numericRule 判定”。
  - Excel 导出端有自己一套 `calcRowPassRate/calcTotalPassRate`（已存在），若不复用同一判定引擎，UI/导出会漂移。

**C. Excel 导出：故障/合格率/备注三行结构 + 合并规则 + 末段汇总列**
- 上游依赖：
  - 自动切割：`segmentBreaks`/`segmentLayout` 由 `segmentLayout.ts` 自动算出；`buildLayoutGrid()` 在 UI 与导出共用。
- 下游影响：
  - `writeL1SegmentBody()` 会被改动（高度敏感），任何合并范围错误将导致版式错位或覆盖数据。
  - 当前“最后段判定”存在结构性风险：不能再用 `gridRow==maxRow-1 && gridCol==maxCol-1`，必须以“段索引最后一个”为准，否则会漏掉汇总列与数值（防回归关键点）。

### 1.2 需求锚点校准（防漂移条款）

**已确认且必须锁死**
1) UI：ProjectEditor 分部内新增 L1 二级 Tabs（一次仅显示一个 L1 表）。
2) Excel：每段都必须有 “是否故障/合格率/备注” 三行；除最后有效段外，其它段对应位置均填 `/`。
3) Excel：只有最后有效段有 **汇总列**（若仅一段，则该段就是最后段，第一页就有汇总列）。
4) L1 模板：检查项仅两类：
   - 下拉：固定 `符合/不符合//`（第三项是斜杠），不可编辑；
   - 数值：必须配置数值条件（最多 5 条，线性 AND/OR，操作符固定 `> >= < <= =`），否则禁止保存。
5) Excel 版式（段内执行）：
   - 左侧“设备名称”块：**序号列+检查项目列**，跨 **3 行（是否故障/合格率/备注）** 合并为一个大单元格并填设备名；
   - 技术要求列：三行分别为 `是否故障 / 合格率 / 备注`；
   - 地点列：
     - 是否故障行：每地点独立可填写（不合并）；
     - 合格率行：6 地点横向合并写“合格率”；
     - 备注行：6 地点横向合并写“/”；
   - 汇总列（仅最后段）：合格率行写“全表合格率数值”，备注行写备注文本；非最后段无汇总列。
6) 统计口径：汇总列/合格率/备注均以**点检表全局所有地点**为口径（切割仅为打印布局）。

---

## Step 2：实施无损修复（Safe Modification）

> 仅改必要节点，不做无关重构；复用现有样式/组件结构；不引入新依赖；不新增多余注释（除类型注释）。

### 2.1 文件清单（精确到路径）

**Modify**
- `d:/Code/Vbird_ESI/vbird-esi/src/views/ProjectEditor/ProjectEditor.vue`
- `d:/Code/Vbird_ESI/vbird-esi/src/types/template.ts`
- `d:/Code/Vbird_ESI/vbird-esi/src/views/TemplateManager/L1TemplateDialog.vue`
- `d:/Code/Vbird_ESI/vbird-esi/src/components/InspectionTable.vue`
- `d:/Code/Vbird_ESI/vbird-esi/src/utils/excelExport.ts`

**Create**
- `d:/Code/Vbird_ESI/vbird-esi/src/utils/numericRule.ts`（纯函数工具，供 UI 与导出复用）

### 2.2 具体改动（按子任务拆分）

#### Task A：ProjectEditor 分部内 L1 二级 Tabs（一次只显示一个 L1）

**文件**：`ProjectEditor.vue`

**实现要点**
- 新增状态：`activeL1Id`（当前分部下选中的 L1）
- 当 `activeSubIndex/currentSub` 变化时：
  - 若当前 `activeL1Id` 不在新分部的 `selectedL1Ids` 中，自动切到 `selectedL1Ids[0]` 或 `null`
- 添加 L1（`addL1ToSubdivision`）成功后：`activeL1Id = l1Id`
- 移除 L1（`removeL1FromSubdivision`）成功后：
  - 若移除的是当前 `activeL1Id`，切换到新的首个或 `null`
- UI 层：
  - 在 L1 录入区上方加入一行 Tabs（沿用现有 sub-tab 样式或 `el-tabs`）
  - `InspectionTable` 改为仅渲染 `activeL1Id` 对应的那一个

**风险点**
- `v-for` → 单实例渲染后，需确保 `key` 仍使用 `activeL1Id`，避免 Vue 复用导致错表。

#### Task B：模板类型扩展：numericRule（线性 AND/OR，最多 5 条）

**文件**：`types/template.ts`

**新增/调整类型**
- `NumericOperator = '>' | '>=' | '<' | '<=' | '='`
- `NumericJoin = 'AND' | 'OR'`
- `NumericClause { op: NumericOperator; value: number; join?: NumericJoin }`
- `NumericRule { clauses: NumericClause[] }`
- `InspectionItem.numericRule?: NumericRule`

**兼容策略**
- 保留 `numericRange?`（不强制删除，避免旧模板 JSON 断裂）
- 评估时：
  - 若 `numericRule` 存在：用 `numericRule`
  - 否则若 `numericRange` 存在：等价转换成 `>=min AND <=max`
  - 否则：视为“未配置规则”，模板保存阶段会阻止（但旧模板读取不崩）

#### Task C：L1TemplateDialog：固定下拉选项 + 数值条件配置 UI + 保存校验

**文件**：`L1TemplateDialog.vue`

**实现要点**
- 文本类型（text）：
  - 移除 `textOptions` 自由输入框
  - UI 显示固定文案：`符合, 不符合, /`
  - 保存时强制写入 `textOptions: ['符合','不符合','/']`
- 数值类型（numeric）：
  - 展示条件编辑区（每条：操作符下拉 + 数值输入 + join(AND/OR) 下拉）
  - 最多 5 条（达到上限禁用“新增条件”按钮）
  - 保存校验：`clauses.length >= 1`，否则 `ElMessage.warning` 并阻止保存

**数据回显**
- 编辑已有模板时，从 `item.numericRule` 回填；若无但有 `numericRange`，回填为两条（`>=min AND <=max`）。

#### Task D：数值条件判定引擎（UI 与导出复用）

**文件**：`utils/numericRule.ts`（新增）

**导出函数**
- `parseNumeric(raw): number | null`（空/`/`/非数值 → null）
- `evalNumericRule(n, rule): boolean`（线性处理：`clause0 (join1 clause1) (join2 clause2)...`）
- `isPassed(item, raw): boolean`
  - `validationType==='text'`：仅 `raw==='符合'` 为 true；`'不符合'` 为 false；`'/'/空` 视为无效不计入分母（由上层处理）
  - `validationType==='numeric'`：`parseNumeric` 成功且 `evalNumericRule` true 才为 true；否则 false；空/`/`为无效

**替换引用点**
- UI：[InspectionTable.vue](file:///d:/Code/Vbird_ESI/vbird-esi/src/components/InspectionTable.vue#L697-L717)
  - `rowPassRate(rowIdx)`：按该行 `item` 逐 checkpoint 统计（全局口径），并用 `isPassed(item, val)` 判定合格/不合格
  - `totalPassRate`：保持 faultValues 口径不变（全局），仅将占位符统一为 `/`（如果后续需要）
- 导出：[excelExport.ts](file:///d:/Code/Vbird_ESI/vbird-esi/src/utils/excelExport.ts)
  - `calcRowPassRate` 改为按 `item` + `isPassed` 统计该行全局 checkpoints
  - 其它统计（故障行/总合格率）保持 faultValues 口径

#### Task E：Excel 导出 L1：三行结构 + 合并规则 + “最后段”判定修正

**文件**：`utils/excelExport.ts`

**关键修复点（防回归）**
1) **最后段判定修正**
- 在 `buildL1Sheet()` 中获取 segments 数量：`const segCount = computeSegments(data.segmentBreaks, totalCps).length`
- 定义 `const lastSegIndex = segCount - 1`
- 在渲染每个 seg 时：`const isLastSeg = !!seg && seg.index === lastSegIndex`
- `setL1ColWidths()`：需要基于“是否存在 lastSeg”来决定哪一段拥有 summaryCol（严格只给最后段）

2) **三行结构总是输出**
- 在 `writeL1SegmentBody()` 中：
  - 故障行：照旧逐地点输出，但把左侧（seq+item）与后两行一起做合并块（见下）
  - 合格率行：总是输出；地点 6 列合并写“合格率”；备注行：总是输出；地点 6 列合并写“/”
  - 非最后段：合格率值与备注值写 `/`（占位）；最后段：合格率值写总合格率数值，备注写 `data.notes`

3) **段内合并（严格按用户确认）**
- 左侧“设备名称”块：在段内，对 `seqCol` 与 `itemCol` 两列，跨 3 行（故障/合格率/备注）合并为一个块并写设备名。
  - 设备名来源优先级（执行期固定）：`template.faultRow.label` > `template.name` > `template.facilityName`
- 技术要求列：三行分别为 `是否故障 / 合格率 / 备注`
- 地点列：
  - 故障行：不合并
  - 合格率行：6 列合并写“合格率”
  - 备注行：6 列合并写“/”
- 汇总列：
  - 仅 `isLastSeg` 的段生成 summaryCol（并参与上述合并范围的最右端）
  - 合格率值与备注值均写在 summaryCol

---

## Assumptions & Decisions（已锁定）

- L1 二级切换采用：**二级 Tabs**。
- “每段合格率/备注/合并规则”仅作用于 **Excel 导出**；UI 仅更新“合格判定逻辑”与“模板编辑逻辑”。
- 数值条件：
  - 操作符：`> >= < <= =`
  - 条件条数：最多 5 条
  - clauses 为空：**禁止保存**
- 统计口径：汇总列、合格率、备注均为点检表**全局**口径。

---

## Step 3：结构化修复报告（Resolution Report）输出要求（执行后）

执行完成后必须输出：
- 修改范围（按文件列出）
- 关键逻辑点（最后段判定、合并范围、数值判定）
- 兼容性（旧模板 numericRange 迁移策略）
- 验证结果（vue-tsc、build、导出场景 A/B/C）
- 防回归点（列出 3-5 条必须保持的断言）

---

## Verification（执行阶段逐条跑通）

1) `npx vue-tsc --noEmit` 退出码 0  
2) `npm run build` 成功  
3) UI（ProjectEditor）：
   - 单分部多 L1 → 仅显示一个；tabs 切换正确；新增后自动切换；移除当前后回落到首个  
4) Excel 导出（至少 3 组）：
   - A：地点 1-6（单段）→ 有汇总列；三行结构；合并正确  
   - B：地点 7-12（两段）→ 两段都输出三行；仅最后段汇总列有值；第一段对应位置 `/`  
   - C：地点 13+（三段以上）→ 最后段判定正确（不依赖 gridRow/gridCol）  

