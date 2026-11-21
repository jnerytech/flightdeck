# Writing worktrees, issue cards and PR comment sends from a shell (issue #3702)

Slice 2 of #3702 (slice 1: `2026-11-21-cli-worktree-issues-read.md`): `worktree remove`, `issues create-card` and
`card pr-comments-send`, over `worktree.remove`, `issues.createCard` and `pr.comments.send`.

- `worktree remove` deletes folders, so it is rated high in a session's shell (`worktree-risk.ts`): a typed `--confirm`
  is not the person. The `worktree` and `issues` nouns join `VERB_NOUNS`; `worktree list` and every `issues` verb stay
  ordinary. The guards are the daemon's, the same ones the app uses (a folder with uncommitted work, commits nowhere
  else, a live session or another branch than the card's is kept, and the branch ref goes only when it is unchanged);
  the CLI adds none of its own and never passes a force.
- `worktree remove <project> <path>... --confirm`: without `--confirm` it is refused when the arguments are read, exit 1
  and before any connection, so the missing word is never confused with a missing daemon. Every path comes before the
  first flag; a path after a flag is refused, never dropped. A path must be absolute (the host resolves a relative one
  against its own folder, not the caller's), so a typed `.` is refused. `--confirm` is taken on `worktree remove` only.
- The answer says one line per path, `removed` (with what it freed, `size unknown` when not known, and `branch kept`) or
  `kept` with the reason. A call the daemon answered is exit 0 even when every path was kept: the verb did what the
  daemon decided. `--json` has every key of every entry, `null` for a missing `branchKept` or `detail`.
- A write that gets no answer exits 2 and says what may have happened and what to run before trying again (`worktree
  list`, `card list`, `card show`).
- `card pr-comments-send <card> <comment-id>...` passes chosen comments to the card's session, and a comment may be from
  outside the team. It is rated high in a session's shell, as `review send` is (three reviewers of this slice asked for
  it; the first plan had it ordinary, like `card message`, which carries no third-party text). The verb does not hold a
  comment back: `card pr-comments` flags outside ones. An id typed twice is sent once, and so is a path typed twice to
  `worktree remove`. When the daemon found fewer comments than ids, the line says `sent <n> of <m>` and that the others
  were not among the comments the host last fetched (a newer comment may be missing from its cache, so the PR is not
  blamed). Like `card pr-comments`, it has no `--host`.
- `issues create-card <project> <issue>` makes the Backlog card of the app's "create card" button and prints the card.
  An issue by an outside author prints a line saying the card's auto-approval is suspended.
- The parity file maps the three requests; the baseline drops from 93 to 90.
