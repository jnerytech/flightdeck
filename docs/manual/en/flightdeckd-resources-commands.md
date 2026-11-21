# flightdeckd commands: what the host's work costs it

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/flightdeckd-resources-commands.md)

The verb that reads the host's resources, as the Resources panel shows them. It works as the other `flightdeckd`
commands do: see [what they all share](flightdeckd-commands.md#what-they-all-share).

## fd resources

```sh
fd resources
fd resources --json
fd --host pi resources
```

It reads and changes nothing.

- **Lines:** `memory` and `disk` (`6000 of 8000 MiB used (75%)`, or `not read`), `load` (the one-minute load per
  core, in %), and `pause`: `new cards wait from 80% of memory`, with `(holding now)` while the host keeps them
  waiting, or `off`.
- **Then one line per session and terminal:** kind, id, name, resident memory, CPU, how many processes, and their
  executable names. After them one line per orphan process: `orphan  pid 4242  start-ticks 987654  node ...`. The
  pid and the start ticks are what ending an orphan will take.
- **A host that cannot measure processes** (not Linux) says `processes not measured on this platform`.
- **`--json`:** the daemon's answer whole, with `null` for the pause share and `false` for the hold when an older host
  leaves them out.

Exit codes are the same as the other commands: `0` done, `1` refused, `2` no daemon.
