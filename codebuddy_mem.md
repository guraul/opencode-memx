# CodeBuddy Code 持久化记忆系统 — 完整文档

> 本文详细记录 CodeBuddy Code 的跨会话持久化记忆系统：组织方式、分层结构、四类记忆、保存流程、访问时机、过期检查、与其他持久化机制的关系，并附系统提示词原文与示例。

---

## 1. 概述

### 1.1 是什么
CodeBuddy Code 内建一个**基于文件的持久化记忆系统**，让 AI 在多次对话之间保留对用户、协作方式、项目背景、外部资源的理解。每次新对话开始时，索引文件会被自动加载到上下文，使 AI 不必每次重新询问就能延续之前的协作。

### 1.2 为什么需要它
- 单次对话有上下文窗口限制，长会话会被自动摘要，细节丢失
- 用户反复纠正同一类问题成本高
- 项目背景（为什么做、deadline、谁在做）常常无法从代码本身推出
- git 历史只记录"做了什么"，不记录"为什么这么做"和"用户偏好怎么协作"

### 1.3 核心原则
- **基于文件**，不依赖数据库或外部服务，可读可改可删
- **AI 自主维护**：AI 在对话中遇到值得记的事就主动写，不等用户指令
- **按项目隔离**：每个项目独立记忆目录
- **索引 + 内容分离**：`MEMORY.md` 是索引（短），具体记忆是独立 `.md` 文件（详）
- **可失效**：记忆只是"某时刻为真"的快照，使用前要对照现实验证

---

## 2. 目录结构与分层

### 2.1 路径模板
```
/root/.codebuddy/projects/<project-slug>/memory/
```
其中 `<project-slug>` 是工作目录路径的转义形式。例如工作目录 `/root/project/opencode-goal` 对应：
```
/root/.codebuddy/projects/root-project-opencode-goal/memory/
```

> 注意：记忆目录是**按工作目录隔离**的，不是全局共享。切到不同项目目录会加载不同的记忆。这个目录在首次需要时已存在，AI 直接用 Write 工具写入即可，不需要 `mkdir`。

### 2.2 文件组织
```
memory/
├── MEMORY.md                       # 索引文件（必须存在，每次对话自动加载）
├── user_role.md                    # 各类记忆文件，按主题命名
├── user_background.md
├── feedback_testing.md
├landback_responses.md
├── project_<name>.md
├── reference_<system>.md
└── ...
```

### 2.3 分层原则
- **按语义组织，不按时间**：相同主题的记忆应在一个文件里更新，不要每次写新文件
- **一个文件一个主题**：粒度是"一个独立的、可被检索到的概念"
- **先更新后新建**：写新记忆前先看是否有现成的同主题文件可以更新，避免重复
- **MEMORY.md 永远是索引**：所有具体内容都在独立文件里，`MEMORY.md` 只放一行指针

### 2.4 与工作目录的关系
记忆目录在 `~/.codebuddy/` 下，**不在用户的项目仓库里**。这意味着：
- 记忆不会被 git 跟踪，不会污染 PR
- 记忆是 AI 自己的"小本本"，用户可以选择性查看或删除
- 用户的项目仓库里看不到记忆

### 2.5 运维注意事项

四条边界情况，简记如下（不展开成独立子节，避免膨胀）：

**单个记忆文件大小**：无硬性上限，但建议 ≤ 200 行。超过则考虑按粒度拆分（参见 3.10）或合并成"集"文件。超过 500 行几乎肯定该拆 —— 多半是把多个主题堆在一个文件里了，违反"一个文件一个独立主题"原则（参见 2.3）。

**`project-slug` 派生规则**：工作目录的绝对路径，把 `/` 替换为 `-`，去掉开头的 `-`。例如 `/root/project/foo` → `root-project-foo`。路径含其他特殊字符（空格、中文、`.`）时行为未定义 —— 避免在工作目录路径里用这些字符。

**并发 / 多实例**：两个 CodeBuddy Code 会话同时写同一记忆文件时无锁，最后写赢。建议：不要在两个会话同时编辑同一记忆文件；如必须，分工会话（A 写 `user_*`、B 写 `project_*`）或会话末再合并。`MEMORY.md` 并发追加索引行可能丢条，写后用 Read 验证。

**项目路径变更迁移**：用户 `mv foo bar` 后 slug 变，新会话找不到旧记忆。迁移：把 `~/.codebuddy/projects/<旧-slug>/` 整目录 `mv` 到 `<新-slug>/` 即可。如不确定旧 slug，`ls ~/.codebuddy/projects/` 看所有项目目录。

---

## 3. MEMORY.md — 索引文件

### 3.1 角色
`MEMORY.md` 是**索引**，不是记忆本身。它每次对话开始时被自动加载到 AI 上下文，让 AI 知道"有哪些记忆存在、各自是什么主题"，按需读取具体文件。

### 3.2 格式
- 无 frontmatter
- 每行一条，格式：`- [标题](文件名.md) — 一句话钩子`
- 一行控制在 ~150 字符以内
- 200 行后被截断，所以必须精简

### 3.3 模板
```markdown
- [user role](user_role.md) — user is a data scientist, currently focused on observability
- [testing feedback](feedback_testing.md) — integration tests must hit real DB, not mocks
- [auth rewrite](project_auth_rewrite.md) — auth middleware rewrite driven by legal/compliance
- [grafana dashboard](reference_grafana.md) — grafana.internal/d/api-latency is oncall dashboard
```

### 3.4 加载机制
- 每次对话开始，系统把 `MEMORY.md` 全文注入到 AI 的上下文（以 `<system-reminder>` 形式）
- 具体记忆文件**不自动加载**，AI 在需要时主动用 Read 工具读取
- 这是为了节省上下文 —— 索引小，内容按需加载

### 3.5 长度约束
- 200 行后截断（系统提示原话："lines after 200 will be truncated"）
- 因此索引必须保持精简，每条一行
- 如果记忆条数超过 200，要么合并同主题，要么删除过期条目

### 3.6 索引行的写法工艺

每条索引行三段式：`- [标题](文件.md) — 钩子`。其中**钩子**是 AI 在 Stage A（见 10.3）决定是否加载该记忆的唯一依据 —— 钩子写得差，记忆等于不存在。

**好钩子的标准**：
- 含**可匹配关键词**（命名实体、技术名词、文件路径片段），不含空泛形容词
- 含"何时相关"的触发信号，不只是"是什么"
- 前 60 字符最重要（截断/扫读时优先保留）
- ≤150 字符

**对比**：

| 钩子 | 评价 |
|---|---|
| `— integration tests must hit real DB, not mocks` | ✓ 含触发词（integration tests）+ 具体规则 |
| `— testing feedback` | ✗ 太泛，匹配面太广 |
| `— auth middleware rewrite driven by legal/compliance requirements` | ✓ 含动机+触发词 |
| `— important project info` | ✗ 无信息量 |

标题部分：简短名词短语，≤5 词，便于扫读。

### 3.7 索引排序策略

