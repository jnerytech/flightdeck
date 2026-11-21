# The read side of a card's run environment from a shell (issue #3621)

Slice 1 of the `runenv` noun in [the CLI-first decision](2026-11-19-cli-first.md).

`runenv config <project>`, `runenv get <card>` and `runenv watch`, over `runenv.config`, `runenv.get` and
`runenv.watch`. They read what the daemon already keeps and change nothing. The write side (`trust`, `start`, `stop`)
is the second slice: it starts processes from a project's `run.yaml`, so it comes with its own high-risk rules and a
security review.

- The noun is `runenv`, as the protocol names it. `config` takes a project (its name or its id, through
  `resolveProject`: a name two projects share is refused with their ids); `get` takes a card id; `watch` takes no
  operand, because the stream carries every card's run.
- `config` prints the hash of the file, whether it is trusted, each error, and then what the file would run: the ports,
  the setup commands and one line for each process (its command, its ready check, and the names of the variables it
  sets). The values of those variables are never printed as text, because a run.yaml may hold one a person would not
  paste into a terminal; `--json` keeps the daemon's answer whole. A project with no run.yaml is `no run.yaml` and exit
  `0`: the lookup worked and the answer is "no". The hash is what the write side's `trust` will take.
- `get` prints the card's state, its ports and one line for each process, with the terminal it runs in, so a person
  can `fd terminal` into it. An unknown card is the daemon's refusal: exit `1`, one line on stderr.
- `watch` writes one line for each update the daemon pushes, until Ctrl-C (exit `0`). The stream flattens a line break,
  so the lines of a card's state are joined with `; `. With `--json` each update is one JSON line.
- `--json` keeps every key and prints `null` where an older daemon sends none (`setupTerminalId`, `error`, a process's
  `exitCode` and `url`, and `hash` and `config` of a project with no file).
- `runenv` joined the commands that take `--json` and `--host`. The risk rules need no new entry: nothing here writes, so
  `fd runenv` from a session's shell stays ordinary.
- Not in this slice: `trust`, `start` and `stop`.
