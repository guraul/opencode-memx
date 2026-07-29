# opencode-memx Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an OpenCode V2 plugin that extracts user style preferences from conversations and persists them to `~/.opencode/USER.md`.

**Architecture:** Three-stage pipeline: (1) regex-based signal capture in `message.complete` hook, (2) LLM-based batch refinement in `session.idle` hook, (3) human confirmation via `$.ui.confirm()` before atomic write.

**Tech Stack:** TypeScript (Bun runtime), OpenCode V2 Plugin API, Zod for runtime validation, no external dependencies.

## Global Constraints

- Zero external dependencies beyond OpenCode V2 SDK + Node/Bun built-in modules
- Full TypeScript Strict Mode
- All LLM returns must be runtime-validated with Zod
- All hooks must try-catch to avoid interrupting main conversation
- Single session signal buffer max: 20 entries
- USER.md hard line limit: 200 rows, compression on overflow
- UI confirmation required before any USER.md write
- Atomic file writes via temp file + rename
- All source code under `src/`, all tests under `tests/`

---

## File Generation Order (per PRD §7)

### Task 1: package.json

**Files:**
- Create: `package.json`

- [ ] Create package.json with OpenCode V2 plugin entry

```json
{
  "name": "opencode-memx",
  "version": "0.1.0",
  "description": "User style memory plugin for OpenCode V2 — extracts and persists cross-session preferences",
  "type": "module",
  "main": "src/index.ts",
  "scripts": {
    "test": "bun test",
    "typecheck": "tsc --noEmit"
  },
  "keywords": ["opencode", "plugin", "memory", "user-style"],
  "license": "MIT",
  "files": ["src/"],
  "opencode": {
    "type": "plugin",
    "hooks": ["session.start", "message.complete", "session.idle"],
    "tools": ["reflect", "edit_user_style"]
  }
}
```

### Task 2: tsconfig.json

**Files:**
- Create: `tsconfig.json`

- [ ] Create TypeScript Strict Mode config

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "exactOptionalPropertyTypes": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": ".",
    "declaration": true,
    "types": ["bun-types"]
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"],
  "exclude": ["dist", "node_modules"]
}
```

### Task 3: src/types.ts

**Files:**
- Create: `src/types.ts`

**Produces:** StyleSignal, StyleProposal, UserMdSection types + Zod schemas

- [ ] Create type definitions and Zod schemas

### Task 4: src/prompts.ts

**Files:**
- Create: `src/prompts.ts`

**Produces:** REFINEMENT_SYSTEM_PROMPT constant, COMPRESSION_PROMPT constant

- [ ] Create prompt constants

### Task 5: src/user-md.ts

**Files:**
- Create: `src/user-md.ts`

**Produces:** readUserMd, writeUserMd, parseUserMd, compressUserMd, backupUserMd functions

- [ ] Implement USER.md CRUD operations with atomic writes

### Task 6: src/signal-capture.ts

**Files:**
- Create: `src/signal-capture.ts`

**Produces:** captureSignals (pure function), SignalBuffer class

- [ ] Implement regex-based signal capture and buffer management

### Task 7-9: Test Fixtures

**Files:**
- Create: `tests/fixtures/conversation-with-signals.json`
- Create: `tests/fixtures/conversation-explicit-pref.json`
- Create: `tests/fixtures/sample-user-md.md`

- [ ] Create test fixtures

### Task 10: tests/signal-capture.test.ts

- [ ] Write and run signal capture tests (10+ cases)

### Task 11: tests/user-md.test.ts

- [ ] Write and run USER.md unit tests

### Task 12: src/refinement.ts

**Files:**
- Create: `src/refinement.ts`

- [ ] Implement LLM-based batch refinement with Zod validation

### Task 13: tests/refinement.test.ts

- [ ] Write and run refinement tests with mock LLM returns

### Task 14: src/index.ts

**Files:**
- Create: `src/index.ts`

- [ ] Assemble all modules into plugin hooks/tools/destroy

### Task 15: .opencode-example/opencode.jsonc

**Files:**
- Create: `.opencode-example/opencode.jsonc`

- [ ] Create example config for plugin registration

### Task 16: README.md

**Files:**
- Create: `README.md`

- [ ] Write user documentation

---

## Self-Review Checklist

- [ ] **Spec coverage:** Every PRD section maps to at least one task. §3.1 (types) → Task 3, §3.2-3.3 (signal/proposal types) → Task 3, §4.1 (signal capture) → Task 6, §4.2 (refinement) → Task 12, §4.3 (confirmation) → Task 14, §4.4 (compression) → Task 5, §5 (interfaces) → Task 14, §6 (constraints) → global constraints, §7 (delivery) → all tasks.
- [ ] **Placeholder check:** No TBD, TODO, or vague instructions. Every step has concrete code or exact command.
- [ ] **Type consistency:** StyleSignal/StyleProposal types used in capture → refinement → index all consistent.
