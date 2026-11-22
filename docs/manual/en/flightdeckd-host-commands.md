# flightdeckd commands: the switches of a host

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/flightdeckd-host-commands.md)

The verbs that change how a host behaves, as the host page of the app does. A bare `fd host` still only reads: see
[fd host](flightdeckd-commands.md#fd-host). They work as the other `flightdeckd` commands do: see
[what they all share](flightdeckd-commands.md#what-they-all-share). Each prints what the host keeps now, so a
script reads the result and not its own request.

## fd host sleep

```sh
fd host sleep 30
fd host sleep 0
fd --host pi host sleep 30 --json
```

Sets after how many minutes idle sessions sleep, from `0` to `1440`; `0` turns it off. It prints
`sleep  idle sessions sleep after 30 minutes`, or `sleep  off`. A number that is not whole digits in that range is
refused before anything is sent.

## fd host keep-awake, pause and updates

```sh
fd host keep-awake on
fd host pause on
fd host updates off
```

Each takes `on` or `off`, and nothing else.

- **`keep-awake`:** keeps the computer from sleeping while sessions run. It prints `keep-awake  on  held (systemd-inhibit)`,
  or `not held (<reason>)` when the host could not hold it, or `keep-awake  off`. A host without it refuses, exit `1`.
- **`pause`:** makes new cards wait. It prints `pause  on  (2 sessions still running)` or `pause  off`.
- **`updates`:** the daemon's automatic update. It prints `updates  automatic on  (current)`, with the state of the
  update, or `updates  automatic off`. Turning it on lets the daemon install a new version and restart itself, so
  the risk rules of a session rate `fd host updates on` as high.

## fd host bypass

```sh
fd host bypass off
fd host bypass on --confirm
```

Whether sessions on the host may run without permission prompts. It prints `bypass permissions  allowed` or
`bypass permissions  not allowed`.

- **`off`** needs nothing more.
- **`on`** needs `--confirm`, your own word that you mean it. Without it the daemon refuses and the command exits
  `1`. A host with a device enrolled also wants that device's signature, which a terminal cannot give: the command
  exits `1` and says to turn it on in the app. Nothing is signed or retried.
- A session that runs `fd host bypass on` is stopped by the risk rules (high); `off` is not.

## fd ui set

```sh
fd ui set --mode simple --confirm
fd ui set --lock --confirm
fd ui set --mode full --unlock --confirm --json
```

How the host presents itself to whoever uses its app: the mode it starts in (`full` or `simple`) and whether the
switch between them is locked. It prints `mode simple, locked yes`; `--json` prints `{"mode":"simple","locked":true}`.

- Give at least one of `--mode full|simple`, `--lock` and `--unlock`. What you leave out stays as the host has it.
  `--lock` with `--unlock`, a mode that is not `full` or `simple`, or none of the three is refused and exits `1`.
- `--confirm` is your own word that you mean it. Without it nothing is sent and the command exits `1`.
- It asks the daemon of this machine only: `--host` does not apply.
- A session that runs `fd ui set` is stopped by the risk rules (high): it could lock the person out of the mode they
  work in. It is safe to run again, since it sets and does not toggle.

## Flags and exit codes

`--host <name>` and `--json` work with every verb but `fd ui set`, which has no `--host`, and `--config <file>` as for the other commands. `--confirm`
goes only with `bypass on` and `ui set`. A connection that drops while a verb is in flight exits `2` and says the setting may or
may not have changed: every verb here is safe to run again. Exit codes: `0` done, `1` refused, `2` no daemon.
