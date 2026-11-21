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
  and its `digest`. The write side's `commit` repeats those digests (`--digest <path>=<digest>`) and `pr` repeats the
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
- Not in this slice: `revert`, `undo-revert`, `commit` and `pr`; they are the next section.

## The write side (slice 2, issue #3620)

`changes revert <target> <file>`, `changes undo-revert <target> <file>`, `changes commit <target>` and
`changes pr <target>`, over `changes.revert`, `changes.undoRevert`, `changes.commit` and `changes.pr`.

- Every write needs `--confirm`; without it the command is refused with exit `1` and the usage. `commit` takes
  `--branch`, `--message` and one `--digest <path>=<digest>` for each file; `pr` takes `--title`, `--body` and
  `--remote`. A flag that does not belong to the verb is refused with the verbs it applies to. `--message`, `--title`,
  `--body` and `--confirm` are also the flags of other commands, so the parser moves them into the `changes` fields
  before the `card` and persona checks see them.
- The CLI sends exactly what the person typed: the digests and the remote are the ones `changes get` printed and the
  person read, never refetched, so a file that changed since is refused by the daemon. The daemon refuses `commit`
  and `pr` on a transport that cannot reach the vault (`transport_refused`, exit `1`).
- A cut connection after the request left prints that the write may or may not have happened and exits `2`.
- Risk: `changes commit`, `changes pr` and `changes revert` are high from a session's shell, in every spelling the
  other `flightdeckd` rules cover (a global flag before the command, `bunx`, `bash -c`, a quoted or expanded verb).
  `undo-revert` only restores what a revert took out, and `get`, `sessions` and `watch` read: they stay ordinary.
