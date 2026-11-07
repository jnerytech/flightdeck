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
  divergence; `DECISIONS.md` holds the older ones, frozen), `TDD.md` (the testing rules),
  `GLOSSARY.md`, `manual/` (en, pt-BR).
- `.claude/`: the shared Claude Code setup. Skills `tdd-area` (one TDD area) and `new-phase`
  (open or close a phase); agents `spec-verifier` (checks a phase against its spec),
  `tauri-rust-reviewer` (for changes in `src-tauri`), `test-quality-reviewer` (tests that cannot
  fail) and `security-reviewer` (spawns, paths, secrets, pairing), all read-only; hooks that block wide `git add`, edits of
  generated files, test edits that add `.only`/`test.todo`/`toMatchSnapshot` or an unnoted skip, commits
  that break `type(scope): text` or the TDD order, heavy runs outside the slot, a worker's full
  coverage run (#674), and a push that would cancel the branch's PR run while it is still green (#741:
  younger than 20 minutes with no failed job; `FLIGHTDECK_PUSH_NOW="<reason>"` in front of the push
  lets it through), and that run
  Biome after each edit, in the main checkout and its worktrees. The hook rules live in `scripts/lib/claude-hooks.ts`;
  `bun run harness:stats` shows how often each rule blocked and how long the hooks took, and lists
  each push-wait override with its reason and the cancelled run's age (#741). Rules per
  area live in `.claude/rules/` (ui, protocol, daemon, tests, scripts) and load when a matching file
  is touched; a SessionStart hook states the branch, the tested scopes and the slot, and after a
  compact reminds that those rules come back only with a matching file. Personal settings go to
  `.claude/settings.local.json` (ignored).

## Commands

- Test a single file: `bun --config=bunfig.area.toml test <file>`. A plain `bun test <file>`
  exits with 1 even when it passes, because of the global coverage threshold.
