# Reading the snapshots and the trace from a shell (issue #3701)

Slice 1 of three nouns in [the CLI-first decision](2026-11-19-cli-first.md): `snapshots list|files`, `rewind preview`
and `trace get|export`, over `snapshots.list`, `snapshots.files`, `rewind.preview`, `trace.get` and `trace.export`. The
write side, `rewind apply` and `rewind undo`, is the second slice.

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
