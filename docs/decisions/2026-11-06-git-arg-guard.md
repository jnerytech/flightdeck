# A branch from a project's settings never reaches git as an option (issue #345)

- **The problem:** a project's `baseBranch` was only `z.string().min(1)`, and the daemon put it in
  git's arguments as a revision in about fifteen places (`diff`, `rev-list`, `rebase`, `merge-tree`,
  `worktree add`, `fetch`, `ls-tree`, `show`, `cat-file`). A paired client that set it to
  `--output=/some/path` made `git diff` write a file; `--exec=<command>` made `git rebase` run a
  command. Found by the security-reviewer while reviewing #329; it was already on main.
- **Three layers, each enough for the one before it to fail:**
  1. **The protocol** (`packages/protocol/src/git-ref.ts`): `isBranchName` follows
     `git check-ref-format --branch` (no leading `-`, no `..`, no control characters or
     `~ ^ : ? * [ \`, no `@{`, no component starting with `.` or ending with `.lock`, no `HEAD`),
     and stricter than git in one thing: no leading `@`, because `az` reads an argument `@file` as
     a file (a PR to an Azure remote takes the base as `--target-branch <base>`),
     and `ProjectFields.baseBranch` uses it, so `project.add` and `project.update` refuse a bad
     name before the daemon sees it. A test compares 45 names with the answer of the real
     `git check-ref-format` (`@` and `@{-n}` are left out: they are git's shorthands for the
     current branch, not names).
  2. **The daemon, when a project is set** (`board/ref-arg.ts`): `addProject` and `updateProject`
     check the base again (`assertBranchName`), so a caller that is not the protocol (the CLI, a
     test) cannot store one either. The refusal is `branch_invalid`, in both dictionaries.
  3. **The daemon, when git runs** (`refArg`): every helper that takes a base (and a branch) checks
     that it is not empty and does not start with `-` before it becomes an argument, so a base
     stored by an older daemon is a clear refusal and not an option. Only that is checked there, so
     a revision git accepts (`HEAD`, `origin/main`) still works. The one place a base is also a
     refspec, `freshBase` (`git fetch origin <base>`), checks the whole name (`+x:refs/heads/y`
     would write a ref), except for the `HEAD` of a detached checkout.
- **`--end-of-options`** is put before the revision where git takes it and prints nothing extra:
  `diff`, `rev-list`, `rebase`, `fetch`, `merge-tree`, `ls-tree`, `show`. Not on `rev-parse` (it
  echoes the word back as output) nor on `worktree add` (the options after it would read as
  positional).
- **The ratchet** (`scripts/lib/git-args.ts`, `git-args-ratchet.test.ts`): reads `apps/daemon/src`
  and fails on a `git(...)` or `gitLimited(...)` call (also `this.git(`, `deps.git(`) with an argument
  built from a name like `base`, `branch`, `source`, `ref`, `rev`, `against`, `upstream`,
  `targetBranch` or `startPoint` (bare, in a ternary, a cast or a concatenation, at the start of a
  template string, an item of an array, or a spread of a variable) that has no `refArg(`, no
  `--end-of-options` or `--` before it and no `// git-arg: <why>` on its line or the line above. A
  call it cannot read is an error. Comments, strings and template text are masked first, so a
  `https://` or a `*/` in them does not hide a call. It found ten more calls (daemon-made `fd/...` branch names, and a base
  used after its guard) and they are guarded too.
- **Looked at and left as they are:** worktree paths (made by the daemon under the repository,
  absolute), remote names (`origin` is a constant), the PR's head branch in `watch/fix.ts` (always
  after `origin/` or `refs/heads/`), the clone `url` (after `--`), `checkpoints` refs (made by the
  daemon). The `-C <dir>` paths come from `resolveAllowedCwd`.
- **Known limits:** the ratchet goes by names, not by types: a base held in a variable called
  something else is not seen (a branded `Rev` type that only `refArg` returns would close that, and
  is a bigger change). It does not read other spawns of git (`Bun.spawn(["git", ...])`,
  `runCommand`, a differently named wrapper); `snippets/use.ts` and `project-find.ts` do that with no
  protocol value. A base stored before this change is not migrated: it fails with `branch_invalid`
  when used, and `project.update` fixes it. `refArg` does not check the rest of the name, because git does: it is the
  leading dash that makes an option.
