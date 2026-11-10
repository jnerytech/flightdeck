# Overview

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/overview.md)

Flightdeck is a personal command center for Claude Code. The `flightdeckd` daemon hosts Claude
Code sessions through the official Agent SDK, stores every event in SQLite and exposes a
WebSocket protocol. The desktop app (Tauri 2 + React) connects to one or more daemons, shows the
chat as it streams, approves or denies tools, and gathers the sessions of every host in one
place.

```text
packages/protocol   zod schemas + command and event types (shared)
apps/daemon         flightdeckd (Bun + TypeScript)
apps/desktop        Tauri 2 + React app
scripts/            smoke tests, binary builds and coverage check
```

Each delivered phase has its own spec (`docs/SPEC-fase-<n>.md`); Phase 1 and the roadmap are in
[`docs/SPEC.md`](../../SPEC.md). The first ones: Phase 2, multi-host
([`SPEC-fase-2.md`](../../SPEC-fase-2.md)); Phase 3, history ([`SPEC-fase-3.md`](../../SPEC-fase-3.md));
Phase 4, board ([`SPEC-fase-4.md`](../../SPEC-fase-4.md)); Phase 5, session hub
([`SPEC-fase-5.md`](../../SPEC-fase-5.md)); Phase 6, workflows ([`SPEC-fase-6.md`](../../SPEC-fase-6.md)).
