# opencode-memx V2 重写设计

> **日期**: 2026-08-03
> **状态**: Approved
> **目标**: 把插件从 OpenCode V1 API 迁移到 V2 Plugin API，使其能在 `/status` 中可见并正常工作。

## 1. 背景与问题

现有 `opencode-memx` 按 OpenCode V1 Plugin API 编写，三处不兼容 V2：

1. **入口格式**: `export default { hooks, tools, destroy }`。V2 要求 `export const MemxPlugin: Plugin = async (input) => { return { hooks } }`（具名导出函数，返回扁平 hooks 对象）。
2. **事件名**: 用了 `session.start` / `message.complete`，V2 事件列表中均不存在。V2 Session Events: `session.created/compacted/deleted/diff/error/idle/status/updated`；Message Events: `message.part.removed/updated`、`message.removed`、`message.updated`。
3. **LLM 调用**: 原设计用 `ctx.llm.chat()`（V1 PluginInput 字段）。V2 的 `PluginInput` 只有 `client`/`$`/`directory`/`worktree`/`serverUrl`/`experimental_workspace`，**无 `llm`**。

## 2. 设计决策

### 2.1 架构选型：最小重写（方案 A）

业务逻辑模块（`signal-capture.ts`/`user-md.ts`/`refinement.ts`/`types.ts`/`prompts.ts`/`config.ts`）与 OpenCode API **完全解耦**，不改动。只重写 API 适配层（`index.ts`）+ 新增 LLM 适配器 + 节流模块。

- 优点：测试基本不动，风险低，重写范围可控
- 缺点：`session.prompt` 封装需新写

### 2.2 信号捕获：session.idle 批量模式

放弃 V1 的 `message.complete` 增量捕获。改为在 `session.idle` 事件触发时，用 `client.session.messages({ path: { id: sessionID } })` 一次性拉全量历史，遍历消息找最后一条 user message + 最后一条 assistant message，复用现有 `captureSignals(userMessage, aiMessage)`。

- `session.idle` 触发时机：AI 回复完成、会话状态从 busy 变回 idle 时（非关闭 session，非长时间无交互）
- `SignalBuffer` 保留，跨 `session.idle` 累积，提炼成功后才清空
- 拉历史后只取最新一轮对话扫描，避免重复捕获（配合 buffer 的去重由 LLM 提炼阶段处理）

### 2.3 LLM 调用：子会话 prompt

`refinement.ts` 的 `LLMClient` 接口不变（`chat(params) => string`）。新增 `createSessionLLMClient(client, model?): LLMClient`：

1. `client.session.create({ body: { title: "memx-refinement" } })` 创建临时子会话
2. `client.session.prompt({ path: { id: childSessionID }, body: { parts: [{type:"text", text: userMsg}], model: {providerID, modelID} } })` 调 LLM
3. 从返回的 `AssistantMessage.parts` 里抽 `TextPart.text` 拼成字符串
4. `client.session.delete({ path: { id: childSessionID } })` 清理子会话（finally 块，确保异常也清理）

不污染主对话历史。

### 2.4 节流：N 分钟间隔

新增 `src/throttle.ts`。模块级 `lastRunAt: number`。`session.idle` 时检查 `Date.now() - lastRunAt > throttleMinutes*60000`，不足则跳过（buffer 保留，等下次 idle）。

`throttleMinutes` 从 `memx.config.json` 读，默认 10。

### 2.5 安装：全局插件目录

符合官网文档（`~/.config/opencode/plugins/`）。把入口编译/复制为单文件 `~/.config/opencode/plugins/opencode-memx.ts`。依赖 `zod` + `@opencode-ai/plugin` 在 `~/.config/opencode/package.json` 声明。

## 3. 模块改动清单

### 不改动（业务逻辑层）
- `src/types.ts` — StyleSignal / StyleProposal / Zod schemas
- `src/prompts.ts` — REFINEMENT_SYSTEM_PROMPT
- `src/signal-capture.ts` — captureSignals() + SignalBuffer
- `src/user-md.ts` — read/write/parse/backup/applyProposal

### 改动
- `src/index.ts` — **完全重写**，按 V2 Plugin 格式
- `src/config.ts` - 新增 `throttleMinutes` 字段
- `src/refinement.ts` - 删除 V1 的 `createLLMClient`；`LLMClient` 接口和 `refine()` 不变

### 新增
- `src/throttle.ts` — 节流模块
- `src/session-llm.ts` - `createSessionLLMClient` 实现（独立于 refinement.ts，保持 refinement 纯逻辑）

## 4. 详细设计

### 4.1 `src/index.ts`（重写）