`MEMORY.md` 无强制顺序，但建议：
- **按类型分组**：`user` → `feedback` → `project` → `reference`，同组相邻
- **组内按重要性 / 引用频率降序**，高频关键的放组首
- **不按时间排**（时间无意义，记忆随时更新）

排序只在条目多时（>20 条）才显式做；少时随意。组间用空行分隔可读性更好（但会占行数，权衡）。

### 3.8 索引健康检查

定期（每 N 次写记忆后，或感觉索引混乱时）跑：
- **死链检查**：每条指针指向的 `.md` 文件实际存在
- **悬空文件**：`memory/` 下有 `.md` 但 `MEMORY.md` 没指针
- **超长检查**：任一行 > ~150 字符
- **重复检查**：两条钩子语义重叠
- **膨胀检查**：接近 200 行阈值

死链和悬空文件**立即修**（前者删指针，后者补指针或删文件）。

### 3.9 索引重建（灾难恢复）

如果 `MEMORY.md` 损坏、丢失，或索引混乱到不可救：
1. `ls memory/*.md`（排除 `MEMORY.md` 本身）
2. 逐个读 frontmatter 的 `name` 和 `description`
3. 按本规范格式每文件生成一行指针：`- [name](file.md) — description`
4. 按类型分组排序（参见 3.7）
5. 写回 `MEMORY.md`

每月或感觉索引失控时也可主动做一次"清理重建"。

### 3.10 大规模记忆的分区

当单项目记忆 > 100 条时，**不要**：
- 分到子目录（破坏扁平 Grep 检索）
- 把 `MEMORY.md` 拆成多个索引文件（系统只认一个 `MEMORY.md`）

应该：
- **按粒度拆文件**：`feedback_testing.md` → `feedback_testing_integration.md` + `feedback_testing_unit.md`，索引里仍是扁平的一行一条
- **合并成"集"文件**：相关条目用 `**Merges:**` 合成一个，索引里只留一行
- **评估项目边界**：是否有些记忆其实属于另一个工作目录？切到那个目录建独立记忆

---

## 4. 记忆文件格式

### 4.1 frontmatter（必需）
每个记忆文件以 YAML frontmatter 开头：
```yaml
---
name: <记忆名>
description: <一句话描述，用于未来对话判断相关性>
type: <user | feedback | project | reference>
---
```

### 4.2 字段说明
| 字段 | 必需 | 作用 |
|---|---|---|
| `name` | 是 | 记忆的简短标识，方便引用 |
| `description` | 是 | 一句话描述，**专门用来在未来对话里判断是否相关**，所以要具体不要泛泛 |
| `type` | 是 | 四类之一，决定 AI 如何使用 |

### 4.3 正文结构（按类型不同）
- `user` / `reference`：自由结构，说清楚即可
- `feedback` / `project`：**强制结构**，先写规则/事实，再写 `**Why:**` 行和 `**How to apply:**` 行

```markdown
<规则或事实陈述>

**Why:** <原因 — 往往是过去的事故、强偏好、或约束>
**How to apply:** <什么时候/哪里适用这条指导>
```

为什么强制 Why：知道为什么才能在边界情况下做判断，而不是机械套用规则。

### 4.4 命名规范

文件名是记忆检索的第一道线索。规范如下。

**基本规则**
- 全小写、ASCII、用下划线分隔（`snake_case`，与 frontmatter `name` 字段风格一致）
- 不要中文（跨环境兼容性差，搜索时易错）
- 不要空格、不要特殊字符（`/ \ : * ? " < > |` 全禁）
- 长度建议 ≤ 40 字符
- 扩展名必须 `.md`

**命名模式**

| 模式 | 形式 | 适用 | 示例 |
|---|---|---|---|
| 类型前缀 | `<type>_<主题>.md` | 多人协作、便于扫一眼分类 | `feedback_testing.md`、`project_auth_rewrite.md` |
| 纯主题 | `<主题>.md` | 单用户、主题清晰无歧义 | `testing.md`、`auth_rewrite.md` |
| 多主题聚合 | `<大主题>.md` | 同领域多条规则聚一起 | `frontend_conventions.md` |

本系统默认采用**类型前缀**模式（`feedback_*` / `project_*` / `user_*` / `reference_*`），原因：
- `ls` 时一眼分类
- 避免同名冲突（`testing.md` 既可能是 feedback 也可能是 project）
- 与 frontmatter `type` 字段呼应，便于一致性检查

**主题命名原则**
- 用**具体的主题**，不用泛泛词（`feedback_testing.md` ✓，`feedback_stuff.md` ✗）
- 用**领域名词**，不用时间或会话编号（`project_auth_rewrite.md` ✓，`project_2026_03_05.md` ✗）
- 一个文件**一个独立主题**；主题演化时**改名**而不是堆叠（如 `project_auth_rewrite` 完成转新阶段 → 新建 `project_session_storage` 而不是继续往旧文件塞新内容）

**演化与重命名**
- 主题范围变了 → 新建文件 + 更新 `MEMORY.md` 索引 + 删旧文件
- 主题完成（如 project 类目标达成）→ 不要立即删，先在 `description` 注明完成日期，留 1-2 个对话周期再删（防止回滚时丢上下文）
- 改名时同步更新 `MEMORY.md` 索引和任何 `**Supersedes:**` / `**How to apply:**` 里的引用

**冲突避免**
- 写新文件前先 `ls memory/` + 读 `MEMORY.md` 看是否已有同主题
- 已有同主题 → `Edit` 更新，不新建
- 文件名撞了 → 加更具体的限定词（`feedback_testing.md` 已用 → `feedback_integration_testing.md`）

**frontmatter `name` 字段 vs 文件名**
- 文件名是**路径标识**（`feedback_testing.md`）
- `name` 是**人类可读标题**（`integration tests must hit real DB`）
- 两者不必相同，但应相关 —— `name` 更口语化，文件名更结构化

---

## 5. 四类记忆

### 5.1 `user` — 用户画像
**存什么**：用户的角色、目标、职责、知识背景。

**为什么**：让你能针对用户的具体情况定制行为。和资深工程师对话 vs 和学生对话，解释深度、术语、抽象层次都不同。

**何时存**：每次了解到用户的角色、偏好、职责、知识背景的任何细节。

**示例**：
```yaml
---
name: user role
description: user is a data scientist, currently focused on observability/logging
type: user
---
用户是数据科学家，当前关注可观测性/日志方面。
```

```yaml
---
name: user background
description: deep Go expertise, new to React and this project's frontend — frame frontend explanations in terms of backend analogues
type: user
---
用户写了十年 Go，但是第一次接触这个仓库的 React 前端。
```

**注意**：不要写负面评价或与当前工作无关的内容。目标是帮你更好地帮用户。

### 5.2 `feedback` — 协作指导
**存什么**：用户给过的纠正（"不要那样""停止做 X"）和确认（"对，就这样""完美，继续这么做"）。