- Full suite (with the 100% line and function threshold): `bun run slot -- bun run test`.
- The heavy commands go through the slot: `bun run slot -- <command...>` (for example
  `bun run slot -- bun run test`). It is one exclusive lock for the whole machine, with a queue;
  waiters take it first come, first served. `bun run slot -- --status` shows the holder (with a
  warning past `--max-age`, 90 min by default) and each waiter in queue order with its age, folder
  and an `ORPHAN` mark. A waiter whose shell is gone gives up (`FLIGHTDECK_SLOT_DETACHED=1` keeps a
  launch detached on purpose in the queue), and `--reap` (the coordinator) stops orphan waiters by
  process group, never the holder. `--nice` lowers the command's priority, `--cancel` stops your own waiters and run
  (matched by `FLIGHTDECK_SLOT_LABEL`, never another session's), so nobody needs `pkill -f`.
  `--priority` (for the maintainer's full gate) also lowers the other bun test processes of the
  user while it runs. What the slot and the light lane start, and every test run (the preload),
  runs at `oom_score_adj` 1000 on Linux, so the kernel kills a leaking test before any session.
- Tests for what you changed: `bun run test:related [--base <ref>] [--fast]`. It takes the files
  changed since the merge-base with `main` (or `<ref>`), picks the changed test files plus every
  test that imports a changed file (transitively; with `--fast`, only directly) or names it as a
  path, prints each with the reason, and runs them in one call (through the slot above 60 files). The run also collects coverage and fails unless every
  changed source file is at 100% lines and functions, listing the uncovered `file:line` and the
  uncalled functions (`bunfig.related.toml`; the same exclusions as the full suite). A file that a
  changed test newly imports is held to 100% too, with the tests that import it directly, since
  loading it puts it in the full suite's gate even outside `scripts/lib` (#762; direct imports only,
  not what that file loads in turn). `--pr` (#309) is what a PR's
  CI runs: every unit and component test plus the related tests, with the same changed-file gate, or
  the whole suite when a global file changed or a test went away; `--keep-coverage <dir>` keeps the
  lcov there. A change to `package.json`, a `bunfig` or the preload
  prints a warning: run the full suite then. A worker session runs it with `--fast` or `--tier`
  (#674): the guard hook refuses a plain, `--base` or `--pr` run, through the slot or not, since it
  holds the slot 12 to 25 minutes for what the PR's CI does anyway. `FLIGHTDECK_SLOT_HEAVY="<reason>"`
  as an env prefix of the run itself lets a real need through (#687: anywhere else in the command it
  does not count, and a reason has at least 8 characters); `harness:stats` counts the refusals and
  the overrides.
- Tests by tier (#261, computed from each test's content): `unit`, `component` (the DOM), `integration`
  (processes, a server, real git) and `e2e` (journeys, smokes). On the Pi, a session runs
  `bun run test:related -- --fast --tier unit,component` (a fifth of the suite's time, no coverage
  gate). A PR's CI runs `--pr`: every unit and component test plus the related tests of the other
  tiers, with 100% on the changed files. A push to main runs the same, from the commit before it
  (#444). The e2e journeys run when the change touches what they read (the screens, the journeys,
  the demo, the daemon). Windows is not part of a PR's or a push's run (#534): the person tests it
  by hand. The schedule (every 3 hours) and a run by hand run the whole suite with the whole-repo
  100% gate, on Linux as six jobs (#296): three shards, each once with Bun's coverage (the lines and
  SonarCloud's lcov) and once with istanbul's function maps, merged by `scripts/shard-gate.ts merge`,
  which fails closed when a shard is missing or failed. Windows is included as a signal that gates
  nothing (`test:shards`, 30 s per test there);
  `pr tag` tags only a commit with such a full green run. `bun run test:tiers` prints the counts.
- Which function a file is missing: `bun run coverage:funcs <file.ts>... [--tests <test.ts>...]` runs
  the tests that reach the files (or the ones named after --tests) and lists the functions no test
  called as `file:line`. Bun's coverage only counts them. It instruments in memory, never the sources.
  A worker session runs it over at most 20 test files (#674): more is refused, by the guard hook
  for `--tests` and by the script for the tests it picks, with the same override. The script refuses
  for every session, the coordinator too (#725): its environment is the command's, which a worker can set.
- Sonar: SonarCloud Code Analysis on the PR is the only Sonar check (#283); there is no local copy
  to run before a push. `// NOSONAR: <reason>` on the flagged line suppresses a reviewed false
  positive there. `sonar-project.properties` keeps SonarCloud's coverage on exactly the files of
  the 100% gate (`sonar-coverage.test.ts`).
- Before hand-off from a session: `bun run handoff:check` runs `typecheck`, `lint`, `tdd:audit`
  and `test:related` in order, then reads the required checks of HEAD on GitHub (`ci=`: push the
  branch first; `--base <ref>` for a branch stacked on another) and the security gate (`security=`,
  #273: a change that spawns or kills, deletes, handles a secret or a permission, or touches the
  vault or pairing needs the `security-reviewer` agent's verdict committed after it, as a
  `Security-Reviewed: <summary>` trailer), and prints a `HANDOFF <branch> <head> ...` stamp line; paste it in the hand-off message. The receiver runs
  `bun run handoff:check -- --verify` in the worktree (refused when stale or not all 0, `ci` too). The full suite (`bun run slot -- bun run test`) runs at the
  orchestrator's version gate and in CI, not in every session.
- Format: `bun run format`. Smokes: `bun run slot -- bun run smoke:<name>` (list in
  `package.json`; never `smoke:real` unless asked).
- Audit: `bun run tdd:audit` audits from the merge-base with `main` (or from the last tag on
  `main`), the same as `-- --since auto`; `-- --since <tag or commit>` picks the start. CI runs it.
- Screens: `bun run demo` (two fake hosts and the web entry at http://localhost:1420; `DEMO_PORT` picks
  another, and the e2e run and `demo:shots` take a free one, so an open demo never blocks them;
  `DEMO_BUILD=1` serves a production build through `vite preview`, as CI's e2e and prints do, #444),
  `bun run slot -- bun run demo:shots` (prints in both themes and languages, plus axe),
  `bun run slot -- bun run e2e` (the
  journeys, in both languages, with `@playwright/test`: `E2E_ONLY=a,b` picks journeys, and
  `bun run slot -- bun run e2e -- --repeat-each 5` hunts flakes; the HTML report is in `playwright-report/`).
- Builds: `bun run slot -- bun run build:daemon`, `bun run slot -- bun run build:desktop`.
  `cargo check` (in `apps/desktop/src-tauri`) requires the desktop build first.

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
  weakening an assertion. The one exception: a flaky test that hurts CI may be skipped
  (`test.skip`, `it.skip`, `describe.skip`, or `test.skipIf(notLinux)`) with
  `// unstable: #<issue> <reason>` on its line or the line above, naming the open issue of its fix.
  There are at most 10, and CI fails once that issue is closed, or on the PR that closes it while
  the skip is still in (#552), so the skip comes out with the fix (#494, docs/TDD.md).
- Tests touch nothing real. The preload replaces `claude` on the PATH with a sentinel and
  `HOME` with a temporary folder, so nothing reads or writes the real `~/.claude`. Other CLIs
  (`gh`, `az`, `ssh`, check commands) are fakes on the test PATH, with a `.cmd` version on
  Windows. No network, and services (`systemctl`, `schtasks`) go through an injected context. To
  look up executables, use `whichOnPath` (`apps/daemon/src/which.ts`), never `Bun.which(name)`
  without options.
- Never read credentials, tokens, `~/.claude/.credentials.json`, SSH keys or shell history, not
  even in a test or a proof of concept (`.claude/settings.json` denies the obvious paths).
- Delivery is GitHub Flow (#260, #271): one PR per branch to `main`. A session pushes its own
  branch, opens its PR (`bun run pr -- open <branch>`) and turns on auto-merge
  (`bun run pr -- auto <n>`): GitHub merges it with a merge commit once its required checks are
  green on its HEAD, even when it is behind `main` (#305: the ruleset is not strict; `main`'s push
  CI checks the result). Only a PR that conflicts with `main` waits: merge `main` into it.
  A stacked PR gets auto-merge once its parent is in
  `main` (`pr auto` retargets it). A session keeps at most 2 branches open (pushed and not merged
  yet): it finishes one before it starts a third. A release is a tag on a green `main`.
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
  Each phase also updates both manuals (`docs/manual/en.md` and `pt-BR.md`).
- Divergences from the spec and decisions go to a file of their own under `docs/decisions/`, named
  `<yyyy-mm-dd>-<topic>.md` with a first line `# <title> (issue #N)` or `(phase N)` (#304). Never
  append to `docs/DECISIONS.md`: it is frozen, and a test fails when it changes.

## Gotchas

- With `CLAUDECODE` set, bun test hides the `(pass)` lines. To see the list, use
  `env -u CLAUDECODE bun --config=bunfig.area.toml test <file>`.
- In Git Bash, the `/TN` in `schtasks /TN ...` gets rewritten as a path. Use PowerShell.
- In stdin mode, Biome's exit code does not reflect the diagnostics.

# Subagent delegation (token-saving focus)

Goal: spend fewer tokens on the main model. The general rule is to **delegate reading and searching to Haiku** and **do everything else directly in the main session**.

## Which subagent to use

| Situation | What to do | Model |
|---|---|---|
| Find files, understand how something works, map where something is used | `Explore` | **always `model: haiku`** |
| Context gathering during plan mode | `Explore` (not `Plan`) | **`model: haiku`** |
| Architectural analysis: dependencies between modules, impact of a large refactor, comparing approaches | `Plan` | **`model: sonnet`** |
| Small or medium edit, with the files already identified | **Do it directly**, no subagent | — |
| Mechanical, repetitive task across many files (renaming, applying a pattern, fixing tests) | `general-purpose` | **`model: sonnet`** |
| Long, complex task that would fill up the main context | `general-purpose` | default |

Rules:
- Every `Explore` call must pass `model: haiku` explicitly.
- Use `general-purpose` sparingly: it starts cold, rereads files and is expensive. Only use it when sparing the main context is worth that cost.
- **Do not delegate** when the file path is already known or a single `Read`/`Grep` is enough. Do it directly.
- Do not reread in the main session files that `Explore` already summarized, except for the sections you are about to edit.
- Independent search tasks: launch several `Explore` calls in parallel, in a single message.

## Plan mode

Rework is the biggest waste of tokens. Therefore:

- For every medium or large task (more than one file, a behavior change, a non-obvious approach), enter plan mode and present the plan before editing anything.
- Exception: a session that works autonomously (it receives its tasks by message from an orchestrator or a scheduled prompt, and the person is not at the terminal) does not enter plan mode, because leaving it needs the person's approval and the session would sit waiting. It writes the same short plan (files, approach, risks, validation) as a comment on the issue or in the PR body, and goes on.
- Inside plan mode, context gathering goes to `Explore` with `model: haiku`, not to `Plan`.
- Use `Plan` with `model: sonnet` only when the plan depends on real architectural analysis. Never use it just to locate files.
- The plan must list: files to change, the chosen approach (and why, if there was an alternative), risks, and how to validate.
- Small, obvious tasks do not need plan mode.

## Explore thoroughness level

Choose the level and state it in the prompt. Start with the lowest level that does the job:

- **quick** — targeted lookup with a clear target: "where is X defined", "which file configures Y".
- **medium** — understand a flow or module: "how does authentication work", "who calls this service".
- **very thorough** — broad sweep: impact of a change across the whole codebase, varied naming conventions, code spread across several projects or layers.

If a `quick` search comes back inconclusive, move up to `medium` instead of repeating the same search.

## How to write the subagent prompt

`Explore` and `Plan` **do not read this CLAUDE.md** or the session's git status. Everything they need to know must be in the prompt. Use this structure:

```
Goal: <what I need to find out and why — which decision this will support>
Thoroughness: <quick | medium | very thorough>
Project context: <stack, relevant folder structure, naming conventions>
Where to look: <likely folders/files>
Ignore: <legacy, generated, vendor, tests — whatever is irrelevant>
Already known: <what has already been found, to avoid repeating it>
Response format: list of path:line with one sentence each, at most 15 lines, no pasted code
```

The short response format is mandatory: it is what keeps the main context small.

For `general-purpose`, which does read this file, focus on the goal, the definition of done and the constraints ("do not change the public API", "run module X's tests at the end"), and ask for a short report: what changed and what is still pending.

## After the subagent returns

- Open only the cited sections you are going to edit or that back a critical decision.
- Do not paste the subagent's output to me; summarize what matters for the decision.
