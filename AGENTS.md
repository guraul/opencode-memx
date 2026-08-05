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

- **Entry point**: `src/index.ts` exports `MemxPlugin` (V2 `Plugin` 函数)
- **Hooks**: `event` (订阅 `session.idle`) + `tool.reflect` (手动触发) + `dispose`
- **Install**: `~/.config/opencode/plugins/opencode-memx.ts` re-exports `MemxPlugin` from `src/index`
- **Model override**: `~/.opencode/memx.config.json` 的 `refinementModel` 字段 (`provider/model` 格式). Default: `deepseek/deepseek-chat-v4-flash`
- **LLM calls**: 子会话 `client.session.prompt`（非 `ctx.llm.chat`），见 `src/session-llm.ts`
- **USER.md path**: `~/.opencode/USER.md` (hardcoded in `src/user-md.ts`)
- **Backup rotation**: `writeUserMd` auto-backups before every write, keeps 5 versions
- **All hooks try-catched**: never let plugin errors reach the host
- **LLM returns Zod-validated**: `StyleProposalArraySchema` in `src/types.ts`

## Architecture

```
src/
  types.ts         — StyleSignal, StyleProposal, Zod schemas
  prompts.ts       — System prompt constants
  user-md.ts       — read/write/parse/backup USER.md
  signal-capture.ts— regex-based capture + SignalBuffer (max 20)
  refinement.ts    — LLM batch refinement + Zod validation
  config.ts        — `~/.opencode/memx.config.json` load + Zod validation
  session-llm.ts   — LLMClient adapter via child session.prompt
  throttle.ts      — session.idle 节流（throttleMinutes）
  index.ts         — V2 Plugin entry: event + tool.reflect + dispose
tests/
  fixtures/        — mock conversations + sample USER.md
```

## Quirks & gotchas

- **`exactOptionalPropertyTypes`** in tsconfig: optional fields like `target_line?: number` cannot be explicitly set to `undefined`. Use `target_line != null` checks instead of loose equality.
- **`noUncheckedIndexedAccess`**: array access returns `T | undefined`. Always use `[0] ?? fallback`.
- **No `bun:test`**: environment has Node.js + vitest, not Bun. Don't import from `bun:test`.
- **Design docs**: `prd.md` is reference only — don't treat it as code.
- **Signal capture is pure regex** (<5ms): never call LLM in Stage 1 (runs inside the `session.idle` event handler).
- **The `reflect` tool** manually triggers refinement (fallback if `session.idle` doesn't fire).

## Test patterns

- Tests use `vitest` API (`describe`, `it`, `expect`)
- LLM calls are mocked in refinement tests
- USER.md tests write to real `~/.opencode/USER.md` (not temp dir)
