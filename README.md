# opencode-memx

OpenCode V2 双轨记忆插件。从对话历史中自动提炼跨会话的用户偏好（Track 1）和项目背景（Track 2），分别持久化到 `~/.opencode/USER.md` 和 `~/.opencode/projects/<slug>/.mem/*.md`。

OpenCode V2 dual-track memory plugin. Automatically extracts cross-session user preferences (Track 1) and project context (Track 2) from conversation history, persisting to `~/.opencode/USER.md` and `~/.opencode/projects/<slug>/.mem/*.md` respectively.

## 设计哲学 / Design Philosophy

`opencode-memx` 基于一个核心洞察：**用户偏好（User Style）和项目事实（Memory）是两种截然不同的记忆类型**。

`opencode-memx` is built on a core insight: **user style and project memory are fundamentally different types of memory**.

- **Track 1（User Style）**：跨项目通用的慢变量画像（沟通风格、工具链偏好、技术审美）。单文件 `USER.md`，四分类，200 行压缩。主 AI 通过 `STYLE_SIGNAL` HTML 注释标记信号，子 AI 批量提炼。
- **Track 1 (User Style)**: Cross-project slow-changing profile (communication style, toolchain preferences, technical taste). Single `USER.md` file, four categories, 200-line compression. Main AI marks signals via `STYLE_SIGNAL` HTML comments; sub-AI batches refinement.
- **Track 2（Project Memory）**：项目绑定的快变量日志（进行中的工作、外部资源、协作指导）。索引 `MEMORY.md` + 独立 `.mem/*.md`（带 frontmatter，feedback/project 强制 Why + How to apply）。主 AI 通过 `MEMORY_SIGNAL` HTML 注释标记信号，子 AI 批量提炼。
- **Track 2 (Project Memory)**: Project-bound fast-changing log (ongoing work, external resources, collaboration guidance). `MEMORY.md` index + standalone `.mem/*.md` files (with frontmatter; feedback/project types require Why + How to apply). Main AI marks signals via `MEMORY_SIGNAL` HTML comments; sub-AI batches refinement.

两条轨道共享同一触发管道（`session.idle` / `reflect`），但信号缓冲、提炼、写入完全独立。

Both tracks share the same trigger pipeline (`session.idle` / `reflect`) but have completely independent signal buffers, refinement, and write targets.

### 开源实现借鉴 / Open-Source References

| 参考项目 / Reference | 借鉴部分 / Borrowed | 本插件中的体现 / In This Plugin |
| :--- | :--- | :--- |
| **CodeBuddy** | 索引+内容分离、frontmatter、强制 Why/How to apply、What NOT to save / Index+content separation, frontmatter, mandatory Why/How to apply, What NOT to save | Track 2 的 `MEMORY.md` + `.mem/*.md` 结构 + `MEMORY_REFINEMENT_SYSTEM_PROMPT` |
| **Honcho** | 辩证式推理 Prompt / Dialectical reasoning prompt | System Prompt 要求 LLM 自问"跨项目是否仍适用"，区分临时指令与长期偏好 / Prompts LLM to ask "does this apply across projects?", distinguishing temporary instructions from long-term preferences |
| **Mem0** | 去重与增量更新机制 / Dedup and incremental update | `StyleProposal.action` / `MemoryProposal.action`（append/update/deprecate）+ 去重规则 / dedup rules |
| **OpenClaw** | 时间衰减与生命周期管理 / Time decay and lifecycle management | 200 行压缩机制 + 废弃条目删除线标记（不物理删除）/ 200-line compression + strikethrough deprecation (no physical deletion) |
| **OpenCode V2 Plugin API** | Hook 体系 + `instructions` 加载 / Hook system + `instructions` loading | `event` / `tool.reflect` / `dispose` + `~/.config/opencode/opencode.json` 的 `instructions` 字段自动注入 / auto-injection via `instructions` field |
| **Zod** | Runtime Schema Validation | 所有 LLM 返回值强制 runtime validate，防止 JSON Mode 输出漂移 / All LLM returns are runtime-validated to prevent JSON Mode drift |

