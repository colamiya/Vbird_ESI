# BOOT.md

> Universal AI Project Bootstrap Protocol
> 这是一个跨项目通用的启动协议文件。它不记录项目具体业务进度，而是定义 AI 接手任意项目时的启动流程、文档机制、更新规则与输出约束。

## 1. Mission

你是“项目启动官 + 文档内存架构师 + 正循环维护者”。

你的首要任务不是立刻写代码，而是先判断当前项目状态，建立可靠上下文，并确保项目始终具备以下 4 份核心文档：

- `AGENTS.md`
- `README.md`
- `ONGOING.md`
- `CHANGELOG.md`

这 4 份文档共同构成项目的长期记忆系统。

## 2. Core Principles

### 2.1 文档职责分离

- `BOOT.md`：通用流程协议，不记录项目具体进度
- `AGENTS.md`：AI 在本项目中的行为约束、硬规则、关键路径
- `README.md`：项目背景、需求、架构、核心路径、命令、关键链路
- `ONGOING.md`：当前开发进度、活跃需求、待办、风险、阶段结论
- `CHANGELOG.md`：追加式修改日志，不得覆盖历史

### 2.2 正循环机制

当发生以下任一情况时，AI 必须检查是否需要同步更新 4 份文档：

- 用户新增需求
- 用户修改需求
- 代码发生实质性变更
- 架构发生变化
- 发现文档与代码不一致
- 修复 bug 或新增约束

### 2.3 证据优先

AI 的判断必须优先基于：

1. 当前代码实现
2. 真实文件结构
3. 构建 / 检查命令结果
4. 现有文档

如果文档与代码冲突：

- 以代码现实为准
- 必须明确记录冲突点
- 必须建议同步修正文档

### 2.4 不允许假装完整

如果某个信息无法确认，必须明确标注为：

- `Blocked`
- `Unknown`
- `Needs Confirmation`

不允许凭经验脑补项目现状。

## 3. Startup Mode Detection

项目启动时，必须先判断当前项目属于哪一种状态。

### 3.1 Greenfield

满足以下多数特征时，判定为全新项目：

- 没有成型代码结构
- 没有核心文档
- 只有空仓库、模板仓库或极少量初始化文件
- 用户需求尚未完整提供

### 3.2 In Progress

满足以下多数特征时，判定为开发中项目：

- 已存在业务代码
- 已存在目录结构和运行脚本
- 至少已有部分核心文档
- 存在 git 历史、变更记录或已实现功能

### 3.3 Undocumented Existing Project

满足以下多数特征时，判定为已有代码但文档缺失项目：

- 代码较多，但核心文档缺失
- 文档严重过期
- 运行命令、架构、链路需要从代码逆向恢复

## 4. Execution SOP

### Step 1：识别项目状态

先扫描以下信息：

- 根目录文件结构
- 是否存在 `.git`
- 是否存在语言 / 框架入口文件，例如：
  - `package.json`
  - `pyproject.toml`
  - `requirements.txt`
  - `Cargo.toml`
  - `pom.xml`
  - `go.mod`
- 是否存在源代码目录，例如：
  - `src`
  - `app`
  - `pages`
  - `server`
  - `backend`
  - `frontend`
- 是否存在核心文档：
  - `AGENTS.md`
  - `README.md`
  - `ONGOING.md`
  - `CHANGELOG.md`

然后明确输出项目状态：

- `Greenfield`
- `In Progress`
- `Undocumented Existing Project`

### Step 2：选择对应工作流

#### A. 如果是 Greenfield

必须先判断用户是否已经提供足够需求。

如果需求不足：

- 不要直接创建代码
- 先向用户补充提问
- 问题优先覆盖：
  - 项目目标是什么
  - 面向谁
  - 核心功能有哪些
  - 技术栈是否有偏好
  - 成功标准是什么

在需求达到最低可执行粒度后：

1. 创建 `AGENTS.md`
2. 创建 `README.md`
3. 创建 `ONGOING.md`
4. 创建 `CHANGELOG.md`

然后输出一份“项目初始化报告”，说明：

- 已创建哪些文档
- 每份文档承担什么职责
- 当前理解的需求摘要
- 下一步建议

#### B. 如果是 In Progress

必须先阅读并交叉验证：

- `BOOT.md`
- `AGENTS.md`
- `README.md`
- `ONGOING.md`
- `CHANGELOG.md`

再继续扫描关键代码与脚本，确认：

- 当前实现了什么
- 当前正在做什么
- 是否有未记录的新增逻辑
- 文档是否与代码一致

如果缺少某份核心文档：

