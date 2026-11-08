# The harness setup is committed on a new branch through a temporary index (issue #75)

## Context

After the harness set-up applies (#988, #995), the person may want the change on a branch, ready
for a PR. Their checkout is theirs: its current branch, its index and its other changes must not
move. The project's repository is also not trusted code: its `.git/config` and hooks can run
commands. The design is on #75 (C1); this record covers slice C1a, the daemon.

## Decision

- **The command.** `project.harness.commit {path, digests, confirm}`.
  - `digests` are the ones `project.harness.apply` now returns (`HarnessApplied.digests`): the
    sha256 of each file as it was written.
  - The daemon reads each file again through `readInside` (no link, one name, a handle checked
    against the walk). It refuses with `harness_commit_stale` unless every file is as apply wrote
    it.
  - It keeps no state of its own and takes no content from the app.
- **Only the setup's files.** `.claude/settings.json`, `CLAUDE.md`, `.claude/agents/reviewer.md` and
  `.claude/skills/tdd/SKILL.md`. Any other path, a `.env` included, is stale.
- **Ignored files.** A setup file the repository ignores (`git check-ignore`), such as local-only
  settings, is refused with `harness_commit_ignored`: Flightdeck never commits it for the person.
- **Committed whole.** If the person changed `settings.json` before the apply, that change is in the
  commit too. The app's confirm step says so (C1b).
- **How.** A temporary `GIT_INDEX_FILE`:
  - `read-tree HEAD`;
  - one `hash-object -w --no-filters --stdin` per file, from the bytes checked (no clean filter of
    the repository runs, since one can run a command), then `update-index --cacheinfo`;
  - `write-tree` and `commit-tree -p HEAD`;
  - `update-ref refs/heads/<branch> <commit> <zeros>`, which makes the branch only if no branch has
    that name. A name already there is `harness_commit_branch_taken` (checked with `show-ref`
    first). Any other failure of git (a branch named like a folder of this one, a lock) is
    `harness_commit_git`.
  - A file HEAD has as executable keeps its mode, and every other file is a plain file. In a
    project that is a folder of a larger repository, the files land at their place in it
    (`--show-prefix`).
  - The person's branch, index and working tree stay as they are, and the files stay changed on
    their current branch.
- **Git runs disarmed.** Every call goes through `teleport/git.ts`'s `SAFE` options: `core.hooksPath`
  pointing at nothing, no fsmonitor, no signature. A `reference-transaction` hook of the repository
  does not run (tested).
- **The branch.** `flightdeck/claude-setup-<yyyymmdd-hhmm>` (UTC), named by the host through
  `refArg`. The app cannot name it.
- **Identity.** The repository's `user.name` and `user.email`: the person will push this branch.
  Without them the commit refuses with `harness_commit_identity`; it never uses a made-up identity.
- **Secrets.** The host's scanner, with the vault's values, checks each file first: `env` values can
  sit in `settings.json`, and a commit is one push from public. A finding refuses with
  `harness_commit_secret` and names the file, never the value.
- **A repository with no commit** refuses with `harness_commit_no_head`.
- **The commit message** is a fixed English line ("Set up Claude Code", with the files). It is a git
  artefact, like the code and the commit messages of the repository, not app text.
- **No signing.** `commit-tree --no-gpg-sign`, on top of `SAFE`'s disarmed hooks and fsmonitor.
- **Guards.** The feature `harnessCommit`, a near connection only, and `confirm: true` (else
  `harness_confirm`).

## Alternatives discarded

- **`git switch -c`, `add`, `commit` in the checkout.** It moves the person's branch, carries their
  other changes, and runs the repository's hooks.
- **Apply into a new worktree on a new branch.** It changes what apply writes, and where.
- **Commit only Flightdeck's additions to `settings.json`.** It needs a merge against HEAD's
  version, and breaks when HEAD has none.

## Consequences

- C1b adds the step to the set-up dialog: after a successful apply, "Commit on a new branch", with
  the branch name, the files, and the note that they are committed whole.
- The person pushes the branch themselves; Flightdeck does not push.
