# Flightdeck

Desktop app (Tauri 2 + React 19, Windows first) that brings together the Claude Code sessions of
several hosts. Each host runs `flightdeckd` (Bun + TypeScript, SQLite, WebSocket).

- `apps/daemon`: the `flightdeckd` daemon.
- `apps/desktop`: the app (React in `src/`, Rust in `src-tauri/`). `@tauri-apps/*` may only be
  imported in `src/platform/tauri/` (Biome rule). `src/components/ui/` is vendored: no lint and
  excluded from coverage.
- `packages/protocol`: protocol types and envelope between the app and the daemon.
- `scripts/`: smokes, demo, TDD audit, build and release. Testable logic lives in `scripts/lib/`.
- `docs/`: `SPEC.md` and `SPEC-fase-N.md` (one per phase), `DECISIONS.md` (divergences and
  decisions of each phase), `TDD.md` (the testing rules), `GLOSSARY.md`, `manual/` (en, pt-BR).
- `.claude/`: the shared Claude Code setup. Skills `tdd-area` (one TDD area) and `new-phase`
  (open or close a phase); agents `spec-verifier` (checks a phase against its spec) and
  `tauri-rust-reviewer` (for changes in `src-tauri`); hooks that block wide `git add` and edits of
  generated files and run Biome after each edit, in the main checkout and its worktrees. The
  hook rules live in `scripts/lib/claude-hooks.ts`. Personal settings go to
  `.claude/settings.local.json` (ignored).

## Commands

- Test a single file: `bun --config=bunfig.area.toml test <file>`. A plain `bun test <file>`
  exits with 1 even when it passes, because of the global coverage threshold.