**为什么**：这是**最重要**的一类。只记纠正会让你只避开过去的错误，却会让你从已被验证的好做法上漂移，变得过度保守。所以要同时记成功和失败。

**何时存**：
- 用户纠正你的做法（"no not that", "don't", "stop doing X"）
- 用户确认某个非显然做法奏效（"yes exactly", "perfect, keep doing that"，或不经反驳地接受了某个不寻常的选择）

**关键**：保存适用于未来对话的内容，尤其是令人意外或不显然的。**必须包含 Why**，这样未来在边界情况下才能判断是否套用。

**正文结构**：
```markdown
<规则本身>

**Why:** <用户给的原因 — 往往是过去的事故或强偏好>
**How to apply:** <这条指导什么时候/在哪里生效>
```

**示例**：
```yaml
---
name: integration tests must hit real DB
description: integration tests must hit a real database, not mocks
type: feedback
---
集成测试必须连真实数据库，不能用 mock。

**Why:** 上季度 mock 测试通过但生产迁移失败，被坑过。
**How to apply:** 写或修改集成测试时；不要为了快而引入 mock DB。
```

```yaml
---
name: terse responses
description: this user wants terse responses with no trailing summaries
type: feedback
---
用户要简洁回复，不要在每条回复末尾复述刚做的事。

**Why:** 用户能读 diff，末尾复述是噪声。
**How to apply:** 所有回复 —— 跳过 "Let me summarize what I did..." 这类结尾。
```

```yaml
---
name: bundle refactors into one PR
description: for refactors in this area, user prefers one bundled PR over many small ones
type: feedback
---
在这个区域的重构，用户偏好一个大 PR 而不是多个小 PR。

**Why:** 这次的单 PR 是对的，拆了就是 churn（用户在我选了这个做法后明确确认 —— 这是被验证的判断，不是纠正）。
**How to apply:** 在这个代码区域做重构时默认打包提交。
```

### 5.3 `project` — 项目背景
**存什么**：项目的进行中工作、目标、倡议、bug、事故，**这些不能从代码或 git 历史推出**。

**为什么**：让你理解用户当前请求背后的细节和动机，做更明智的建议。

**何时存**：了解到"谁在做什么、为什么、什么之前完成"。这些状态变化快，要保持最新。**相对日期必须转绝对日期**（"周四" → "2026-03-05"），否则时间一过就不可解读。

**正文结构**（同样强制 Why + How to apply）：
```markdown
<事实或决策>

**Why:** <动机 — 往往是约束、deadline、或干系人要求>
**How to apply:** <这条背景如何影响你的建议>
```

**示例**：
```yaml
---
name: merge freeze for mobile release
description: merge freeze begins 2026-03-05 for mobile release cut — flag non-critical PRs after that date
type: project
---
周四之后所有非关键 merge 冻结 —— 移动团队切 release 分支。

**Why:** 移动团队要切 release 分支，需要主干稳定。
**How to apply:** 在 2026-03-05 之后提交的非关键 PR 工作要主动标出。
```

```yaml
---
name: auth middleware rewrite motivation
description: auth middleware rewrite is driven by legal/compliance requirements around session token storage, not tech-debt cleanup — scope decisions should favor compliance over ergonomics
type: project
---
正在重写旧 auth 中间件，原因是 legal 标记它会话 token 存储方式不满足新合规要求。

**Why:** 合规要求，不是技术债清理。
**How to apply:** 范围决策要优先合规而不是易用性。
```

### 5.4 `reference` — 外部资源指针
**存什么**：外部系统里的信息位置。让你知道去哪里找项目目录之外的最新信息。

**为什么**：用户提到外部系统时，或信息可能在某外部系统时，能立刻知道去哪里查。

**何时存**：了解到外部系统的资源及其用途。例如 bug 在 Linear 某项目跟踪、反馈在某 Slack 频道。

**示例**：
```yaml
---
name: pipeline bugs in Linear
description: pipeline bugs are tracked in Linear project "INGEST"
type: reference
---
流水线 bug 在 Linear 的 "INGEST" 项目里跟踪。
```

```yaml
---
name: oncall latency dashboard
description: grafana.internal/d/api-latency is the oncall latency dashboard — check it when editing request-path code
type: reference
---
grafana.internal/d/api-latency 是 oncall 监控的延迟看板。
```

---

## 6. 不存什么

这些**即使**用户明确要求也不要存（系统提示原话："These exclusions apply even when the user explicitly asks to save"）：

| 不存 | 为什么 |
|---|---|
| **机密 / 凭证 / PII**：API key、密码、token、用户个人身份信息 | 落盘纯文本，无加密无访问控制，泄露风险高；不进记忆库 |
| 代码模式、约定、架构、文件路径、项目结构 | 读当前项目状态就能推出 |
| git 历史、最近改动、谁改了什么 | `git log` / `git blame` 是权威 |
| Debug 方案或修复食谱 | 修复在代码里；commit message 有上下文 |
| 已在 CODEBUDDY.md 文件里的内容 | 不重复 |
| 短时任务细节：进行中工作、临时状态、当前对话上下文 | 这些用 Plan 或 Task 跟踪，不是记忆 |

**用户要求存 PR 列表或活动日志时怎么办**：问用户什么是**令人意外**或**不显然**的部分 —— 那才是值得记的。流水账不是记忆。

**机密内容脱敏规则**：即使用户明确要求"记住这个 API key"，也要拒绝并解释 —— 记忆以纯文本 `.md` 落盘，无加密无访问控制。如必须保留凭证类信息的位置，指引用户存到 `.env` / 密码管理器 / vault，记忆里只记"凭证位置"（如 `Anthropic key 在 ~/.config/.../credentials`），**不记凭证本身**。识别信号：`sk-`、`AKIA`、`ghp_`、`xoxb-` 等典型前缀；长 base64/hex 串；`password=`、`token=`、`secret=` 字段名。

---

## 7. 保存流程（两步）

### Step 1 — 写记忆文件
用 Write 工具写到 `memory/<语义文件名>.md`，含 frontmatter：

```markdown
---
name: <记忆名>
description: <一句话描述，要具体>
type: <user | feedback | project | reference>
---

<正文 —— feedback/project 类型必须含 Why 和 How to apply 行>
```

### Step 2 — 在 MEMORY.md 加一行指针
```markdown
- [标题](<文件名>.md) — 一句话钩子（≤150 字符）
```

**注意**：
- `MEMORY.md` 没有 frontmatter
- 永远不要把记忆内容直接写到 `MEMORY.md`
- 一行一条，简短

---

## 8. 访问时机与冲突处理

### 8.1 主动访问
- 当记忆似乎相关，或用户提到之前对话的工作时
- 用户明确要求"check / recall / remember"时（**必须**访问）
- 用户说"ignore / not use memory"时：当作 `MEMORY.md` 是空的 —— 不应用、不引用、不对比、不提记忆内容

### 8.2 过期检查（关键！）
记忆会过期。使用前**必须**对照现实验证：

**"记忆说 X 存在 ≠ X 现在存在。"**

