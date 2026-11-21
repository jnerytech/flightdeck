# Reading the snapshots and the trace from a shell (issue #3701)

Slice 1 of three nouns in [the CLI-first decision](2026-11-19-cli-first.md): `snapshots list|files`, `rewind preview`
and `trace get|export`, over `snapshots.list`, `snapshots.files`, `rewind.preview`, `trace.get` and `trace.export`. The
write side, `rewind apply` and `rewind undo`, is the second slice (below).

- Three nouns, not one: `snapshots` and `trace` are what the app's Checkpoints and Trace screens are called, and
  `rewind` is the word of the verb that will change the checkout, so a risk rule can read it by its noun, as the
  `changes` rules do.
- Every verb takes the Claude session id, as `session fork` does; no resolver by name was added.
- `trace export` prints the file on stdout and the count of redacted fields on stderr, so a redirect holds the file
  and nothing else. The daemon's text is parsed and printed again, so the lines are cleaned like every other output;
  text that is not JSON is refused, and the message never quotes it. `--out <file>` was not added: a shell redirect
  does the same without a second way to write a file.
- `--include-content` is the export's only flag and is refused on any other command. The export without it holds no
  prompt or tool text, and with it the daemon replaces the fields that hold a secret; the CLI adds no second pass.
- `snapshots list --json` leaves out the repository path and the git ref, which only the daemon uses; the text of a
  prompt is cut to 100 characters, and `trace get` cuts a label to 60.
- The handlers of these commands do not call `requireVaultTransport`; whether a read of another host's transcript
  needs it is the transport guard of #3439 and is not decided here.
- `trace get --json` and `snapshots list --json` print the transcript's text as the app receives it, with no secret
  scan: only `trace export` runs the scanner. The usage line and the manual say so, and name `export` as the file to
  share.
- `rewind preview` changes no file and no ref, but on the snapshot path the daemon writes the objects of the working
  tree into the repository's object store (`git add` into a temporary index, then `write-tree`); git collects them.
  Keeping them out of the store is the daemon's, not this slice's.

## The write side: `rewind apply` and `rewind undo`

Over `rewind.apply` and `rewind.undo`. They put the files of a session's checkout back, which the app does only after
the person has read the files and confirmed in its dialog.

- Both need `--confirm`, checked before the daemon is asked, and the CLI always sends `confirm: true` after it. The flag
  is moved into its own field (`rewindConfirm`) so the card check that reads `confirm` leaves it alone, as `file` does.
- `rewind apply` and `rewind undo` are rated high from a session's shell (`rewind-risk.ts`, by the noun `rewind`, like
  the `changes` rules); `rewind preview`, `snapshots` and `trace` stay ordinary reads. A typed `--confirm` is not the
  person, so the rating holds however the flag is written.
- A connection cut after the request left is exit 2 with a message that the files may or may not have been put back;
  the timeout is 60 s because a rewind through a snapshot touches the working tree.
- The daemon's refusals (`rewind_turn_running`, `rewind_nothing`) are exit 1 with its words. The handlers do not call
  `requireVaultTransport`; that is the transport guard of #3439 and is not decided here.
