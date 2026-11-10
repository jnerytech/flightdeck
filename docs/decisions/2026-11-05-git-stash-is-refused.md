# `git stash` is refused (issue #234)

- **Why.** `refs/stash` belongs to the repository, not to a worktree: every worktree of the main
  checkout shares one stash list. A `git stash pop` in `rc/0364` applied a stash another session
  had made in its own worktree.
- **The rule.** The guard (`commandViolation`) refuses `git stash` with no subcommand or with any
  but `list` and `show` (push, save, pop, apply, drop, clear, branch), also through `cd` or
  `git -C`. The reason names the ways out: `git diff > /tmp/<name>.patch` and `git apply`, or a WIP
  commit on the branch.
- **In CLAUDE.md, not in `.claude/rules`.** A path-scoped rule loads only when a matching file is
  touched, and a stash is not about any path; the root CLAUDE.md is always loaded.
