# The terminal verbs of the CLI (issue #3538)

Part of the CLI-first work (#3423, `2026-11-19-cli-first.md`). This is slice 1 of the `terminal` noun: the read side.

## The terminal reads

`terminal list`, over `terminal.list`. It opens nothing, attaches to nothing and writes nothing: the daemon answers
from the list its terminal manager keeps.

- Each line carries the terminal's id, the program, the folder, the size, `running` or `exited <code>`, how many
  connections follow it and when it started, then the `launch` id of a "Claude here" terminal when it has one. The
  program is the daemon's `command` field, the program only and never its arguments, so the line shows no secret
  that was passed on a command line.
- `--json` prints the daemon's `{"terminals": [...]}` as it is, `null` for a missing field; `--host <name>` reads a
  paired host. With no terminal the command says `no terminal` and exits `0`.
- `terminal` has no other word yet. The verbs that open, close and configure terminals follow in the write slice, with
  their risk rules and a security review. The five rows that belong to the app's view of one terminal (`attach`,
  `ack`, `detach`, `write`, `resize`: a stream bound to the socket that sent `attach`, its flow control and the
  keyboard) are marked `appOnly`, each with its reason, in that slice too; until then `terminal attach` and
  `terminal write` are refused as unknown words.