具体检查：
- 记忆命名了文件路径 → 用 Read/Glob 验证文件存在
- 记忆命名了函数或 flag → 用 Grep 验证还在
- 用户即将根据你的推荐行动（不只是问历史）→ 先验证

**冲突处理**：如果记忆和当前观察冲突，**信当前观察**，并更新/删除过期记忆，而不是按记忆行动。

**状态快照类记忆**（仓库快照、活动日志、架构总结）是**冻结在时间点**的。用户问最近/当前状态时，优先 `git log` 或读代码，不要回忆快照。

### 8.3 记忆间冲突（memory vs memory）

两条记忆互相矛盾（A 说 X，B 说非 X）时的处理。**注意**：8.2 处理的是"记忆 vs 当前现实"，本节处理的是"记忆 vs 另一条记忆"。

**判断优先级**（从高到低）：
1. **现实状态**（代码 / git / 文件）—— 永远赢，参见 8.2
2. **更新的记忆**（文件 `mtime` 或 frontmatter 注明的日期）
3. **更具体的记忆**（带具体证据、引用文件路径 > 泛泛陈述）
4. **用户当下口头确认**（临时覆盖，但应同步到记忆文件）

**操作流程**：
1. 用更优先的为准
2. 更新或删除输的那条 —— **不要两条都留**，否则未来检索时会再次混乱
3. 在赢的那条里加一行 `**Supersedes:** <旧文件名>.md (反转于 <日期>)` 便于审计
4. 从 `MEMORY.md` 索引移除被删文件的指针

**示例**：
- 用户先说"集成测试用 mock DB"（存为 `feedback_mock_db.md`）
- 后说"集成测试必须连真 DB"（应存为 `feedback_real_db.md`）
- 处理：删 `feedback_mock_db.md`，从 `MEMORY.md` 移除其指针，在 `feedback_real_db.md` 加 `**Supersedes:** feedback_mock_db.md (反转于 2026-03-05)`

### 8.4 用户"忘记"指令的处理

用户说"忘掉 X"时的策略：

**Step 1：定位**
- Grep `memory/` 目录找包含 X 关键词的文件
- 读 `MEMORY.md` 索引找标题相关的条目
- 注意 `name` 字段和文件名可能不完全一致，两者都要查

**Step 2：评估波及**
- 单一文件 → 直接删文件 + 从 `MEMORY.md` 移除指针
- 多文件涉及 → **不要批量删**，先列给用户确认每条
- 被其他记忆引用 → 删前检查 `**Supersedes:**` / `**How to apply:**` 里的指针

**Step 3：清理引用**
- 删了文件 A，但文件 B 里 `**How to apply:**` 提到"参见 A" → 也要更新 B 去掉该引用
- `MEMORY.md` 索引里的指针必须同步移除
- 检查 `**Supersedes:**` 链 —— 如果 A 是被 B 超越的旧条目（已删），无需动 B；如果 A 是 B 超越的新条目（A 还在引用被删的更老条目），需重写 B 的 Supersedes 字段

**Step 4：可选留痕**
- 关键的删除（如删了一整段项目背景）可在 `MEMORY.md` 末尾加 HTML 注释 `<!-- forgot: <file>.md on 2026-03-05 -->`，留 1 个对话周期再彻底清，防止误删

### 8.5 重复检测与合并

定期检查（每 N 次写记忆后，或感觉记忆膨胀时）。

**重复信号**
- `MEMORY.md` 索引里有 ≥ 2 条描述同一主题
- 两个文件 `description` 字段语义重叠
- 一个文件的 `**How to apply:**` 引用了另一个文件但内容重复
- 检索时同主题多文件同时返回，AI 不确定以哪个为准

**合并流程**：
1. 读两个文件，找出**仍有效**的部分（去掉过期部分）
2. 选一个更宽或更窄的文件名（合并 `feedback_integration_testing.md` + `feedback_unit_testing.md` → `feedback_testing.md`；或反过来按粒度拆，看哪个更自然）
3. 写新文件，frontmatter `name` 和 `description` 反映合并后的范围
4. 删被合并的文件，从 `MEMORY.md` 移除其指针
5. 在新文件加 `**Merges:** file1.md, file2.md` 便于审计
6. 检查其他文件是否引用了被合并的旧文件名，更新引用

**何时主动合并**：
- `MEMORY.md` 接近 200 行截断阈值
- 写新记忆时发现已有同主题（前面"先更新后新建"原则的延伸）
- 用户抱怨记忆混乱 / AI 给出矛盾推荐

---

## 9. 与其他持久化的关系

记忆只是 AI 可用的几种持久化之一。区分：

| 机制 | 用途 | 何时用 |
|---|---|---|
| **Memory** | 跨对话有用的信息 | 信息在未来对话有价值 |
| **Plan** | 当前实现任务的方法对齐 | 非平凡实现任务开始前要和用户对齐方法；方法变了改 plan 而不是写记忆 |
| **Tasks** | 当前对话内的步骤跟踪 | 把当前对话的工作拆成离散步骤/跟踪进度 |

**判断准则**：
- 如果信息只在当前对话有用 → 用 Plan 或 Task，不用 Memory
- 如果信息在未来对话也有用 → 用 Memory
- 方法在变 → 改 Plan，不改 Memory
- 步骤要跟踪 → 用 Task，不用 Memory

---

## 10. 搜索过去上下文

### 10.1 优先搜记忆目录
```
Grep with pattern="<搜索词>" path="/root/.codebuddy/projects/<project-slug>/memory" glob="*.md"
```
用窄搜索词（错误信息、文件路径、函数名），不要用宽泛关键词。

### 10.2 最后手段：会话日志
```
Grep with pattern="<搜索词>" path="/root/.codebuddy/projects/<project-slug>/sessions/" glob="*.jsonl"
```
日志文件大、慢，**最后才用**。

### 10.3 多阶段检索：索引优先

永远按**最便宜到最贵**的顺序检索：

| Stage | 操作 | 成本 | 何时用 |
|---|---|---|---|
| A | 扫 `MEMORY.md`（已在上下文） | 0 | 总是先做 |
| B | Grep `memory/` 目录，按关键词定位候选 | 低 | Stage A 没匹配或不确定时 |
| C | Read 具体记忆文件 | 高（占 token） | 确认相关后 |

**绝不**跳过 Stage A 直接 Read。**绝不**无脑 Read 多个候选。

### 10.4 相关性判断

Stage A 返回多个候选时，按以下排序选 top-K（K≤3）读：
- **关键词匹配度**：钩子里的关键词是否命中当前任务
- **类型相关性**：写代码 → 优先 `feedback`；理解背景 → 优先 `project`；查外部资源 → `reference`；了解用户 → `user`
- **时效性**：`project` 类易过期，使用前看 `mtime` 或 frontmatter 注明日期
- **反向验证**：钩子匹配但内容看起来不对 → 可能过期，参见 8.2 验证

### 10.5 检索成本与上下文预算

