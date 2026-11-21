# The daemon's own update and stop from a shell (issue #3780)

## Context

`daemon.update.check`, `daemon.update.apply` and `daemon.shutdown` had no command (CLI first, #3423). `update`
already existed as the install of a local file (`update --from <binary>`), which asks no daemon. `apply` makes the
daemon install a build and restart, and `shutdown` ends it with every session and terminal it runs: the app asks
the person for each, and from a shell `--confirm` is only a typed word (#3439).

## Decision

1. `update` gains two verbs: `update check` and `update apply --confirm`. With no verb it is still the install of a
   file (`--from`, `--allow-downgrade`, and the same "update needs --from <new binary>" refusal). The two forms
   refuse each other's flags, and the install of a file refuses `--json` (it was never a JSON command; the flag is
   refused, not ignored).
2. `daemon stop --confirm` is a new noun, `daemon`, with one verb. `service stop` stays: it stops the OS service,
   which restarts nothing and asks no daemon; `daemon stop` asks the running daemon on this machine to exit.
3. All three ask the daemon of this machine: `--host` is refused by the parser, as it is for the install of a file.
   A far host's update stays with `host updates` and the app.
4. `apply` and `stop` refuse without `--confirm` in the parser (exit 1, nothing sent). `update apply` prints only
   that the daemon accepted (`update started`, `{"started":true}`); it does not wait for the daemon to come back
   (`waitHealthy`), because the connection dies with the restart. `daemon stop` prints `stopping`
   (`{"stopping":true}`) on the ack: the daemon answers with no value, so the CLI gives the JSON itself. Exit
   codes are 0 done, 1 refused, 2 no daemon; a cut after the request says it may or may not have acted.
5. Risk (`permissions/domain/daemon-risk.ts`): `update apply` and `daemon stop` are high on the verb alone, with or
   without `--confirm`. Conditioning on the flag would leave the `xargs --confirm` and expanded-word holes that
   `workflow resume` needed a rule for (#3628), and the flag is no proof in a shell anyway. `update check` and
   `update --from` stay ordinary.
6. `update` and `daemon` join `VERB_NOUNS`, so a verb the shell expands (`fd daemon $V`) reads as hidden. One
   consequence: `echo ./bin | xargs fd update --from` reads as unfinished, so it is high. Accepted: nobody installs a
   build through xargs, and a high rating only asks the person.
7. Runners live in their domains: `updates/update-cli.ts` (check, apply) and `service/daemon-stop-cli.ts` (the
   service domain owns the daemon's process life). `commands.ts` is at the size limit, so its one `update` line
   calls `updateCommand` in `daemon-runs.ts`, which sends a verb to the daemon runner and the bare form to
   `runUpdateCommand`.

## Discarded

- `daemon stop` waiting until the daemon is gone: the stop is the daemon's own exit after the ack, and a wait
  needs a second connection to poll; `service status` already tells.
- `update apply` waiting for the new version: the restart cuts the connection, so the wait would report a lost
  connection for a good update.
- `daemon stop` as `service stop`: that verb stops the OS unit (and with it the daemon); the two differ for a
  daemon started by hand.
- Rating `update apply` high only with `--confirm`: see 5.

## Consequences

- Under an installed service `daemon stop` is a restart: the unit has `Restart=always` and the daemon exits 0, so it
  returns after about 5 s. The manual says so; keeping it down is `service stop`. `update apply` waits up to 180 s for
  the daemon's answer, because the daemon downloads and verifies the binary before it answers.
- Not done here: a device proof of `apply` and `shutdown` (they would stop the daemon every session shares),
  `host updates` for a far host, and `service start`.
- Parity: `daemon.update.check` and `daemon.update.apply` map to `update`, `daemon.shutdown` to `daemon`.
