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

## The terminal writes (slice 2)

`terminal open`, `open-session`, `close` and `settings`, over `terminal.open`, `terminal.openSession`,
`terminal.close` and `terminal.settings`. Every one of them is a write, so a missing answer exits `2` and says that
a terminal may or may not have changed.

- `open --cwd <folder>` starts the host's shell, or `-- <program> <argument>...` (a list, never run through a
  shell), or `--claude [--resume <id>] [--persona <id>]` (Claude Code in the folder; not together with a
  program). The size defaults to 80x24 and `--cols`/`--rows` take whole numbers up to 500 and 300, as the protocol does.
  `open-session --session <name|id>` opens a shell in the folder the host holds for that session; a name that no
  session has, or that two share, opens nothing. Both print `opened` and the terminal's line, as `list` prints it.
- `close <terminal> --kill` asks the daemon to end the terminal's process and prints `kill sent to <terminal>`: the
  process may still be going when the command returns. The daemon detaches only the connection that asks, and the CLI
  never attached, so `close` without `--kill` changes nothing but a terminal that had already ended: it checks the
  list afterwards and prints `removed <terminal>`, or exits `1` with the reason `terminal_still_running` when the
  terminal is still there. Detaching stays the app's, per window.
- `settings --enable --confirm | --disable` turns the host's terminals on or off and prints `terminals on|off`,
  the most terminals at once and the shell. `--enable` without `--confirm` exits `1` with the reason
  `terminal_enable_confirm` before anything is sent: it is a full shell on the host for whoever reaches the daemon.
- The folder is checked by the daemon, by its real path, against the allowed roots, and the terminal's environment
  is the daemon's own filtered one; the CLI adds no path or environment logic. A terminal outlives the command that
  opened it, and `list` shows it.
- Risk (`permissions/domain/risk.ts`): a session that runs `terminal open`, `open-session` or `settings --enable`
  from its shell is high risk, since each one hands it a shell the person did not open in the app. `list`, `close`
  and `settings --disable` stay ordinary: `close --kill` and `--disable` end terminals (the second, every one)
  and lose running work, but give the session no shell it did not have, so a person is not asked.
- Five rows are `appOnly`, each with its reason in `docs/cli-parity.json`: `attach`, `ack`, `detach`, `write` and
  `resize` belong to the app's view of one terminal (a stream bound to the socket that sent `attach`, its flow
  control and the keyboard). `terminal attach` and `terminal write` are refused as unknown words.