- 每次 Read 一个记忆文件**占用上下文 token**
- N 个候选只读 top-K（K≤3 通常够）
- 大文件（>200 行）用 `offset` + `limit` 只读相关章节
- 优先读 `description` 字段最匹配的
- 检索后如果上下文已接近窗口上限，停止继续 Read

### 10.6 检索失败模式

| 失败 | 原因 | 修复 |
|---|---|---|
| **假阳性**：钩子匹配但内容无关 | 钩子写得泛 | 标记候选低优先级，下次重写钩子 |
| **假阴性**：没匹配但实际相关 | 钩子不够好 / 关键词漂移 | 用同义词 Grep；下次重写钩子 |
| **关键词漂移**：用户用术语 A，记忆写术语 B | 同义词未对齐 | Stage A 用 AI 语义理解弥补 Grep 字面匹配的不足 |
| **索引失效**：>200 行被截断，靠后的记忆检索不到 | 索引膨胀 | 必须瘦身（参见 3.8、3.10） |

#### 10.6.1 检测信号

修复前要先发现失败。分三类信号：

**假阴性信号**（应找到但没找到）：
- 用户说"我们之前讨论过 X"、"你不是知道吗" —— 但 `MEMORY.md` 扫描没匹配
- 用户提到的命名实体（函数名、文件名、项目名）在 `MEMORY.md` 里 Grep 不到
- 用户纠正 AI："不对，你应该知道 Y"

**假阳性信号**（找到但不能用）：
- AI 加载了某条记忆但当前任务用不上
- 用户说"这跟现在没关系"、"别翻旧账"
- 同一轮里加载的多条记忆互相矛盾（参见 8.3）

**静默失败**（最隐蔽）：
- 检索结果少于预期但用户没明说 —— 靠 AI 自我评估"这个主题应该有记忆但没出现"
- 上下文里某条引用指向已不存在的文件，但 AI 没去验证 —— 参见 11.6 强制验证

#### 10.6.2 自动修复流程（5 步）

```
Step 1: 检测
    ↓ （从上面信号之一发现失败）
Step 2: 诊断根因
    ├─ 文件不存在 → 死链
    ├─ 文件存在但内容过期 → 走 8.2 验证路线
    ├─ 钩子匹配错 → 钩子工艺问题（10.6 表格）
    ├─ 关键词漂移 → 同义词问题
    └─ 索引 >200 行 → 膨胀
    ↓
Step 3: 判断能否自动修（见 10.6.3）
    ↓ 能                                  ↓ 不能
Step 4a: 执行自动修（带 try-catch + 日志）   Step 4b: 标记待人工
    ↓                                         ↓
Step 5a: 验证修复（再检索一次确认）          Step 5b: 在回复末尾一句话告知用户
                                              "已检测到记忆库 X 类问题，建议手动清理"
```

#### 10.6.3 自动修复矩阵

| 失败类型 | 能自动修？ | 自动修动作 | 后续 |
|---|---|---|---|
| 死链（指针指向不存在的文件） | ✓ | 从 `MEMORY.md` 删该行；检查是否还有 `**Supersedes:**` 链遗留 | 留痕 |
| 悬空文件（有文件无指针） | 半 | 读 frontmatter 自动补一行指针；若内容已过期则标 stale 留 1 周再删 | 半自动 |
| 钩子过泛（假阳性多） | ✓ | 重写钩子，加具体关键词和触发信号（参见 3.6） | 留痕 |
| 钩子过窄（假阴性多） | ✓ | 加同义词或更宽的触发词 | 留痕 |
| 关键词漂移 | ✓ | 在钩子或 description 里补同义词 | 留痕 |
| 内容过期 | 半 | 标 `stale: true` frontmatter 字段 + 触发 8.2 验证 | 删除/重写人工 |
| 索引膨胀 >200 行 | ✗ | 不能自动瘦身（语义判断） | 人工合并（3.10） |
| 多记忆语义冲突 | ✗ | 走 8.3 流程（人工确认赢家） | 人工 |
| 跨项目记忆误存 | ✗ | 移到正确项目目录（路径判断要人） | 人工 |
| 大规模变更（>3 文件） | ✗ | 拆分批次，逐批人工确认 | 人工 |

#### 10.6.4 自动修复护栏

**绝不**：
- 自动**删除**记忆内容 —— 只删指针 / 标 stale，留 1 对话周期再彻底清（防止误修连环）
- 自动**合并**语义相近的记忆 —— 合并是语义判断，留人工（参见 8.5）
- 跨项目操作 —— 移文件到另一项目目录必须人工确认
- 单次对话自动修 > N=3 次 —— 防 churn / 防误修滚雪球

**必须**：
- 每次自动修 try-catch，失败不能逃到 host
- 每次自动修留痕（见 10.6.6），用户可追溯可回滚
- 超过护栏阈值时降级为人工，在回复末尾告知用户

#### 10.6.5 修复后验证

| 修复类型 | 验证动作 |
|---|---|
| 删指针 | 再 Grep 该关键词，确认不再返回死链；再扫 `MEMORY.md` 确认该行已移除 |
| 重写钩子 | 用原失败时的关键词再扫 `MEMORY.md`，确认能匹配到新钩子 |
| 加同义词 | 用同义词再扫一次，确认能匹配 |
| 标 stale | 下一轮检索时该记忆应被降级（参见 10.4 相关性判断） |
| 补指针 | `ls memory/` 确认该文件存在；再读 `MEMORY.md` 确认指针在 |

验证失败 → 升级为人工（Step 4b）。

#### 10.6.6 修复留痕格式

每次自动修必须在 `MEMORY.md` 末尾用 HTML 注释留痕（用户不可见但可追溯可回滚）。

**简短格式**（单行，用于简单修复）：
```
<!-- YYYY-MM-DD auto-fix: <动作类型> <target-file> — <原因> -->
```

**扩展格式**（多行块，用于含 before/after 的复杂修复）：
```
<!--
YYYY-MM-DD auto-fix: <动作类型> <target-file>
  reason: <触发原因 / 检测信号>
  before: <原内容片段，单行>
  after:  <新内容片段，单行>
  verify: <验证动作及结果>
-->
```

#### 10.6.7 动作类型词汇表

为可检索可统计，动作类型限定以下集合，不允许自由发挥：

| 动作类型 | 含义 | 对应矩阵失败类型 |
|---|---|---|
| `removed-dead-pointer` | 从 `MEMORY.md` 删指向不存在文件的指针 | 死链 |
| `added-pointer` | 给悬空文件补一行指针 | 悬空文件 |
| `marked-stale` | 标 `stale: true` frontmatter + 留待人工 | 内容过期 |
| `rewrote-hook-narrower` | 重写钩子，加具体关键词（治假阳性） | 钩子过泛 |
| `rewrote-hook-broader` | 重写钩子，加同义词/触发词（治假阴性） | 钩子过窄 / 关键词漂移 |
| `added-synonym` | 在钩子或 description 补同义词 | 关键词漂移 |
| `escalated-manual` | 升级人工（不能自动修的） | 膨胀 / 冲突 / 跨项目 / 大规模 |
| `purged-stale-logs` | 清理过期留痕（见 10.6.9） | 日志堆积 |

