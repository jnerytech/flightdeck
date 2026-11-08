# Board stage contracts, slice 3b: the spec artifact (issue #78)

Slice 3a added a validation note. This slice adds the first artifact that lives in a file: the
card's spec. Column templates stay out (they come after #75).

- **The check.** `spec` joins the contract checks. A card lacks it until its worktree has the spec
  file it names: `card.specPath` (relative, to a `.md` file) when set, else `docs/specs/<slug>.md`
  (`specExpectedPath`, shared by the host and the app). No column asks for it by default.
- **What the host reads.** Only two things: that a regular, non-empty file is there, and the first
  ATX heading in the first 8 KiB, kept as plain text of at most 120 characters with no control,
  invisible or direction-changing character. Nothing else leaves: the contents are never returned,
  stored or logged. The card carries `specState` = `{path, found, heading}`.
- **Where it reads.** `readSpec` (`board/spec.ts`) refuses a path that is not plain
  (`specPathProblem`, in the protocol so the app checks it too: no `..`, `.` or empty segment, no
  absolute, drive or UNC form, no control character, at most 200 characters, `.md` only, and none of
  the names Windows reads as a device, a stream or a trimmed name). The file must not be a link nor
  have a second name, and once its folders are resolved it must be inside the worktree's real path.
  It is opened without following a link or waiting on a pipe; the file opened must be the one
  checked (same device and inode, and on Linux the descriptor still points inside). A failure of any
  kind is "not there": the answer says nothing about what exists outside the worktree.
- **When it looks.** The result is kept on the card and goes stale, so the host looks again when a
  person's move goes to a column that asks for a spec (before it decides), when the card's path
  changes, and on the new `card.spec` command (the card page asks when it opens, quietly, and on
  Check again). What a look found counts only for the path the card names now, and a look that ends
  after the path changed is dropped. What moves cards on its own never looks.
- **Why not poll.** The PR poll runs only while a PR is open and a worktree can change at any time:
  the move is the moment that matters, and the page asks when a person looks.
- **Review.** The security-reviewer looked at the read (traversal, links, races, pipes, what
  leaves) before the commit that carries its verdict.

Left for later: column templates (after #75), the app showing the heading anywhere but the card page.
