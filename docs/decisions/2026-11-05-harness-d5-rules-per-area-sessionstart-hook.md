# Harness D5: rules per area and the SessionStart hook (issue #169)

- **Rules close to the code are a bonus, not the guard.** A session started in the main checkout
  that edits a sibling worktree loads neither `.claude/rules` nor a nested CLAUDE.md (proof of
  concept in the proposal), and after `/compact` a path-scoped rule is gone until a matching file
  is touched again (review S1-2). So every non-negotiable stays in the root CLAUDE.md, which is
  always loaded; the rules restate the area's own conventions where the code is.
- **Five rules, quoted list globs.** `ui` (apps/desktop/src), `protocol`, `daemon`, `tests`
  (`**/test/**`, `**/*.test.ts`, `**/*.test.tsx`) and `scripts`. An unquoted `**` is a YAML alias,
  and a frontmatter that does not parse makes Claude Code load the rule everywhere (review S1-3);
  `harness-config.test.ts` parses each frontmatter and checks that every glob matches a tracked
  file. Checked live with `claude -p` in the worktree and an `InstructionsLoaded` hook: a
  `scripts/test` file loads `tests` and `scripts`, a daemon file loads `daemon`, nothing else.
- **No per-package CLAUDE.md.** One mechanism, in one folder, with globs that cut across
  packages (`tests` covers three).
- **The SessionStart hook** (`startup|resume|compact`) adds a few lines: the branch, the commits
  past main, the scopes with a `test(...)` commit so far, the slot's holder (a lock of a dead
  process counts as free), and after a compact the note about the rules. On the main checkout it
  points dev work to a worktree. About 0.2 to 0.3 s; any error adds nothing.
- **Sessions start in their worktree** (`cd ../flightdeck-x && claude`, or `/cd`), not with
  `claude -w`, which creates its own worktree layout (review S1-4).
- **Not done, on purpose.** The TDD.md translation (an active file that open branches still
  touch) and the `lib-purity` ratchet (it would baseline the ratchets themselves, which scan files
  by design; review S2-12). Functional core, imperative shell is a paragraph in TDD.md and a line
  in the `scripts` and `daemon` rules.
