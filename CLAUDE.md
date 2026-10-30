# Flightdeck

Desktop app (Tauri 2 + React 19, Windows first) that brings together the Claude Code sessions of
several hosts. Each host runs `flightdeckd` (Bun + TypeScript, SQLite, WebSocket).

- `apps/daemon`: the `flightdeckd` daemon.
- `apps/desktop`: the app (React in `src/`, Rust in `src-tauri/`). `@tauri-apps/*` may only be
  imported in `src/platform/tauri/` (Biome rule). `src/components/ui/` is vendored: no lint and
  excluded from coverage.
- `packages/protocol`: protocol types and envelope between the app and the daemon.
- `scripts/`: smokes, TDD audit, build and release. Testable logic lives in `scripts/lib/`.
- `docs/`: `SPEC.md` and `SPEC-fase-N.md` (one per phase), `DECISIONS.md` (divergences and
  decisions of each phase), `TDD.md` (the testing rules), `manual/`.

## Commands

- Test a single file: `bun --config=bunfig.area.toml test <file>`. A plain `bun test <file>`
  exits with 1 even when it passes, because of the global coverage threshold.
- Full suite (with the 100% line and function threshold): `bun run test`.
- Before any code commit: `bun run test && bun run typecheck && bun run lint`.
- Format: `bun run format`. Smokes: `bun run smoke:<name>` (list in `package.json`).
- Audit: `bun run tdd:audit -- --since <tag or commit>`. Accepts any commit, for example
  `$(git merge-base HEAD main)` on a phase branch.
- `cargo check` (in `apps/desktop/src-tauri`) requires `bun run build:desktop` first.

## Non-negotiable rules

The full rules are in [docs/TDD.md](docs/TDD.md). Read it before starting an area.

- Red → green per area: stub with real signatures and wrong values (never `throw`), red **by
  assertion**, commit the test alone (`test(<area>): ...`), minimal implementation, green, full
  suite, commit `feat(<area>): ...`. Every `feat`/`fix` needs a prior `test` with the same scope.
- `git add` always with explicit paths, never `-A` or `.`, and `git status --short` before the
  commit.
- Forbidden in committed code: `.only`, `.skip`, `test.todo`, `toMatchSnapshot` on the first
  run, weakening an assertion.
- Tests never touch the real Claude or the real `~/.claude`. The preload replaces `claude` on the
  PATH with a sentinel and `HOME` with a temporary folder. To look up executables, use
  `whichOnPath` (`apps/daemon/src/which.ts`), never `Bun.which(name)` without options.

## Conventions

- Everything written to the codebase is in English: code, identifiers, comments, commit
  messages, tests, docs (specs, `DECISIONS.md`, `TDD.md`, READMEs) and any other file. The only
  exceptions are user-facing translations: the pt-BR app strings (`apps/desktop/src/i18n/`) and
  the pt-BR versions of the README and the manual.
- The product version is the same in the protocol, the daemon, the desktop and
  `tauri.conf.json`. A test checks this; change the version with the `test(versao)` cycle.
- Each phase runs in a sibling worktree (`../flightdeck-faseN`, branch `fase-N`).
- Divergences from the spec go to `docs/DECISIONS.md`, in the phase's section.

## Gotchas

- With `CLAUDECODE` set, `bun test` hides the `(pass)` lines. To see the list, use
  `env -u CLAUDECODE bun test`.
- In Git Bash, the `/TN` in `schtasks /TN ...` gets rewritten as a path. Use PowerShell.
- In stdin mode, Biome's exit code does not reflect the diagnostics.