### 关键设计决策 / Key Design Decisions

| 决策 / Decision | 理由 / Rationale |
| :--- | :--- |
| **主 AI 发 HTML 注释标记 / Main AI emits HTML comment markers** | 主 AI 拿完整对话上下文，识别偏好的能力远超正则。用户看不到注释，插件解析。 / Main AI has full conversation context, far better at identifying preferences than regex. Users don't see comments; plugin parses them. |
| **子 AI 批量提炼 / Sub-AI batch refinement** | 去重、冲突检测、schema 校验由 Stage 2 子会话 LLM 完成，主 AI 只负责"识别信号" / Dedup, conflict detection, schema validation done by Stage 2 sub-session LLM; main AI only identifies signals |
| **自动写入 + 备份 / Auto-write + backup** | 去掉了人工确认环节，每次写入前自动备份 + 保留最近 5 版 / No human confirmation; auto-backup before every write, keeping latest 5 versions |
| **`instructions` 加载 / `instructions` loading** | `~/.config/opencode/opencode.json` 的 `instructions` 数组让宿主在会话启动时自动把 `USER.md` + `MEMORY.md` 注入主 AI 的 system prompt / Host auto-injects `USER.md` + `MEMORY.md` into main AI's system prompt at session start |
| **按项目隔离 / Project isolation** | Track 2 的 `.mem/` 目录按工作目录 slug 隔离（`/root/project/foo` -> `root-project-foo`），跨项目记忆互不污染 / Track 2's `.mem/` dir is isolated by working directory slug; cross-project memories don't pollute |

## 双轨管道 / Dual-Track Pipeline

```
[信号捕获]                    ->    [批处理提炼 + 持久化]
[Signal Capture]                    [Batch Refinement + Persistence]
 session.idle / reflect              session.idle / reflect
      │                                  │
 Track 1: STYLE_SIGNAL HTML 注释      Track 1: LLM 辩证提炼
 Track 2: MEMORY_SIGNAL HTML 注释    + USER.md 比对 + 增量 Patch
      │                                  │
 内存缓冲区 (上限 20, 按 evidence      Track 2: LLM 辩证提炼
 去重)                                + MEMORY.md 比对
      │                                  + .mem/*.md 写入
      ↓                                  ↓
 app.log 诊断日志 + 清空缓冲区        USER.md + MEMORY.md 自动备份
```

## 触发机制 / Trigger Mechanism

- `session.idle`：每次回复结束、会话真正空闲时触发，自动捕获信号并提炼（受 `throttleMinutes` 节流）。
- `session.deleted` / 退出（`dispose`）：强制冲刷缓冲区，不拉取会话历史。
- `reflect` 工具：手动触发完整提炼（拉取当前会话最后一轮 + 跳过节流），同时运行 Track 1 和 Track 2。用于 `session.idle` 未触发时的兜底。
- 插件自动跳过自己创建的提炼子会话，不会自我触发；提炼过程互斥串行（`refinementInFlight`），防止并发风暴与重复写入。

- `session.idle`: Fires when session is truly idle (after a turn fully ends). Auto-captures signals and refines (throttled by `throttleMinutes`).
- `session.deleted` / exit (`dispose`): Force-flushes buffer without fetching session history.
- `reflect` tool: Manually triggers full refinement (fetches last turn + skips throttle). Runs both Track 1 and Track 2. Fallback when `session.idle` doesn't fire.
- Plugin auto-skips its own refinement sub-sessions; refinement is mutex-serialized (`refinementInFlight`) to prevent concurrent storms and duplicate writes.

## 安装 / Installation

### 方式一：全局插件目录（推荐）/ Global Plugin Directory (Recommended)

1. 克隆仓库 / Clone the repo：
   ```bash
   git clone <仓库地址> /path/to/opencode-memx
   cd /path/to/opencode-memx
   npm install
   ```