#### 10.6.8 实际示例（10 类）

**1. 死链 → `removed-dead-pointer`**
触发：用户提到 `feedback_old_db`，Stage A 扫到指针但 `ls memory/` 文件已不存在。
```
<!-- 2026-03-05 auto-fix: removed-dead-pointer feedback_old_db.md — file not found in memory/; pointer removed from MEMORY.md line 7 -->
```

**2. 悬空文件 → `added-pointer`**
触发：健康检查发现 `reference_grafana.md` 存在但 `MEMORY.md` 无对应指针。
```
<!-- 2026-03-05 auto-fix: added-pointer reference_grafana.md — orphan file detected during health check; added "- [grafana dashboard](reference_grafana.md) — grafana.internal/d/api-latency is oncall dashboard" to MEMORY.md -->
```

**3. 钩子过泛 → `rewrote-hook-narrower`**（扩展格式）
触发：当前任务写 integration test，钩子 `— testing feedback` 匹配但内容无关。
```
<!--
2026-03-05 auto-fix: rewrote-hook-narrower feedback_testing.md
  reason: false-positive on integration-test task (hook "— testing feedback" too broad)
  before: — testing feedback
  after:  — integration tests must hit real DB, not mocks; unit tests may use mocks
  verify: re-grepped "integration test", hook now matches; "unit test" no longer triggers
-->
```

**4. 钩子过窄 → `rewrote-hook-broader`**（扩展格式）
触发：用户说"DB 测试"没匹配到，因为钩子只写英文 `integration tests`。
```
<!--
2026-03-05 auto-fix: rewrote-hook-broader feedback_testing.md
  reason: false-negative; user used "DB 测试" / "数据库测试" — hook only had English term
  before: — integration tests must hit real DB, not mocks
  after:  — integration tests / DB 测试 / 数据库测试 must hit real DB, not mocks
  verify: re-scanned with "数据库测试", now matches
-->
```

**5. 关键词漂移 → `added-synonym`**
触发：用户提到 `lint`，记忆里写 `typecheck`，语义同指但字面不匹配。
```
<!-- 2026-03-05 auto-fix: added-synonym feedback_lint.md — added "lint / typecheck / tsc" to description for cross-term matching -->
```

**6. 内容过期 → `marked-stale`**（扩展格式）
触发：Stage C 加载后发现内容与代码现状冲突（文件已重命名）。
```
<!--
2026-03-05 auto-fix: marked-stale project_auth_rewrite.md
  reason: file auth/middleware.ts no longer exists (renamed to auth/session.ts per git log)
  action: added `stale: true` to frontmatter; scheduled for manual review
  verify: next retrieval should downgrade this memory per 10.4
-->
```

**7. 索引膨胀 → `escalated-manual`**
触发：`MEMORY.md` 接近 200 行阈值，无法自动瘦身（语义判断）。
```
<!-- 2026-03-05 auto-fix: escalated-manual (N/A) — MEMORY.md at 197 lines, requires manual merge per 3.10; flagged to user at turn end -->
```

**8. 多记忆冲突 → `escalated-manual`**
触发：`feedback_mock_db.md` 与 `feedback_real_db.md` 语义矛盾，走 8.3 流程。
```
<!-- 2026-03-05 auto-fix: escalated-manual (N/A) — feedback_mock_db.md conflicts with feedback_real_db.md; route to 8.3 flow (user picks winner); flagged to user -->
```

**9. 跨项目误存 → `escalated-manual`**
触发：`opencode-goal` 目录的记忆里出现 `opencode-loop` 主题，移文件需人工确认。
```
<!-- 2026-03-05 auto-fix: escalated-manual (N/A) — project_loop_scheduler.md belongs to /root/project/opencode-loop; move requires user confirmation (cross-project) -->
```

**10. 大规模变更 → `escalated-manual`**
触发：一次检测到 5 个悬空文件，超护栏 N=3，必须降级人工。
```
<!-- 2026-03-05 auto-fix: escalated-manual (N/A) — 5 orphan files detected (feedback_a, feedback_b, feedback_c, reference_x, reference_y); exceeds guardrail N=3, requires batch manual review -->
```

#### 10.6.9 日志清理策略

- 留痕保留 **1 个对话周期**（防误修可追溯回滚）
- 下次自动修时清理上次留下的旧条目（动作类型 `purged-stale-logs`）
- 单次清理上限 10 条（防一次清空丢上下文）
- `escalated-manual` 条目保留 **2 个对话周期**（人工未处理时持续可见，不沉底）
- 清理本身也留痕：
```
<!-- 2026-03-12 auto-fix: purged-stale-logs — removed 3 entries from 2026-03-05 (removed-dead-pointer×1, added-synonym×2) -->
```

#### 10.6.10 审计与统计

定期用 Grep 统计自动修频次，发现系统性问题：
```
Grep pattern="auto-fix: " path="/root/.codebuddy/projects/<project-slug>/memory/MEMORY.md"
```

**告警阈值**：
- 同一文件被自动修 ≥ 3 次 → 钩子或内容根本有问题，需**重写**而非反复修
- `escalated-manual` 累积 > 5 条未处理 → 提示用户做一次索引重建（参见 3.9）
- 单次对话触发 ≥ 3 次自动修 → 触发护栏上限，后续降级人工（参见 10.6.4）

**审计示例**：
```
$ grep "auto-fix: " memory/MEMORY.md | sort | uniq -c | sort -rn
   4 rewrote-hook-narrower feedback_testing.md   ← 告警：同文件 3+ 次，需重写
   2 added-synonym feedback_lint.md
   1 removed-dead-pointer feedback_old_db.md
   1 escalated-manual (N/A)                       ← 累积监控
```

### 10.7 跨文件追溯

记忆引用另一记忆时（`**Supersedes:**` / `**Merges:**` / `**How to apply:** 参见 X`），按需追溯：
- `**Supersedes:** file.md` → 顺藤摸瓜读历史（一般 1 层够）
- `**Merges:** file1, file2` → 已合并，通常不需再读被合并的旧文件
- `**How to apply:** 参见 X` → 读 X 验证

追溯链深度 ≤ 2 层（A→B→C 即停）。再深说明索引有问题，应做合并或重建。

### 10.8 何时不检索

检索不是越多越好。**不检索**当：
- 当前任务是 trivial 修改（typo、重命名、加注释）
- 用户明确说"不要用记忆"
- 任务完全自包含（写一个独立的新函数、改一处明显的 bug）
- 上下文已接近窗口上限
- 用户问的是当前对话里刚说过的事（用对话历史，不用记忆）

过度检索会浪费 token 且稀释关键信号。

---

## 11. 系统提示词原文

以下是注入到 AI 上下文、驱动记忆行为的系统提示词原文（节选）。

