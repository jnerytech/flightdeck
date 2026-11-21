# The read side of a target's changes from a shell (issue #3620)

Slice 1 of the `changes` noun in [the CLI-first decision](2026-11-19-cli-first.md).

`changes get <target>`, `changes sessions <file>` and `changes watch <target>`, over `changes.get`, `files.sessions`
and `changes.watch`. They read what the daemon already keeps and change nothing. The write side (`revert`,
`undo-revert`, `commit` and `pr`) is the second slice: it changes files, makes commits and pushes, so it comes with its
own high-risk rules, the `--confirm` flag and a security review.

- The noun is `changes`, as the protocol names it. A target is the protocol's own string (`session:<id>`, `card:<id>`,
  `terminal:<id>`, `project:<id>`), checked with the protocol's `ReviewTarget` before the daemon is asked, so a bare
  word is refused with the usage and not with a validation error of the socket. The words of the app (a session's
  name, a card's title) are not resolved: the target of a commit must be exact.
- `get` prints the root of the checkout, the base and the position of a card against it, the push address
  (`remote`) and the commit hooks, then one line for each file with its status, its counts, whether it is not committed
  and its `digest`. The write side's `commit` repeats those digests (`--file <path>=<digest>`) and `pr` repeats the
  remote, so the person always names what they saw; the CLI never reads them back for them. A file the daemon lists
  with no lines (a credential, over the cap) is listed so here, and the text never prints the lines of a diff.
- `sessions` takes the absolute path the daemon takes. A file no session wrote is `no session wrote it` and exit `0`.
- `watch` writes the same list as one line (the stream flattens a line break, so the lines are joined with `; `) each
  time the daemon pushes `changes.updated`, until Ctrl-C (exit `0`). The command sends no `changes.unwatch`: ending
  the command closes the connection, and the daemon stops every watch of a closed connection. `changes.unwatch` is
  covered by that, and has no verb of its own.
- `--json` keeps every key and the hunks of every file, and prints `null` where an older daemon sends none (`base`,
  `position`, `remote`, a file's `oldPath`, `bytes` and `digest`), `[]` for no `hooks`, and `false` for the markers
  `tooLarge` and `secret`. A `watch --json` line has no frame type.
- `changes` joined the commands that take `--json` and `--host`. The risk rules need no new entry: nothing here writes,
  so `fd changes` from a session's shell stays ordinary.
- Not in this slice: `revert`, `undo-revert`, `commit` and `pr`.