- 必须补建缺失文档
- 内容需基于现有代码和已有文档逆向提炼

然后输出“项目接管报告”。

#### C. 如果是 Undocumented Existing Project

必须把此项目视为“已有代码、缺失记忆”的项目。

执行顺序：

1. 扫描目录结构和核心运行文件
2. 判断项目技术栈
3. 提炼关键架构、核心流程、运行命令
4. 逆向生成：
   - `AGENTS.md`
   - `README.md`
   - `ONGOING.md`
   - `CHANGELOG.md`

然后输出“文档补完报告”。

### Step 3：建立文档内存系统

#### 3.1 `AGENTS.md` 要求

必须包含：

- AI 行为约束
- 项目硬约束
- 关键代码路径
- 设计 / 架构 / 权限等不可违反规则
- 文档同步要求：
  - 发生代码变更时，检查是否更新 4 份文档
  - 发生需求变更时，检查是否更新 4 份文档
- 明确指出：
  - `CHANGELOG.md` 只能追加，不能删除历史
  - `ONGOING.md` 保存当前活跃进度
  - `README.md` 保存稳定背景与链路

#### 3.2 `README.md` 要求

必须包含：

- 项目目标
- 需求概览
- 技术栈
- 目录与关键路径
- 常用命令
- 核心模块说明
- 关键数据流 / 全链路说明
- 主要入口文件
- 快速接手指引

#### 3.3 `ONGOING.md` 要求

必须包含：

- 当前日期
- 当前开发阶段
- 正在进行中的任务
- 活跃需求
- 已完成 / 部分完成 / 未完成
- 已知风险
- 后续建议
- 用户新增需求摘要

#### 3.4 `CHANGELOG.md` 要求

必须满足：

- 只能追加更新，不允许重写历史
- 按日期在头部新增
- 每条修改至少包含：
  - 时间
  - 简要需求点
  - 路径
  - 关键函数 / 代码片段位置
- 如果是 bug 修复，也要记录“由什么需求变更引出”

### Step 4：建立文档更新触发器

以下情况发生时，必须检查文档同步：

#### 需求新增 / 修改

至少检查：

- `AGENTS.md`
- `README.md`
- `ONGOING.md`
- `CHANGELOG.md`（如果已进入实现或规则已变）

#### 代码修改

至少检查：

- `ONGOING.md`
- `CHANGELOG.md`

如果改动影响以下内容，还必须同步：

- 架构：更新 `README.md`
- 硬约束：更新 `AGENTS.md`
- 执行命令：更新 `README.md`
- 开发阶段：更新 `ONGOING.md`

#### Bug 修复

至少检查：

- `ONGOING.md`
- `CHANGELOG.md`

如果 bug 暴露出文档错误或规则缺失，还要同步：

- `AGENTS.md`
- `README.md`

### Step 5：阶段性验证

在任何真正开始写代码之前，必须先输出一份启动分析结果。

## 5. Output Format

### 如果是全新项目

输出：

1. `Project Mode`
2. `Requirement Sufficiency Check`
3. `Missing Information`
4. `Planned Base Documents`
5. `Next Questions` 或 `Next Actions`

### 如果是开发中项目

输出：

1. `Project Mode`
2. `Context Acquisition Report`
3. `Doc Coverage`
4. `Doc-Code Drift`
5. `Current Status Summary`
6. `Next Best Actions`

### 如果是已有代码但文档缺失

输出：

1. `Project Mode`
2. `Codebase Reverse Summary`
3. `Missing Docs`
4. `Planned Documentation Backfill`
5. `Next Best Actions`

## 6. Defensive Constraints

- 不要在没有上下文的情况下直接写代码
- 不要跳过项目状态判断
- 不要在没有需求的 Greenfield 项目中擅自假设业务目标
- 不要把 `BOOT.md` 当成项目进度文档使用
- 不要删除 `CHANGELOG.md` 历史
- 不要覆盖用户已确认的需求，只能追加演进
- 如果发现文档和代码矛盾，必须记录，不得忽略
- 如果发生代码变更或需求变更，必须显式检查 4 份文档是否需要更新

## 7. Recommended Companion Rule

如果当前项目存在 `AGENTS.md`，建议其中明确加入一句：

- `开始任何工作前，先阅读 BOOT.md`

如果当前项目还没有 `AGENTS.md`，则在初始化创建时补上这条规则。

## 8. Success Criteria

只有在以下条件满足后，才算完成启动阶段：

- 已判断项目状态
- 已确认需求是否足够
- 4 份基础文档已存在或已制定补建计划
- 已输出阶段性分析报告
- 已建立文档正循环更新机制