### 11.1 主记忆提示词

```
You have a persistent, file-based memory system at
`/root/.codebuddy/projects/<project-slug>/memory`. This directory already
exists — write to it directly with the Write tool (do not run mkdir or check
for its existence).

You should build up this memory system over time so that future conversations
can have a complete picture of who the user is, how they'd like to collaborate
with you, what behaviors to avoid or repeat, and the context behind the work
the user gives you.

If the user explicitly asks you to remember something, save it immediately as
whichever type fits best. If they ask you to forget something, find and remove
the relevant entry.
```

### 11.2 类型定义提示词

```
<types>
<type>
    <name>user</name>
    <description>Contain information about the user's role, goals,
    responsibilities, and knowledge. ... Your goal in reading and writing
    these memories is to build up an understanding of who the user is and
    how you can be most helpful to them specifically. ... Keep in mind, that
    the aim here is to be helpful to the user. Avoid writing memories about
    the user that could be viewed as a negative judgement or that are not
    relevant to the work you're trying to accomplish together.</description>
    <when_to_save>When you learn any details about the user's role,
    preferences, responsibilities, or knowledge</when_to_save>
    <how_to_use>When your work should be informed by the user's profile or
    perspective. ...</how_to_use>
    ...
</type>
<type>
    <name>feedback</name>
    <description>Guidance the user has given you about how to approach work
    — both what to avoid and what to keep doing. ... Record from failure
    AND success: if you only save corrections, you will avoid past mistakes
    but drift away from approaches the user has already validated, and may
    grow overly cautious.</description>
    <when_to_save>Any time the user corrects your approach ("no not that",
    "don't", "stop doing X") OR confirms a non-obvious approach worked ("yes
    exactly", "perfect, keep doing that", accepting an unusual choice
    without pushback). Corrections are easy to notice; confirmations are
    quieter — watch for them. ...</when_to_save>
    <how_to_use>Let these memories guide your behavior so that the user
    does not need to offer the same guidance twice.</how_to_use>
    <body_structure>Lead with the rule itself, then a **Why:** line ...
    and a **How to apply:** line ...</body_structure>
    ...
</type>
<type>
    <name>project</name>
    <description>Information that you learn about ongoing work, goals,
    initiatives, bugs, or incidents within the project that is not
    otherwise derivable from the code or git history. ...</description>
    <when_to_save>When you learn who is doing what, why, or by when. ...
    Always convert relative dates in user messages to absolute dates when
    saving (e.g., "Thursday" → "2026-03-05"), so that the memory remains
    interpretable after time passes.</when_to_save>
    ...
</type>
<type>
    <name>reference</name>
    <description>Stores pointers to where information can be found in
    external systems. ...</description>
    ...
</type>
</types>
```

### 11.3 不存什么提示词

```
## What NOT to save in memory

- Code patterns, conventions, architecture, file paths, or project structure
  — these can be derived by reading the current project state.
- Git history, recent changes, or who-changed-what — `git log` / `git blame`
  are authoritative.
- Debugging solutions or fix recipes — the fix is in the code; the commit
  message has the context.
- Anything already documented in CODEBUDDY.md files.
- Ephemeral task details: in-progress work, temporary state, current
  conversation context.

These exclusions apply even when the user explicitly asks to save. If they
ask you to save a PR list or activity summary, ask what was *surprising* or
*non-obvious* about it — that is the part worth keeping.
```

### 11.4 保存流程提示词

```
## How to save memories

Saving a memory is a two-step process:

**Step 1** — write the memory to its own file (e.g., `user_role.md`,
`feedback_testing.md`) using this frontmatter format:

```markdown
---
name: {{memory name}}
description: {{one-line description — used to decide relevance in future
  conversations, so be specific}}
type: {{user, feedback, project, reference}}
---

{{memory content — for feedback/project types, structure as: rule/fact,
then **Why:** and **How to apply:** lines}}
```

**Step 2** — add a pointer to that file in `MEMORY.md`. `MEMORY.md` is an
index, not a memory; each entry should be one line, under ~150 characters:
`- [Title](file.md) — one-line hook`. It has no frontmatter. Never write
memory content directly into `MEMORY.md`.

- `MEMORY.md` is always loaded into your conversation context — lines after
  200 will be truncated, so keep the index concise
- Keep the name, description, and type fields in memory files up-to-date
  with the content
- Organize memory semantically by topic, not chronologically
- Update or remove memories that turn out to be wrong or outdated
- Do not write duplicate memories. First check if there is an existing
  memory you can update before writing a new one.
```

### 11.5 访问时机提示词

```
## When to access memories
- When memories seem relevant, or the user references prior-conversation work.
- You MUST access memory when the user explicitly asks you to check, recall,
  or remember.
- If the user says to *ignore* or *not use* memory: proceed as if MEMORY.md
  were empty. Do not apply remembered facts, cite, compare against, or
  mention memory content.
- Memory records can become stale over time. Use memory as context for what
  was true at a given point in time. Before answering the user or building
  assumptions based solely on information in memory records, verify that the
  memory is still correct and up-to-date by reading the current state of the
  files or resources. If a recalled memory conflicts with current information,
  trust what you observe now — and update or remove the stale memory rather
  than acting on it.
```

### 11.6 推荐前验证提示词

```
## Before recommending from memory

A memory that names a specific function, file, or flag is a claim that it
existed *when the memory was written*. It may have been renamed, removed, or
never merged. Before recommending it:

- If the memory names a file path: check the file exists.
- If the memory names a function or flag: grep for it.
- If the user is about to act on your recommendation (not just asking about
  history), verify first.

"The memory says X exists" is not the same as "X exists now."

A memory that summarizes repo state (activity logs, architecture snapshots)
is frozen in time. If the user asks about *recent* or *current* state, prefer
`git log` or reading the code over recalling the snapshot.
```

### 11.7 与其他持久化区分的提示词

```
## Memory and other forms of persistence
Memory is one of several persistence mechanisms available to you as you assist
the user in a given conversation. The distinction is often that memory can be
recalled in future conversations and should not be used for persisting
information that is only useful within the scope of the current conversation.
- When to use or update a plan instead of memory: If you are about to start a
  non-trivial implementation task and would like to reach alignment with the
  user on your approach you should use a Plan rather than saving this
  information to memory. Similarly, if you already have a plan within the
  conversation and you have changed your approach persist that change by
  updating the plan rather than saving a memory.
- When to use or update tasks instead of memory: When you need to break your
  work in current conversation into discrete steps or keep track of your
  progress use tasks instead of saving to memory. Tasks are great for
  persisting information about the work that needs to be done in the current
  conversation, but memory should be reserved for information that will be
  useful in future conversations.
```

### 11.8 搜索过去上下文提示词

```
## Searching past context

When looking for past context:
1. Search topic files in your memory directory:
   Grep with pattern="<search term>" path="/root/.codebuddy/projects/<slug>/memory" glob="*.md"
2. Session transcript logs (last resort — large files, slow):
   Grep with pattern="<search term>" path="/root/.codebuddy/projects/<slug>/sessions/" glob="*.jsonl"
Use narrow search terms (error messages, file paths, function names) rather
than broad keywords.
```

