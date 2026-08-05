# opencode-memx — Agent Guide

## Project

OpenCode V2 plugin that extracts user preferences from conversations and persists them to `~/.opencode/USER.md`. Two-stage pipeline: regex signal capture (`event` on `session.idle`) → LLM batch refinement + auto-write (same `session.idle` handler). No human confirmation.

## Commands

```bash
npm test          # vitest run
npm run typecheck # tsc --noEmit
```

Always run `typecheck` before committing — TypeScript strict mode catches easy-to-miss errors.

## Key facts

- **Entry point**: `src/index.ts` exports `MemxPlugin` (V2 `Plugin` 函数). Entry must export ONLY the plugin — extra exported functions get invoked as plugins and crash OpenCode (`plugin config hook failed`)
- **Hooks**: `event` (订阅 `session.idle` + `session.deleted`) + `tool.reflect` (手动触发) + `dispose`
- **Install**: `~/.config/opencode/plugins/opencode-memx.ts` re-exports `MemxPlugin` from `src/index`
- **Model override**: `~/.opencode/memx.config.json` 的 `refinementModel` (`provider/model` 格式), 运行时每次读取 — 改配置**无需重启**. Default: `opencode/deepseek-v4-flash-free` (内置免费模型, 无需 key; deepseek 官方 key 无效, 不要用)
- **LLM calls**: 子会话 `client.session.create` → `session.prompt` (body 带 `system` + `model`) → `session.delete` (finally), 见 `src/session-llm.ts`
- **USER.md path**: `~/.opencode/USER.md` (hardcoded in `src/user-md.ts`)
- **Backup rotation**: `writeUserMd` auto-backups before every write, keeps 5 versions
- **All hooks try-catched**: never let plugin errors reach the host
- **LLM returns Zod-validated**: `StyleProposalArraySchema` in `src/types.ts`; `extractJson` in `refinement.ts` strips markdown fences before parse
- **Concurrency guard**: `runRefinement` is mutex-serialized (`refinementInFlight`), `markRun()` fires BEFORE the LLM call — both prevent child-session storms / duplicate writes when idle events overlap
- **Child-session guard**: `childSessionIDs` set; guard id is removed ONLY on `session.deleted` (not on idle — idle events can arrive after the deleted event)
- **Diagnostics**: each refinement logs `llm raw(N): ...` (400-char truncation) via `client.app.log`

## Architecture

```
src/
  types.ts         — StyleSignal, StyleProposal, Zod schemas
  prompts.ts       — System prompt constants
  user-md.ts       — read/write/parse/backup USER.md
  signal-capture.ts— regex-based capture + SignalBuffer (max 20, dedup by evidence)
  refinement.ts    — LLM batch refinement + Zod validation + extractJson
  config.ts        — `~/.opencode/memx.config.json` load + Zod validation
  session-llm.ts   — LLMClient adapter via child session.prompt
  throttle.ts      — session.idle 节流（throttleMinutes）
  index.ts         — V2 Plugin entry: event + tool.reflect + dispose
tests/
  fixtures/        — mock conversations + sample USER.md
```

## Quirks & gotchas

- **`session.idle` fires only when the session is truly idle** (after a turn fully ends). Continuous tool calls / active turns delay it indefinitely. Debug via the `reflect` tool instead.
- **Src changes require an OpenCode restart** — plugins load once at startup; touching the entry file does NOT hot-reload. Config file changes apply immediately.
- **`exactOptionalPropertyTypes`** in tsconfig: optional fields like `target_line?: number` cannot be explicitly set to `undefined`. Use `target_line != null` checks instead of loose equality.
- **`noUncheckedIndexedAccess`**: array access returns `T | undefined`. Always use `[0] ?? fallback`.
- **No `bun:test`**: environment has Node.js + vitest, not Bun. Don't import from `bun:test`.
- **Design docs**: `prd.md` is reference only — don't treat it as code.
- **`.opencodeignore`**: repo convention file (gitignore style) listing paths agents should not read or modify (`prd.md`, `docs/`, `.superpowers/`, etc.). Honor it even though opencode has no built-in support.
- **Signal capture is pure regex** (<5ms): never call LLM in Stage 1 (runs inside the `session.idle` event handler).
- **The `reflect` tool** manually triggers refinement (fallback if `session.idle` doesn't fire).
- **Grep errors, not `memx`**: `client.app.log` messages don't show the `service` field in opencode.log — search `level=ERROR` when debugging.

## Test patterns

- Tests use `vitest` API (`describe`, `it`, `expect`)
- LLM calls are mocked in refinement tests
- Tests mock `homedir` to `/tmp/opencode-memx-test-home` — they must NEVER touch real `~/.opencode` files
