# Adding and editing ssh destinations from a shell (issue #3537)

Slice 3c of the ssh verbs in [the CLI-first decision](2026-11-19-cli-first.md); the last one of the issue.

`ssh add <name> --address <host> --user <name> [flags]` and `ssh edit <target> [flags]`, both over `ssh.save`.

- **Two verbs, not `ssh save`.** `ssh.save` with an `id` replaces the whole destination and fills what is missing
  with defaults, so a one-flag "save" would silently reset the port, the jump and the key reference. `add` sends only
  what the person typed (the daemon's defaults apply). `edit` lists the destinations, resolves the target, merges the
  typed flags over what the daemon returned and sends the whole destination back with its `id`. The merge is pure
  (`ssh/domain/ssh-save-view.ts`).
- **Flags:** `--address` (not `--host`, which names the daemon), `--user`, `--port` (1 to 65535), `--auth`
  (`agent`, `key-file`, `vault-key`, `password`), `--secret-ref`, `--jump <target>` (a name or an id, sent as the
  id) and `--no-jump` (edit), `--forward-agent` and `--no-forward-agent` (edit). `add` refuses with no `--address` or
  `--user`; `edit` refuses with no flag that changes something.
- **A new `--auth` drops the old reference** unless `--secret-ref` comes with it: a vault item is no key path. `agent`
  never keeps one. A key file or vault key left with no reference is refused by the daemon.
- **ForwardAgent hands the person's agent to the remote host,** so `--forward-agent` needs `--confirm`, checked at
  parse time; the daemon asks for `confirm: true` too (`ssh_forward_agent_confirm`). `--confirm` is accepted for
  `add`, `edit` and `remove`.
- **A new address or port clears the pinned host key** at the daemon. `edit` says so and points at
  `ssh hostkey check <target>`; a destination with no pin prints `updated` alone.
- **`add` refuses a name that exists** and points at `ssh edit`: names are not unique at the daemon, and a script
  that adds twice should not get two destinations it can no longer name.
- **Risk:** `ssh add` and `ssh edit` are high from a session's shell, like the other writes, by the same matching.
  `--address --user --port --auth --secret-ref --jump` joined the options-with-a-value list the risk rules skip.
- **Not on the CLI (app only):** tags, `--via-host`, `localForward` and renaming, and a free-form options object.
  Only `ForwardAgent` is exposed. `ssh.connect` opens a terminal in the app's window and is an `appOnly` row of the
  parity table.
- `cli-parity`: `ssh.save` is a CLI row, `ssh.connect` is `appOnly`; the gaps baseline goes from 211 to 209.