```typescript
import type { Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import { SignalBuffer, captureSignals } from "./signal-capture";
import { refine, createSessionLLMClient } from "./session-llm";
import { readUserMd, writeUserMd, applyProposal, isOverLimit, parseUserMd, serializeUserMd, backupUserMd } from "./user-md";
import { loadMemxConfig } from "./config";
import { shouldRun, markRun } from "./throttle";

const buffer = new SignalBuffer();

async function runRefinement(client: PluginInput["client"], sessionID: string): Promise<string> {
  if (buffer.length === 0) return "[memx] 无信号，跳过";
  if (!shouldRun()) return "[memx] 节流中，跳过";

  const config = await loadMemxConfig();
  const signals = buffer.getAll();
  const existingContent = readUserMd();
  const llm = createSessionLLMClient(client, config.refinementModel);
  const proposals = await refine(signals, llm, existingContent, config.refinementModel);

  if (proposals.length === 0) {
    markRun();
    return "[memx] 无可提炼偏好";
  }

  let content = existingContent;
  for (const p of proposals) content = applyProposal(p, content);
  writeUserMd(content);
  markRun();
  buffer.clear();
  await client.app.log({ body: { service: "memx", level: "info", message: `Updated USER.md: ${proposals.length} items` }});
  return `[memx] 已写入 ${proposals.length} 条`;
}

export const MemxPlugin: Plugin = async ({ client }) => {
  return {
    event: async ({ event }) => {
      if (event.type !== "session.idle") return;
      try {
        const sessionID = event.properties.sessionID;
        const msgs = await client.session.messages({ path: { id: sessionID } });
        const last = extractLastTurn(msgs);
        if (last) {
          const signals = captureSignals(last.user, last.assistant);
          buffer.pushAll(signals);
        }
        await runRefinement(client, sessionID);
      } catch (err) {
        await client.app.log({ body: { service: "memx", level: "error", message: String(err) }});
      }
    },
    tool: {
      reflect: tool({
        description: "手动触发 User Style 提炼",
        args: {},
        async execute(_, ctx) {
          try {
            return await runRefinement(client, ctx.sessionID);
          } catch (err) {
            return `[memx] 失败: ${err}`;
          }
        },
      }),
    },
    dispose: async () => { buffer.clear(); },
  };
};
```

`extractLastTurn(msgs)`: 遍历 `msgs` 数组（按时间序），找最后一个 `info.role === "user"` 的消息和它之后最后一个 assistant 消息，返回 `{ user: string, assistant: string } | null`。

### 4.2 `src/session-llm.ts`（新增）

```typescript
import type { LLMClient } from "./refinement";

export function createSessionLLMClient(client, model?: string): LLMClient {
  return {
    chat: async (params) => {
      let childSessionID: string | undefined;
      try {
        const child = await client.session.create({ body: { title: "memx-refinement" }});
        childSessionID = child.data?.id ?? child.id;

        const promptBody: any = {
          parts: [{ type: "text", text: params.messages[0]?.content ?? "" }],
        };
        if (params.system) {
          promptBody.system = params.system;
        }
        if (model) {
          const [providerID, modelID] = model.split("/");
          promptBody.model = { providerID, modelID };
        }

        const res = await client.session.prompt({ path: { id: childSessionID }, body: promptBody });
        const parts = res.data?.parts ?? res.parts ?? [];
        return parts
          .filter((p) => p.type === "text")
          .map((p) => p.text)
          .join("");
      } finally {
        if (childSessionID) {
          await client.session.delete({ path: { id: childSessionID }}).catch(() => {});
        }
      }
    },
  };
}
```

### 4.3 `src/throttle.ts`（新增）

```typescript
let lastRunAt = 0;

export function shouldRun(throttleMinutes = 10): boolean {
  return Date.now() - lastRunAt > throttleMinutes * 60_000;
}

export function markRun(): void {
  lastRunAt = Date.now();
}
```

### 4.4 `src/config.ts`（改动）

`MemxConfigSchema` 新增字段：
```typescript
throttleMinutes: z.number().int().positive().optional().default(10),
```

### 4.5 `src/refinement.ts`（微调）

`LLMClient` 接口和 `refine()` 函数不动。`createLLMClient`（原 V1 的 ctx.llm 封装）删除，由 `session-llm.ts` 的 `createSessionLLMClient` 替代。

## 5. 安装步骤

1. 编译/复制入口到全局插件目录：`~/.config/opencode/plugins/opencode-memx.ts`
2. `~/.config/opencode/package.json` 声明依赖：
   ```json
   { "dependencies": { "zod": "^4.4.3", "@opencode-ai/plugin": "^1.18.11" } }
   ```
3. OpenCode 启动时自动 `bun install` + 加载插件
4. `~/.config/opencode/opencode.jsonc` 不需要改动（插件目录自动加载，无需 `plugin` 数组）
5. `~/.opencode/memx.config.json` 配置 refinementModel 等

## 6. 测试策略

### 不改动
- `tests/signal-capture.test.ts` — 纯函数测试，不依赖 API
- `tests/user-md.test.ts` — 文件 IO 测试
- `tests/refinement.test.ts` — mock LLMClient 接口不变

### 新增
- `tests/throttle.test.ts` — shouldRun/markRun 时间逻辑
- `tests/session-llm.test.ts` — mock client.session.create/prompt/delete，验证子会话生命周期 + parts 提取 + 异常清理
- `tests/index.test.ts`（可选）— event hook 分发逻辑（mock event + client）

## 7. 风险与缓解

| 风险 | 缓解 |
|:---|:---|
| `session.prompt` 返回结构（data 嵌套 vs 扁平） | SDK 默认 `responseStyle: "fields"`，`res.data` 取 `{ info, parts }`；用 `res.data?.parts ?? []` 兜底 |
| 子会话创建失败 | try/catch + finally 确保清理；失败时 `chat` 返回空串，refine 返回空数组 |
| `session.idle` 每轮触发太频繁 | 节流 N 分钟 + buffer 空时直接跳过 |
| 拉全量历史可能很大 | 只取最后一轮对话扫描，不全量进 buffer |
| model 字符串解析（`provider/model`） | split("/") 后校验长度，无效则不传 model 字段，用默认 |

## 8. 不在本次范围

- `muse.md` / Memory.md 轨道
- 向量搜索（v2.0）
- 发布到 npm
- `edit_user_style` tool（PRD 已移除，本次不恢复）