- Full suite (with the 100% line and function threshold): `bun run test`.
- The heavy commands go through the slot: `bun run slot -- <command...>` (for example
  `bun run slot -- bun run test`). It is one exclusive lock for the whole machine, with a queue;
  `bun run slot -- --status` shows the holder (with a warning past `--max-age`, 90 min by
  default), `--nice` lowers the command's priority, `--cancel` stops your own waiters and run
  (matched by `FLIGHTDECK_SLOT_LABEL`, never another session's), so nobody needs `pkill -f`.
  `--priority` (for the maintainer's full gate) also lowers the other `bun test` processes of the
  user while it runs.
- Tests for what you changed: `bun run test:related [--base <ref>]`. It takes the files changed
  since the merge-base with `main` (or `<ref>`), picks the changed test files plus every test
  that imports a changed file (transitively), prints each with the reason, and runs them in one
  call (through the slot above 60 files). The run also collects coverage and fails unless every
  changed source file is at 100% lines and functions, listing the uncovered `file:line` and the
  uncalled functions (`bunfig.related.toml`; the same exclusions as the full suite). A change to `package.json`, a `bunfig` or the preload
  prints a warning: run the full suite then.
- Which function a file is missing: `bun run coverage:funcs <file.ts>... [--tests <test.ts>...]` runs
  the tests that reach the files (or the ones named after --tests) and lists the functions no test
  called as `file:line`. Bun's coverage only counts them. It instruments in memory, never the sources.
- Sonar rules before a push: `bun run lint:sonar [--base <ref>] [--no-types] [--all]` runs Sonar's
  own JS/TS rules (eslint-plugin-sonarjs, in `tools/sonar-lint`, aligned with our SonarCloud
  profile in `scripts/sonar-profile.json`) on the lines changed since the merge-base with `main`,
  which is the new code the SonarCloud gate judges. `--no-types` skips the rules that need the
  TypeScript program (a minute faster); `// NOSONAR: <reason>` suppresses a reviewed false positive
  on both sides, and a NOSONAR with no reason fails. Biome stays the linter.
- Before hand-off from a session: `bun run typecheck`, `bun run lint`, `bun run lint:sonar`,
  `bun run tdd:audit` and `bun run test:related`. The full suite (`bun run test`) runs at the
  orchestrator's version gate and in CI, not in every session.
- Format: `bun run format`. Smokes: `bun run smoke:<name>` (list in `package.json`; never
  `smoke:real` unless asked).
- Audit: `bun run tdd:audit -- --since <tag or commit>`. Accepts any commit, for example
  `$(git merge-base HEAD main)` on a phase branch.
- Screens: `bun run demo` (two fake hosts and the web entry at http://localhost:1420),
  `bun run demo:shots` (prints in both themes and languages, plus axe), `bun run e2e` (the
  journeys, in both languages, with `@playwright/test`: `E2E_ONLY=a,b` picks journeys, and
  `bun run e2e -- --repeat-each 5` hunts flakes; the HTML report is in `playwright-report/`).
- Builds: `bun run build:daemon`, `bun run build:desktop`. `cargo check` (in
  `apps/desktop/src-tauri`) requires `bun run build:desktop` first.

## Non-negotiable rules

The full rules are in [docs/TDD.md](docs/TDD.md). Read it before starting an area.

- Red → green per area: stub with real signatures and wrong values (never `throw`), red **by
  assertion**, commit the test alone (`test(<area>): ...`), minimal implementation, green, full
  suite, commit `feat(<area>): ...`. Every `feat`/`fix` needs a prior `test` with the same scope.
- `git add` always with explicit paths, never `-A`, `-u` or `.`, and `git status --short` before
  the commit. No `git commit -a`.
- Forbidden in committed code: `.only`, `.skip`, `test.todo`, `toMatchSnapshot` on the first
  run, weakening an assertion.
- Tests touch nothing real. The preload replaces `claude` on the PATH with a sentinel and
  `HOME` with a temporary folder, so nothing reads or writes the real `~/.claude`. Other CLIs
  (`gh`, `az`, `ssh`, check commands) are fakes on the test PATH, with a `.cmd` version on
  Windows. No network, and services (`systemctl`, `schtasks`) go through an injected context. To
  look up executables, use `whichOnPath` (`apps/daemon/src/which.ts`), never `Bun.which(name)`
  without options.
- Never read credentials, tokens, `~/.claude/.credentials.json`, SSH keys or shell history, not
  even in a test or a proof of concept (`.claude/settings.json` denies the obvious paths).
- Phase sessions never push, tag or publish releases. They hand the green HEAD over; the
  maintainer integrates the phase into `main`, tags it and releases.

- Full suite, `demo:shots`, `e2e`, the smokes and the builds run only through
  `bun run slot --`, never bare: two of them at once overload the machine and make the
  timing-sensitive tests flaky. Area tests, typecheck and lint do not need the slot.
  `bun run typecheck` and `bun run lint` go through the light lane by themselves
  (`scripts/lane.ts`): at most two run at once on the machine, since one tsc run takes up to
  1.5 GB, and a third waits for a place.

## Conventions

- Everything new written to the codebase is in English: code, identifiers, comments, commit
  messages, test titles, docs (specs, `DECISIONS.md`, `GLOSSARY.md`, READMEs) and any other file.
  The only exceptions are user-facing translations: the pt-BR app strings
  (`apps/desktop/src/i18n/pt-BR.ts`) and the pt-BR versions of the README and the manual. Older
  text in Portuguese stays as it is; do not rename it in bulk (it would conflict with the open
  phase branches).
- Text a person sees in the app comes from the dictionaries (`apps/desktop/src/i18n/en.ts` and
  `pt-BR.ts`), always in both languages; never a literal in a component.
- The product version is the same in the protocol, the daemon, the desktop and
  `tauri.conf.json`. A test checks this; change the version with the `test(versao)` cycle.
- Each phase runs in a sibling worktree (`../flightdeck-faseN`, branch `fase-N`, from `main`).
  Each phase also updates both manuals (`docs/manual/en.md` and `pt-BR.md`).
- Divergences from the spec go to `docs/DECISIONS.md`, in the phase's section.

## Gotchas

- With `CLAUDECODE` set, `bun test` hides the `(pass)` lines. To see the list, use
  `env -u CLAUDECODE bun test`.
- In Git Bash, the `/TN` in `schtasks /TN ...` gets rewritten as a path. Use PowerShell.
- In stdin mode, Biome's exit code does not reflect the diagnostics.
