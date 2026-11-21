# The read side of a project's board sync from a shell (issue #3540)

Slice 1 of the boardsync verbs in [the CLI-first decision](2026-11-19-cli-first.md).

`boardsync boards`, `boardsync status <project>` and `boardsync log <card>`, over `boardsync.boards`,
`boardsync.status` and `boardsync.log`. They read what the daemon already keeps (the boards need the host's `gh`) and
change nothing.

- The noun is `boardsync`, as the protocol names it, with the project or the card as the operand, as for `watch`. A
  project is named by its name or its id (`resolveProject`: a name two projects share is refused with their ids); a
  card by its id.
- `boards` lists the boards of the signed-in account. A host with no `gh`, or one signed out, is the daemon's refusal
  (`gh_missing`, `gh_logged_out`): exit `1`, one line on stderr. No boards is `no boards` and exit `0`.
- `status` for a project with no board is `not linked to a board` and exit `0`: the lookup worked and the answer is
  "no". A script reads `linked` in `--json`.
- `--json` keeps every key and prints `null` where the daemon sends none. A project with no board carries only
  `linked`, so its other keys are `null`.
- `log` prints the entries in the order the daemon gives (oldest first), one line each: the time, the kind, and only
  the parts the entry has (who won, what was kept, what was lost, the detail).
- `boardsync` joined the commands that take `--json` and `--host`. The risk rules need no new entry: nothing here
  writes, so `fd boardsync` from a session's shell stays ordinary.
- Not in this slice: `link`, `unlink`, `set-map`, `set-push` and `sync-now`. They change what a project sends to an
  outside board, so they come with their own high-risk rules and a security review.
