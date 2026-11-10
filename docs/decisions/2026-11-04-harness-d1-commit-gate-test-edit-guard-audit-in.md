# Harness D1: the commit gate, the test-edit guard and the audit in CI (issue #169)

- **A Claude Code hook, not a git `commit-msg` hook.** A git hook reads the message reliably, but it
  needs `core.hooksPath`, which is unset; setting it would change all open worktrees and the
  maintainer's commits at once. The PreToolUse guard is already versioned in `.claude/` and runs
  in every checkout. It reads the subject from `-m`, `--message`, a `$(cat <<EOF)` heredoc or
  `-F -` with a heredoc, and finds the commit's directory from each `cd` before it and from
  `git -C`. Anything else (an editor, `-F file`, a quoted directory, git failing) passes, since
  the audit and CI still check it.
- **One base everywhere.** `auditBase` (the merge-base with `origin/main`, then `main`; the last
  release tag, `v*` and never `fase-N`, when `HEAD` is on `main`, pushed or not) is used by the
  hook, by `tdd:audit --since auto` and by CI. Measured before turning CI on: all 21 open branches
  on `origin`, `rc/0363` included, pass it. Without
  `--since`, `tdd:audit` now means `auto`; before, the bare command that CLAUDE.md suggested
  exited 2 with a usage line. In a pull request, CI's merge commit has no conventional type, so the
  audit ignores it.
- **The waiver is a trailer.** A waiver in `scripts/tdd-audit-waivers.json` is keyed by the full
  commit hash, which does not exist before the commit. A `TDD-Waiver: <why>` trailer in the
  message is read by the hook and by `tdd:audit` (`%(trailers:key=TDD-Waiver)`), needs no hash
  and survives a rebase. The hook logs such a commit as `waived`, so `harness:stats` shows how
  often the gate is bypassed. The JSON file keeps the waivers made before.
- **Only the commit's own message is read.** The command is masked (heredoc bodies and quoted
  text blanked, offsets kept): `git commit` and its `-m`, `--message`, `--trailer` and `-F -` are
  found only as words of their own segment, and their values are read from the original at the
  same offsets. A first version read the first `-m` or heredoc anywhere, so a `cat >> f <<EOF`
  before the commit, a `grep -m 1` or a `-m` in the body became the subject, and a quote inside a
  `$(cat <<EOF)` body ended the message early.
- **Not enforced: "the test commit holds only the test".** docs/TDD.md says the stub stays out of
  the test commit. In practice it goes in: 404 of the last 1,500 `test(...)` commits also change a
  file under `apps/*/src`, `packages/*/src`, `scripts/lib` or `src-tauri/src` (for example
  `test(setup-linger)` adds `linger.ts` answering `null`). Blocking it would refuse about one test
  commit in four. The rule stays as written until the maintainer decides between the text and the
  practice.
- **`toMatchSnapshot(` only in the hook.** A new snapshot records its first run, which is the
  stub's output. The audit does not scan for it, because a snapshot that already exists is allowed;
  the hook only refuses one being added.
- **Measured on the Orange Pi** (load around 6): the guard takes 0.04 to 0.1 s on a `git commit` (one
  `rev-parse`, one `merge-base` and one `log`) and 0.01 to 0.03 s on anything else. `biome-on-edit`
  takes about 1.9 s per edit, 1.7 s of it in the type-aware `noFloatingPromises` scan.
- **The decision log** is `<common .git>/flightdeck-hooks.jsonl`: never tracked, one file for the
  main checkout and its worktrees, rotated to `.jsonl.1` past 1 MB. `bun run harness:stats` gives
  the calls, blocks and p50/p95 per hook, and the blocks per rule. The `biome-on-edit` numbers
  decide whether `noFloatingPromises` moves out of the edit hook into the commit gate and CI.
- **Heavy runs outside the slot are refused.** The guard refuses `bun run test|coverage|e2e|
  demo:shots|smoke*|build:daemon|build:desktop` and a bare `bun test` unless the segment is
  `bun run slot -- ...`. A session that runs under a slot holder (`FLIGHTDECK_SLOT_HOLDER` in the
  hook's environment, #141) passes, since its run is already in the slot. The slot's own child is
  started by the slot, not by Claude's Bash tool, so the hook never sees it.
- **Timeouts and fail-open are explicit.** `guard` has `timeout: 10`, `biome-on-edit` 30, both
  `onFailure: "continue"` (without it, a failing shell-form hook blocks on Windows without Git
  Bash), and the gate's git calls stop after 2 s. `onFailure: "block"` is never used: the guard
  imports `scripts/lib`, so a broken edit there would block the edit that repairs it.
- **Only this project's commits.** The gate checks a commit only when its directory belongs to the
  main checkout or one of its worktrees (`checkoutRoot`), so `git commit -m init` in a scratch
  repository passes. The slot guard has no such scope yet: `bun run test` in another project, run
  from a Flightdeck session, is refused (rare; known limit).
- **The instructions follow the guard.** CLAUDE.md, TDD.md, `new-phase`, `spec-verifier` and
  `tauri-rust-reviewer` showed the full suite, the builds, `demo:shots` and `e2e` bare; they now
  show `bun run slot -- <command>`, and `tdd-area`'s green step runs `test:related`. A
  `harness-config` case keeps any instruction from showing a command the guard refuses.
- **Minimum Claude Code version: 2.1.295,** for `onFailure`. Checked on 2.1.318 with `claude -p
  --debug` in the worktree: the settings load without a validation warning and the guard fires.
- **The setup is tested.** `harness-config.test.ts` checks that each hook in `settings.json` runs
  a file that exists, with a timeout and `onFailure`; that the deny list keeps the credentials;
  that the real `guard.ts` blocks with exit 2 and passes bad input; and that every agent and skill
  frontmatter parses as YAML. It found two that did not (`tauri-rust-reviewer`, `new-phase`: an
  unquoted `: ` in the description); Claude Code read them anyway, but a rule's `paths` that does
  not parse is silently dropped, so the check stays.
- **`test:related` sees data files.** A test that names a changed path, or one of its folders, as
  a string literal is related to it (`names .claude/settings.json`). Names with no slash (a root
  file, a top-level folder) do not count, because tests use `.claude`, `docs` or `CLAUDE.md` as
  product words; a `*-baseline.json` also counts by its file name, as the ratchets name it.
- **The hook files stay thin.** `.claude/hooks/*.ts` only read stdin, call `scripts/lib` and exit.
  They are not under coverage; the rules they apply are, at 100%.
