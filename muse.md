# Design Philosophy & Acknowledgements

## 核心灵感：双轨记忆架构的觉醒

-   **讨论起点**：我们最初试图用一个统一的 Memory 系统同时承载"用户偏好"和"项目事实"，但很快发现两者在**变化速率、容错率、写入时机、检索方式**上完全正交。
-   **关键转折**：你提出"Memory.md 不用讨论吗？"这一问题，直接促使我们将 User Style 从大杂烩记忆中剥离，确立为独立的慢变量轨道。
-   **设计原则**：User Style 是**画像（Profile）**，Memory.md 是**工作日志（Journal）**。前者可批量提炼、需人类确认；后者必须实时事件驱动、静默写入。本 PRD 仅覆盖前者。

## 开源实现参考与具体借鉴点

| 参考项目 | 借鉴部分 | 在本 PRD 中的体现 |
| :--- | :--- | :--- |
| **Honcho** | 辩证式推理 Prompt | §4.2 System Prompt 核心指令：要求 LLM 自问"跨项目是否仍适用"，区分临时指令与长期偏好 |
| **Mem0** | 去重与增量更新机制 | §3.3 `StyleProposal.action` 字段（append/update/deprecate）+ §4.2 去重规则 |
| **OpenClaw** | 时间衰减与生命周期管理 | §4.4 200行压缩机制 + USER.md 废弃条目删除线标记（而非物理删除） |
| **OpenCode V2 Plugin API** | Hook 体系与 UI 交互契约 | §5 接口契约：`message.complete` / `session.idle` / `$.ui.confirm()` 等原生 API 对齐 |
| **Zod** | Runtime Schema Validation | §6 工程约束：所有 LLM 返回值强制 runtime validate，防止 JSON Mode 输出漂移 |

## 关键设计决策的讨论溯源

### 为什么必须人类确认？
源于我们对"Agent 自作主张修改用户画像"风险的讨论。User Style 一旦记错，会导致后续所有会话的体验降级，且难以察觉。因此 §1 明确将"自动静默写入"列为 Non-Goal，§4.3 强制 TUI 确认流程。

### 为什么 Stage 1 禁止调用 LLM？
源于对插件性能影响的担忧。`message.complete` 每轮都会触发，若每次都调 LLM 会造成明显延迟。因此 §4.1 限定为纯正则匹配，耗时 < 5ms，LLM 仅在 `session.idle` 时批量调用一次。

### 为什么 USER.md 限制 200 行？
源于对 Context Window 占用和注意力分散的讨论。User Style 需全量注入 System Prompt，过长会挤占新指令空间。200 行是经验阈值，超限触发 §4.4 压缩机制，确保始终轻量。

### 为什么文件名从 `opencode-user-style` 改为 `opencode-memx`？
源于你对命名简洁性的反馈。"memx"既保留了 memory 的语义，又暗示这是 memory 体系的扩展（extension），且为未来整合 Memory.md 轨道预留了命名空间。

---

> **Design Philosophy**
> `opencode-memx` 的设计基于一个核心洞察：**用户偏好（User Style）和项目事实（Memory）是两种截然不同的记忆类型**。前者是跨项目的慢变量画像，需要辩证提炼和人类确认；后者是项目绑定的快变量日志，需要实时捕获和自动归档。本插件专注于前者，借鉴了 Honcho 的辩证推理、Mem0 的去重机制和 OpenClaw 的生命周期管理，在 OpenCode V2 Plugin API 上实现了零外部依赖、人类可控的风格记忆系统。
