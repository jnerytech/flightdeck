# flightdeckd commands: the background sessions of a host

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/flightdeckd-bg-commands.md)

The verbs that list the background sessions of a host: the sessions Claude Code runs with `claude --bg`, with no
terminal attached. They work as the other `flightdeckd` commands do: see
[what they all share](flightdeckd-commands.md#what-they-all-share). They take `--host <name>` to run on a paired host,
and `--json` to print the value the daemon returns.

## fd bg

```sh
fd bg list
fd bg list --json
fd bg list --host pi
```

`list` prints how many background sessions the host has, then one line for each: its id, its state (`working`,
`blocked`, `done`, `failed` or `stopped`), while its process is alive whether it is `busy`, `waiting` or `idle`, what a
waiting session waits for (`permission prompt`, `input needed`), its name (its folder when it has none) and what it
cost so far. It changes nothing.

```text
2 background sessions
  ab12 working (busy) fix the parser $0.42
  cd34 blocked (waiting), waiting for permission prompt /work/web
```

A host with none prints `no background sessions`. A host whose `claude` is too old to have them prints
`this host's claude has no background sessions` and exits `0`: it is a fact about the host, not a failure.

With `--json` it prints `supported` and the list of sessions, each with `id`, `name`, `cwd`, `state`, `status`,
`waitingFor`, `pid`, `claudeSessionId`, `startedAt` (Unix milliseconds) and `costUsd`, and `null` where the daemon has
no value. When `supported` is `false` the list is empty.
