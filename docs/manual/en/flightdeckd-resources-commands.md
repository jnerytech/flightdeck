# flightdeckd commands: what the host's work costs it

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/flightdeckd-resources-commands.md)

The verbs that read the host's resources, as the Resources panel shows them, and change its memory guard or end an orphan. They work as the other `flightdeckd`
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

## fd resources pause-at

```sh
fd resources pause-at 0.8
fd resources pause-at off
```

Sets the share of memory from which new cards wait: a number from `0` to `1` as plain digits, or `off`. It prints the
guard as the read does: `pause  new cards wait from 80% of memory`, or `pause  off`.

## fd resources end-orphan

```sh
fd resources end-orphan 4242 987654
```

Ends the orphan process the read printed, by the two numbers on its line: the pid and the start ticks. The daemon
ends it only while that pid still has those start ticks and is still a child of the daemon, so a process that took the
pid after the orphan ended is never hit; a process that is no orphan of the daemon any more is refused, exit `1`. It prints `ended  pid 4242`. A session that
runs it is stopped by the risk rules (high).

`--host`, `--json` and the exit codes are as for the read. A connection that drops in flight exits `2` and says the
change may or may not have happened; read `fd resources` to see.