---

## 12. 完整示例

### 12.1 目录树
```
/root/.codebuddy/projects/root-project-foo/memory/
├── MEMORY.md
├── user_role.md
├── user_background.md
├── feedback_testing.md
├── feedback_response_style.md
├── project_auth_rewrite.md
├── project_merge_freeze.md
└── reference_grafana.md
```

### 12.2 `MEMORY.md`（索引）
```markdown
- [user role](user_role.md) — data scientist, focused on observability/logging
- [user background](user_background.md) — 10y Go, new to React frontend
- [testing feedback](feedback_testing.md) — integration tests must hit real DB, not mocks
- [response style](feedback_response_style.md) — terse, no trailing summaries
- [auth rewrite](project_auth_rewrite.md) — driven by legal/compliance, not tech-debt
- [merge freeze](project_merge_freeze.md) — begins 2026-03-05 for mobile release cut
- [grafana dashboard](reference_grafana.md) — grafana.internal/d/api-latency is oncall dashboard
```

### 12.3 一个 feedback 记忆完整文件
文件：`memory/feedback_testing.md`
```markdown
---
name: integration tests must hit real DB
description: integration tests must hit a real database, not mocks — prior incident where mock/prod divergence masked a broken migration
type: feedback
---
集成测试必须连真实数据库，不能用 mock。

**Why:** 上季度 mock 测试通过但生产迁移失败，被坑过 —— mock 与生产 schema 偏离掩盖了破坏性 migration。

**How to apply:** 写或修改集成测试时强制连真 DB；不要为了速度引入 mock DB；review 他人 PR 时如果看到 mock DB 也要 flag。
```

### 12.4 一个 project 记忆完整文件
文件：`memory/project_merge_freeze.md`
```markdown
---
name: merge freeze for mobile release
description: merge freeze begins 2026-03-05 for mobile release cut — flag non-critical PRs after that date
type: project
---
周四之后所有非关键 merge 冻结 —— 移动团队切 release 分支。

**Why:** 移动团队要切 release 分支，主干需要稳定。
**How to apply:** 在 2026-03-05 之后提交的非关键 PR 工作要主动标出，建议推迟或单独走 hotfix 通道。
```

### 12.5 一个 reference 记忆完整文件
文件：`memory/reference_grafana.md`
```markdown
---
name: oncall latency dashboard
description: grafana.internal/d/api-latency is the oncall latency dashboard — check it when editing request-path code
type: reference
---
grafana.internal/d/api-latency 是 oncall 监控延迟的看板。改请求路径代码时会被这条曲线 pager 某人，改之前先看一眼基线。
```

### 12.6 一个 user 记忆完整文件
文件：`memory/user_background.md`
```markdown
---
name: user background
description: deep Go expertise, new to React and this project's frontend — frame frontend explanations in terms of backend analogues
type: user
---
用户写了十年 Go，但是第一次接触这个仓库的 React 前端。
```

---

## 13. 设计哲学小结

1. **索引与内容分离** —— 索引常驻上下文（小），内容按需加载（详）
2. **按主题不按时间** —— 同主题聚合，便于更新和检索
3. **Why 与 How to apply 强制** —— 让 AI 能在边界情况判断，而非机械套用
4. **从纠正和确认双向记录** —— 避免只记失败导致过度保守
5. **快照可失效** —— 记忆只是某时刻为真的陈述，使用前验证
6. **不重复其他权威源** —— git / 代码 / CODEBUDDY.md 已有的不记
7. **AI 自主维护** —— 不等用户指令就主动记，但用户要忘就立刻删
8. **按项目隔离** —— 不同工作目录的记忆互不污染
9. **相对日期转绝对** —— 否则时间一过不可解读
10. **跨对话 vs 对话内** —— 只记未来对话也有用的；当前对话的用 Plan/Task
11. **默认类型前缀命名** —— `feedback_*` / `project_*` / `user_*` / `reference_*`，一眼分类且防同名冲突
12. **冲突不并存** —— 矛盾的两条记忆必须二选一，赢家加 `**Supersedes:**`，输家删除，避免未来检索时再次混乱
13. **索引优先检索** —— Stage A 扫 `MEMORY.md`（0 成本）→ Stage B Grep（低）→ Stage C Read（高），绝不跳级
14. **钩子决定生死** —— 一行钩子是记忆被检索到的唯一依据，写关键词和触发信号，不写空泛形容词
15. **自动修复带护栏** —— 检索失败时自动修指针/钩子/同义词，但绝不自动删内容、不自动合并、跨项目操作、单对话上限 3 次

---

## 附录 A：相关文件位置参考

- 系统提示注入位置：每次对话以 `<system-reminder data-role="memory">` 标签注入
- 记忆目录：`/root/.codebuddy/projects/<project-slug>/memory/`
- 索引文件：`memory/MEMORY.md`
- 会话日志（最后手段）：`/root/.codebuddy/projects/<project-slug>/sessions/*.jsonl`

## 附录 B：术语表

| 术语 | 含义 |
|---|---|
| 记忆（memory） | 跨对话持久化的信息条目 |
| 索引（MEMORY.md） | 所有记忆条目的目录文件，自动加载到上下文 |
| frontmatter | 记忆文件顶部的 YAML 元数据块 |
| type | 记忆四类之一：user/feedback/project/reference |
| **Why:** | feedback/project 类型必填的"原因"行 |
| **How to apply:** | feedback/project 类型必填的"何时应用"行 |
| 快照记忆 | 描述某时间点仓库/活动状态的记忆，会过期 |
| 会话日志 | `.jsonl` 格式的对话原文，最后手段的检索源 |
| 钩子（hook） | 索引行 `- [标题](file) — X` 中的 X 部分，决定记忆是否被 Stage A 检索到（见 3.6） |
| Stage A/B/C | 三阶段检索：A 扫 `MEMORY.md`（0 成本）/ B Grep 目录（低）/ C Read 文件（高）（见 10.3） |
| 动作类型 | 自动修复留痕的受控词汇，8 个（见 10.6.7） |
| `**Supersedes:**` | 记忆正文里标记"取代了哪条旧记忆"的审计字段（见 8.3） |
| `**Merges:**` | 记忆正文里标记"合并了哪些旧文件"的审计字段（见 8.5） |
| 留痕（log entry） | `MEMORY.md` 末尾的 HTML 注释，记录每次自动修（见 10.6.6） |
| 悬空文件 | `memory/` 下有 `.md` 但 `MEMORY.md` 无对应指针（见 3.8） |
| 死链 | `MEMORY.md` 指针指向不存在的文件（见 3.8） |
| stale | frontmatter 的 `stale: true` 字段，标记内容过期待人工处理（见 10.6.3） |
| project-slug | 工作目录路径转义形式，用作记忆目录名（`/` → `-`，见 2.1） |