2. 创建全局插件入口（指向 src/index.ts）/ Create global plugin entry (pointing to src/index.ts)：
   ```bash
   mkdir -p ~/.config/opencode/plugins
   echo 'export { MemxPlugin } from "/path/to/opencode-memx/src/index";' > ~/.config/opencode/plugins/opencode-memx.ts
   ```

3. 声明依赖（若 `~/.config/opencode/package.json` 不存在）/ Declare dependencies (if `~/.config/opencode/package.json` doesn't exist)：
   ```json
   { "dependencies": { "zod": "^4.4.3", "@opencode-ai/plugin": "^1.18.11" } }
   ```

4. 在 `~/.config/opencode/opencode.json` 加 `instructions` 字段，让 USER.md + MEMORY.md 自动注入主 AI 的 system prompt / Add `instructions` field to `~/.config/opencode/opencode.json` to auto-inject USER.md + MEMORY.md into main AI's system prompt：
   ```json
   {
     "$schema": "https://opencode.ai/config.json",
     "instructions": ["~/.opencode/USER.md", "~/.opencode/MEMORY.md"]
   }
   ```
   如果已有其他配置，合并 `instructions` 字段即可。 / If you already have other config, just merge the `instructions` field.

5. 重启 OpenCode，`/status` 应显示 `opencode-memx`。 / Restart OpenCode; `/status` should show `opencode-memx`.

### 配置 / Configuration

通过 `~/.opencode/memx.config.json` 自定义 / Customize via `~/.opencode/memx.config.json`：

| 字段 / Field | 类型 / Type | 默认值 / Default | 说明 / Description |
| :--- | :--- | :--- | :--- |
| `refinementModel` | `string` | `opencode/deepseek-v4-flash-free` | 提炼模型（`provider/model` 格式）/ Refinement model (`provider/model` format) |
| `maxSignalsPerSession` | `number` | `20` | 信号缓冲区上限 / Signal buffer max size |
| `autoBackupCount` | `number` | `5` | 备份保留数 / Backup retention count |
| `throttleMinutes` | `number` | `10` | 提炼节流间隔（分钟）/ Refinement throttle interval (minutes) |

## USER.md 格式 / USER.md Format

插件管理的用户风格文件位于 `~/.opencode/USER.md` / The plugin-managed user style file is at `~/.opencode/USER.md`：

```markdown
# User Profile & Style

> Auto-generated by opencode-memx. Last updated: 2026-07-29

## 沟通与交互风格
- [2026-07-29] 偏好直接给出重构后的完整代码，而非分步骤解释

## 工具与环境偏好
- [2026-07-25] 使用 pnpm 而非 npm/yarn

## 架构与技术决策
- [2026-07-22] 新项目默认使用 SvelteKit + Drizzle ORM

## 踩坑与禁忌
- [2026-07-27] 不要在代码注释中使用 Emoji
- ~~[2026-07-15] 偏好 Vue 3 Composition API~~ (Deprecated: 已迁移至 Svelte)
```

**格式规则 / Format Rules：**
- 每条以 `- [YYYY-MM-DD]` 开头 / Each entry starts with `- [YYYY-MM-DD]`
- 废弃条目用 `~~删除线~~` 标记，不物理删除 / Deprecated entries marked with `~~strikethrough~~`, not physically deleted
- 四个固定分类标题，不可新增 / Four fixed category headers, no additions
- 硬限制 200 行，超限自动压缩 / Hard limit 200 lines, auto-compress when exceeded

## MEMORY.md 格式（Track 2 - 项目记忆）/ MEMORY.md Format (Track 2 - Project Memory)

插件同时管理项目级记忆，索引文件位于 `~/.opencode/MEMORY.md`，具体记忆文件位于 `~/.opencode/projects/<slug>/.mem/*.md`。

The plugin also manages project-level memory. The index file is at `~/.opencode/MEMORY.md`, and individual memory files are at `~/.opencode/projects/<slug>/.mem/*.md`.

```
~/.opencode/
├── USER.md                    # Track 1: 全局用户风格 / Global user style
├── MEMORY.md                  # Track 2: 项目记忆索引（按项目分节）/ Project memory index (grouped by project)
└── projects/
    └── <slug>/
        └── .mem/
            ├── project_auth_rewrite.md
            ├── reference_grafana.md
            └── feedback_testing.md
```

**MEMORY.md 索引格式 / MEMORY.md Index Format**：
```markdown
## root-project-foo
- [auth rewrite](~/.opencode/projects/root-project-foo/.mem/project_auth_rewrite.md) - auth middleware rewrite driven by compliance
- [grafana dashboard](~/.opencode/projects/root-project-foo/.mem/reference_grafana.md) - grafana.internal/d/api-latency is oncall dashboard

## root-project-bar
- [loop scheduler](~/.opencode/projects/root-project-bar/.mem/project_loop_scheduler.md) - scheduler refactor in progress
```

**记忆文件格式**（带 frontmatter，feedback/project 强制 Why + How to apply）/ **Memory File Format** (with frontmatter; feedback/project types require Why + How to apply)：
```markdown
---
name: auth rewrite
description: auth middleware rewrite driven by compliance
type: project
---
Rewriting auth middleware for compliance.

**Why:** Legal flagged session token storage.
**How to apply:** Scope decisions favor compliance over ergonomics.
```

**四类记忆 / Four Memory Types**：
- `project`：进行中的工作、目标、事故（不可从代码推出）/ Ongoing work, goals, incidents (not derivable from code)
- `reference`：外部资源指针（Linear、grafana 等）/ External resource pointers (Linear, grafana, etc.)
- `feedback`：协作指导（纠正 + 确认）/ Collaboration guidance (corrections + confirmations)
- `user`：用户角色、知识背景 / User role, knowledge background

## 命令 / Commands

### `reflect`
手动触发风格 + 项目记忆提炼（`session.idle` 未自动触发时使用）。

Manually triggers style + project memory refinement (use when `session.idle` doesn't fire).

## 故障排查 / Troubleshooting

- **`session.idle` 迟迟不触发**：该事件只在会话真正空闲（一轮回复完全结束）后触发，连续工具调用 / 活跃回合会无限延迟。直接调用 `reflect` 工具手动触发。
- **`session.idle` doesn't fire**: This event only fires when the session is truly idle (after a turn fully ends). Continuous tool calls / active turns delay it indefinitely. Use the `reflect` tool to trigger manually.
- **改代码不生效**：插件在 OpenCode 启动时加载一次，修改 `src/` 后必须重启 OpenCode；修改 `~/.opencode/memx.config.json` 则即时生效（每次提炼时重新读取）。
- **Code changes not taking effect**: Plugins load once at startup; you must restart OpenCode after modifying `src/`. Changes to `~/.opencode/memx.config.json` take effect immediately (read at each refinement).
- **提炼模型**：默认 `opencode/deepseek-v4-flash-free`（内置免费模型，无需 API key）。deepseek 官方 key 在当前环境无效，不要配置 `deepseek/*` 模型。
- **Refinement model**: Default `opencode/deepseek-v4-flash-free` (built-in free model, no API key needed). DeepSeek official keys are invalid in this environment; don't configure `deepseek/*` models.
- **日志**：位于 `~/.local/share/opencode/log/opencode.log`。插件的 `app.log` 消息不显示 `service` 字段，排查时搜索 `level=ERROR`，成功写入搜索 `Updated USER.md` 或 `Updated MEMORY.md`。
- **Logs**: Located at `~/.local/share/opencode/log/opencode.log`. Plugin `app.log` messages don't show the `service` field; search `level=ERROR` for errors, `Updated USER.md` or `Updated MEMORY.md` for successful writes.
- **LLM 输出排查**：每次提炼会记录 `llm raw(N): ...`（400 字符截断），可确认 LLM 原始返回是否合法 JSON。
- **LLM output debugging**: Each refinement logs `llm raw(N): ...` (400-char truncation) to verify the LLM's raw return is valid JSON.

## 开发 / Development

```bash
npm install       # 安装依赖 / Install dependencies
npm test          # 运行测试 / Run tests
npm run typecheck # 类型检查 / Type check
```

## 协议 / License

MIT
