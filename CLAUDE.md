# Flightdeck

Desktop app (Tauri 2 + React 19, Windows first) that brings together the Claude Code sessions of
several hosts. Each host runs `flightdeckd` (Bun + TypeScript, SQLite, WebSocket).

- `apps/daemon`: the `flightdeckd` daemon.
- `apps/desktop`: the app (React in `src/`, Rust in `src-tauri/`). `@tauri-apps/*` may only be
  imported in `src/platform/tauri/` (Biome rule). `src/components/ui/` is vendored: no lint and
  excluded from coverage.
- `packages/protocol`: protocol types and envelope between the app and the daemon.
- `scripts/`: smokes, demo, TDD audit, build and release. Testable logic lives in `scripts/lib/`.
- `docs/`: `SPEC.md` and `SPEC-fase-N.md` (one per phase), `decisions/` (one file per decision or
  divergence; `DECISIONS.md` lists the ones recorded until 2026-11-05), `TDD.md` (the testing rules),
  `GLOSSARY.md`, `manual/` (en, pt-BR).
- `.claude/`: the shared Claude Code setup. Skills `tdd-area` (one TDD area) and `new-phase`
  (open or close a phase); agents `spec-verifier` (checks a phase against its spec),
  `tauri-rust-reviewer` (for changes in `src-tauri`), `test-quality-reviewer` (tests that cannot
  fail), `security-reviewer` (spawns, paths, secrets, pairing) and `ux-reviewer` (a UI change's
  literals, missing keys, focus, keyboard, layout and axe; `bun run scripts/ux-review-eval.ts` measures
  it on planted bad changes, real quota, #983), all read-only; hooks that block wide `git add`, edits of
  generated files, test edits that add `.only`/`.skip`/`test.todo`/`toMatchSnapshot` (a platform `skipIf` passes) or swap a strict
  assertion for a weak one (`// weaker: <why>` on the line lets a reviewed swap through, #1141), commits
  that break `type(scope): text` or the TDD order, heavy runs outside the slot, a worker's full
  coverage run (#674), and a push (or a `bun run pr -- update`) that would cancel the branch's PR run while it is still green (#741:
  younger than 20 minutes with no failed job, or GitHub unread twice; `FLIGHTDECK_PUSH_NOW="<reason>"` in front of the push
  lets it through), and that run
  Biome after each edit, in the main checkout and its worktrees (no project scan, 0.4 s: `noFloatingPromises` and `useArraySortCompare` are left to `bun run lint`, #1566). The hook rules live in `scripts/lib/hooks/claude-hooks.ts`;
  `bun run harness:stats` shows how often each rule blocked and how long the hooks took, and lists
  each push-wait override with its reason and the cancelled run's age, and counts the pushes it let through by reason (#741). Rules per
  area live in `.claude/rules/` (ui, protocol, daemon, tests, scripts) and load when a matching file
  is touched; a SessionStart hook states the branch, the tested scopes, the slot and a red main with its claim, and after a
  compact reminds that those rules come back only with a matching file. Personal settings go to
  `.claude/settings.local.json` (ignored).

## Commands

The detail of every command (the slot, `test:related`, the tiers, `coverage:funcs`, Sonar, `handoff:check`,
the screens and the builds) is in [docs/commands.md](docs/commands.md). What a session needs on its first day:

- A red main (#1246): `bun run main-red` lists what fails and who claimed it (a green run closes the claims);
  claim before fixing: `-- claim "<cause>"` (a second claim on an owned test is refused; pr open/update warn too).
- Test a single file: `bun --config=bunfig.area.toml test <file>`. A plain `bun test <file>`
  exits with 1 even when it passes, because of the global coverage threshold.
- Tests for what you changed: `bun run test:related -- --fast` (a worker session never runs a plain,
  `--base` or `--pr` run: the guard hook refuses it, and the PR's CI runs the rest).
- Heavy commands (the full suite, `demo:shots`, `e2e`, the smokes, the builds) go through
  `bun run slot -- <command...>`, one exclusive lock for the machine; `bun run slot -- --status` shows the holder.
- Before hand-off: `bun run handoff:check` (typecheck, lint, tdd:audit, test:related, then the PR's
  checks and the security gate) prints a `HANDOFF` stamp line.

## Non-negotiable rules

The full rules are in [docs/TDD.md](docs/TDD.md). Read it before starting an area.

- Red → green per area: stub with real signatures and wrong values (never `throw`), red **by
  assertion**, commit the test alone (`test(<area>): ...`), minimal implementation, green, full
  suite, commit `feat(<area>): ...`. Every `feat`/`fix` needs a prior `test` with the same scope;
  the commit hook enforces it. For a deliberate exception, end the message with a trailer line
  `TDD-Waiver: <why>`; `tdd:audit` lists it as waived. A `feat`/`fix` also names its issue (the
  commit hook refuses one that names none): `(#N)` at the end of the subject, or a `Refs: #N` line.
- `git add` always with explicit paths, never `-A`, `-u` or `.`, and `git status --short` before
  the commit. No `git commit -a`. No `git stash` (only `list` and `show`): `refs/stash` is shared
  by every worktree, so a pop can apply another session's changes. Keep work aside with
  `git diff > /tmp/<name>.patch` and `git apply`, or a WIP commit on your branch.
- Forbidden in committed code: `.only`, `test.todo`, `toMatchSnapshot` on the first run,
  weakening an assertion. Tests aim at business logic and the important flows; the gate is 80%
  per file (#1002). A flaky test is deleted, never skipped; when it is the only check of a business
  flow, it is replaced by a fast deterministic one (#1003); no note excuses a skip, and only a
  `skipIf` for a platform, with the reason in a comment, passes (#169). A test over 5 s, a test
  file over 60 s or an e2e journey over 90 s on CI is too slow: make it faster, or delete it. CI's
  `scripts/slow-tests.ts` fails a PR on the first two, from its run's JUnit times, unless
  `slow-tests-allowlist.json` names the test with the issue that cuts it.
- Tests touch nothing real. The preload replaces `claude` on the PATH with a sentinel and
  `HOME` with a temporary folder, so nothing reads or writes the real `~/.claude`. Other CLIs
  (`gh`, `az`, `ssh`, check commands) are fakes on the test PATH, with a `.cmd` version on
  Windows. No network, and services (`systemctl`, `schtasks`) go through an injected context. To
  look up executables, use `whichOnPath` (`apps/daemon/src/kernel/which.ts`), never `Bun.which(name)`
  without options.
- Never read credentials, tokens, `~/.claude/.credentials.json`, SSH keys or shell history, not
  even in a test or a proof of concept (`.claude/settings.json` denies the obvious paths).
- Delivery is GitHub Flow (#260, #271): one PR per branch to `main`. A session pushes its own
  branch, opens its PR (`bun run pr -- open <branch>`, with `--refs <n>` for a slice of an issue so
  it does not close it, #839, titled after the first commit, #909) and turns on auto-merge
  (`bun run pr -- auto <n>`; it waits for no OpenCode review since its retirement, #1697): GitHub
  merges it with a merge commit once its required checks are green on its HEAD, even behind `main`
  (#305: the ruleset is not strict; `main`'s push CI checks the result). Only a PR that conflicts
  with `main` waits: merge `main` into it. A stacked PR gets auto-merge once its parent is in `main`
  (`pr auto` retargets it). A session keeps at most 2 branches open (pushed, not merged). A release
  is a tag on a green `main`.
- Before opening a PR, run Claude Code's built-in `/code-review` and `/security-review` skills on the
  branch, each inside a subagent (the Agent tool: a fork or `general-purpose`) that returns only its
  findings, so the skill text never enters your own context; fix what they find (user, 2026-11-10,
  #1670, #1973). `/code-review` runs at its default level, never `max` or `ultra` unless asked. The
  `security-reviewer` agent and its trailer still apply. Record both runs in an empty commit with the
  trailers `Code-Review: <sha> <summary>` and `Security-Review: <sha> <summary>`: `pr open` refuses a head without it (#1707).
- Only the coordinator pushes `main`, `rc/*` and tags, merges by hand (`bun run pr -- merge <n>`)
  and publishes releases. The guard hook refuses the rest: pushes of main, `rc/*`, tags,
  `--tags`/`--all`/`--mirror`, a bare `--force`, a `--force-with-lease` to any branch but the one
  checked out, and a session's `bun run pr -- merge|tag`, `gh pr merge` or REST merge (the
  coordinator's session runs with `FLIGHTDECK_COORDINATOR=1`).

- Full suite, `demo:shots`, `e2e`, the smokes and the builds run only through
  `bun run slot --`, never bare (the guard hook refuses them otherwise): two of them at once overload the machine and make the
  timing-sensitive tests flaky. Area tests, typecheck and lint do not need the slot.
  `bun run typecheck` and `bun run lint` go through the light lane by themselves
  (`scripts/lane.ts`): at most two run at once on the machine, one when less than 5 GB is
  available (one tsc run takes up to 1.5 GB), and the next waits for a place.
  `FLIGHTDECK_LANE_PLACES` overrides the count.

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
  Start its session there (`cd ../flightdeck-faseN && claude`, or `/cd` into it): the worktree's
  own rules and hooks load only for a session whose folder is that worktree.
  Each phase also updates both manuals: the chapter in `docs/manual/en/` and its twin in
  `docs/manual/pt-BR/`.
- Divergences from the spec and decisions go to a file of their own under `docs/decisions/`, named
  `<yyyy-mm-dd>-<topic>.md` with a first line `# <title> (issue #N)` or `(phase N)` (#304). Never
  add to `docs/DECISIONS.md`: a frozen index of the older records, a test fails when it changes.

## Structure: domain modules, single responsibility (#1589)

A priority (user, 2026-11-09). Sources and reasons: `docs/decisions/2026-11-09-domain-modules.md`.
New code and every move follow these rules; older code moves toward them one structural PR at a time.

- Folders by domain, not by layer: the tree names the product (`board/`, `sessions/`, `hosts/`,
  `review/`), not the framework (`server/`, `lib/`, `utils/`). Names come from `docs/GLOSSARY.md`.
- One public entry per domain (`index.ts`); a desktop feature also has `ui.ts` for its components,
  so state and wiring never reach the screens: its `index.ts` re-exports no component (rule
  `desktop-entry-exports-no-component`, #2451). Another domain imports only those, never a deep
  file. No import cycles between domains; dependencies point toward the more stable, more abstract code.
- Cut by reason to change (Parnas, SRP): a module answers to one actor and hides one decision that
  may change. Things that change together live together; nothing depends on what it does not use.
- Deep modules (Ousterhout): a small interface over real work. No pass-through files, no module
  split so fine that a change touches five of them.
- Ports and adapters: domain rules are pure (no SQLite, socket, spawn, filesystem, Tauri or clock
  calls); I/O lives in the domain's adapters, and `main.ts` only wires domains together.
- Desktop by feature: `features/<domain>/` holds its components, store slice and hooks; shared
  primitives stay in `shared/`. The app store is one slice per domain, not one file.
- Dictionaries per domain as they are split: `i18n/<lang>/<domain>.ts`, both languages in the same PR.
- Size is a signal: a source file past about 800 lines likely holds two responsibilities; one under
  about 50 lines that only forwards calls is likely a shallow module. Split or merge accordingly.
- Fitness functions (#1610): `bun run arch` prints one table of the ratchets (dependency-cruiser, source size,
  flat tests, knip dead code, raw JSON.parse, test shape: the integration and e2e share of the test files), baseline against today; a figure above its baseline fails, so baselines only go down.
- Moves are strangler-fig steps (Fowler, Feathers), like the board.ts split (#1523): one move per
  PR, structure only, behavior unchanged, tests green before and after. Never mix a move with a
  behavior change in one commit (Beck: make the change easy, then make the easy change).

## Gotchas

- With `CLAUDECODE` set, bun test hides the `(pass)` lines. To see the list, use
  `env -u CLAUDECODE bun --config=bunfig.area.toml test <file>`.
- In Git Bash, the `/TN` in `schtasks /TN ...` gets rewritten as a path. Use PowerShell.
- In stdin mode, Biome's exit code does not reflect the diagnostics.

## More

- Subagent delegation (what goes to Haiku or Sonnet, how to brief it): [docs/subagent-delegation.md](docs/subagent-delegation.md).
