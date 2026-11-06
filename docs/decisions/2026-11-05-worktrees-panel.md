# Worktrees panel: size, suggestions and safe removal (issue #152)

- **What is listed.** The worktrees `git worktree list` reports directly inside `<repo>/.flightdeck/worktrees`, as real folders (a link is
  skipped, and so is anything whose real path leaves that folder). The main checkout and worktrees elsewhere are never listed, so never
  removable. Arena variants count as cards (the daemon asks the board for every card with a worktree, not only the visible ones).
- **Facts.** Dirty = `git status --porcelain` is not empty, or fails (when git cannot say, nothing is removed). "Unpushed" = commits
  reachable from HEAD but from no remote branch and not from the base branch (`rev-list --count HEAD --not --remotes <base>`), so a
  merged or pushed branch has none, and a branch with work that exists only here is counted. No base branch found: kept as
  `unknown_base`. Idle = the newest of the last commit, the card's last update and the folder's mtime.
- **Suggested** = no blocker, idle over 7 days, and the card is Done or its PR merged, or there is no card.
- **Diverges from the issue on purpose:** the panel never removes a dirty, unpushed or live worktree, not even after a second
  confirmation. The coordinator's brief asked for "kept, because…"; the way to throw such work away is the card's Discard, which already
  asks. This keeps the bulk path free of data loss. Dismissing ("keep") with a fingerprint and the notification-center notice for low disk
  were not built; the panel warns on the host page when a disk has under 10% free.
- **Removal looks again.** `worktree.remove` re-reads the project's worktrees and refuses a path that is not one of them, then re-checks
  its blockers, runs `git worktree remove` without `--force`, then deletes the branch only if it is still at the checked commit (`update-ref -d`, see the safety review below) and frees the card
  (`worktree_path` NULL, the watchers told). One failure does not stop the rest; the result lists what was removed (with bytes freed) and
  what was kept and why.
- **Size.** `du -sk` with a 15 s deadline per folder, run in parallel; a timeout, a failure or a host without `du` (Windows) is
  `unknown`. The list is read on open and on "Scan again", not polled. Windows 8.3 and long-path cases were not tested; paths are
  compared with the daemon's `samePath`.
- **Not built:** the panel on each Project page (the host page has it), the PR-open-with-Watch rule, and the "Freed" total in the
  notification center.

### Worktrees panel: safety review (OpenCode, issue #152)

The first version could delete work. What changed, each with a test that fails without it (`worktrees-seguranca.test.ts`):

- **The base must be a branch.** It is resolved to a hash through `refs/heads/<base>` or `refs/remotes/<base>` only; a tag, `HEAD`, `@`,
  `HEAD~1`, an option (`--help`) or a missing name is `unknown_base`, as is a worktree that is on the base branch itself ("not on the
  base" would be empty by construction). Unpushed = `rev-list --count HEAD --not --remotes <hash>`. "Pushed" still means a remote-tracking
  ref has it, with no fetch: a branch force-pushed away upstream and not pruned counts as pushed (a small, accepted gap); a
  squash-merged and deleted branch counts as unpushed, so it is kept.
- **When git cannot say, nothing is removed.** A failed or non-numeric `rev-list`, a failed `log`, a branch tip that cannot be read, or a
  `busy` check that throws is the blocker `unknown_state`, never 0. A git command has a 60 s deadline in the wiring; a timeout is a
  failure.
- **The branch goes only if it is still what was checked.** `git update-ref -d refs/heads/<b> <hash>` deletes only an unmoved ref; a late
  commit keeps the branch and the result says `branchKept`. Only `fd/*` branches are ever deleted; a worktree on another branch (or a
  detached one) is `other_branch` and kept whole. The card loses its worktree path only if it still has the removed one, and its branch
  only when the ref was deleted (`releaseWorktree(id, path, clearBranch)`).
- **A lock between the last look and the removal.** `FolderLocks` (shared by the session manager, the terminal manager, the board and the
  panel) holds the folder; `SessionManager.create/createResumed`, `TerminalManager.open` and `Board.launch` refuse a held folder
  (`invalid_state`, reason `folder_removing`) right after their last await. The size (`du`) is read first, then the worktree is looked at
  once more under the lock; a second removal of the same folder is refused as `running`. More things block: an open terminal, an external
  Claude session, a card the board runs or queues (`Board.isActive`). One item that throws is `failed`, the others go on.
- **Files git does not show.** Status is asked with `--untracked-files=all` and `-c status.showUntrackedFiles=all` whatever the user's
  config says, and with `--ignored=matching`: an ignored file that is not rebuildable (not `node_modules`, `dist`, `build`, `target`,
  caches, the local `.claude/settings.local.json`, and not a byte-identical copy of the project's own file, which is what
  `.worktreeinclude` puts there) is `ignored_files`.
- **`worktree.remove` needs `confirm: true`** (like discard and delete). In the app the selection is only the rows on screen (Select all
  under a filter, a row hidden after being ticked), the confirmation shows branch, card and column, the button is disabled while the
  request runs, and a branch kept or a host that did not answer is said.
- **Not done:** `git worktree list -z` (a path with a newline is skipped today because its `lstat` fails), and scanning once per project
  instead of once per item.

### Worktrees panel: second safety review (OpenCode re-review, issue #152)

- **N1: edits git hides.** `assume-unchanged` and `skip-worktree` keep an edited tracked file out of `git status`, and `git worktree remove`
  (without `--force`) then deletes it. `scan` also reads `git ls-files -v -z`; any lowercase tag or `S` is the blocker `hidden_changes`, and a
  failing `ls-files` is `unknown_state`. A sparse checkout's files outside the cone carry `S`, so such a worktree is kept too (conservative).
- **N2 (the coordinator's decision): rebuildable is a folder at the root.** Only `node_modules`, `dist`, `build`, `target`, `coverage`,
  `.cache`, `.next` and `out`, listed as a folder directly under the worktree, are shrugged at. The same name deeper, a file with that name,
  `.tsbuildinfo` and `.DS_Store` are not. An ignored file whose name looks like a credential (`.env*`, `*.pem`, `*.key`, `id_rsa`,
  anything with credential, secret, token, password or api key in it) at any depth always blocks, even as an unedited copy of the
  project's. An unedited copy of the project's own ignored file (what `.worktreeinclude` puts there) and Flightdeck's
  `.claude/settings.local.json` are the only other exceptions. The confirmation says that rebuildable folders go with the worktree. A
  credential file inside a rebuildable folder is not seen (the folder is listed whole).
- **N3** `SessionManager.resume` refuses a folder being removed, like `create` and `createResumed`. **N6** the remove has a 10 minute
  deadline (a kill halfway leaves half a folder); the other git commands keep 60 s. **N7** the commits are counted on the branch tip that was
  read, so the count and the commit the branch is deleted against are one snapshot.
- **Tests added for guards the review found removable:** a live session of every state, a queued card, `createResumed`, a second removal of
  the same folder (the lock is a set, not a counter, so that refusal is what keeps the first release from freeing the second),
  an unreadable tip, and `detach` told to keep the branch only when the ref stayed.
- **A project whose folder is gone** no longer fails the whole list: a git that cannot be spawned (its `cwd` does not exist)
  answers like a git that failed (code 127), so that project shows nothing and the others still list.
- **Not done:** N4 (a workflow waiting at a gate, board operations outside a run, a worktree being made have no blocker; processes outside
  Flightdeck cannot be seen), N7's second race (an outside `git checkout --detach` plus a commit after the last look), F8 (case-insensitive
  `samePath` for the worktrees folder), `-z` for the list, and scanning once per project.
