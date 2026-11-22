# flightdeckd commands: ssh destinations

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/flightdeckd-ssh-commands.md)

The verbs that read, test, add, edit, pin the keys of, remove and import the ssh destinations of a host. They work as the other `flightdeckd` commands do: see
[what they all share](flightdeckd-commands.md#what-they-all-share).

## fd ssh

```sh
fd ssh list
fd ssh list --json
fd ssh import preview
fd ssh hostkey check prod
fd ssh test prod
fd ssh hostkey confirm prod --fingerprint SHA256:...
fd ssh hostkey forget prod
fd ssh add web --address web.internal --user deploy --port 2222 --jump prod
fd ssh edit web --address web2.internal
fd ssh edit web --no-jump --auth agent
fd ssh edit web --forward-agent --confirm
fd ssh remove prod --confirm
fd ssh import apply --alias staging --alias prod
```

`list` prints the destinations of the daemon, one line each: name, id, `user@host:port`, how it signs in (`agent`,
`key-file`, `vault-key` or `password`) and the fingerprint of the server key it pins, or `not pinned` before the
first confirmation. A destination that goes through another host, a jump destination, a vault item or tags shows
them after that. The vault item is named by its id; a secret is never printed. `import preview` prints the names of
`~/.ssh/config` that the import in the app would turn into destinations, and marks the ones already registered. It
writes nothing. With no destination, or no host in the file, the command says so and exits `0`. With `--json` the
commands print `{"targets": [...]}` and `{"entries": [...]}`, as the daemon returns them, with `null` for a missing
field. `--host <name>` reads a paired host. `list` and `import preview` do not connect to any server.

`hostkey check <target>` and `test <target>` name a destination by its name or its id, and make the daemon connect to
it. `hostkey check` reads the server key and compares it with the one pinned: it prints `host key pinned`,
`host key not pinned yet` or `host key CHANGED` with the fingerprints, and exits `0` only when the key is pinned and
matches. `test` signs in without a terminal and prints `reachable`, or `failed` with the reason, and exits `0` only
when the login works. Neither pins a key or changes a destination. A destination
that signs in with a vault key cannot be tested from a terminal, because a terminal never sends the key: the command
says so and exits `1`. A name that two destinations share is refused with their ids. These two wait up to a minute
for the server.

`hostkey confirm <target> --fingerprint <SHA256:...>` pins the server key of a destination. Run `hostkey check` first,
read the fingerprint it shows and compare it with the one you trust, then type it. The command scans the server again
and pins the key only when the fingerprint you typed is the one the server shows now; otherwise it pins nothing and
exits `1`. A destination whose key is already pinned, or whose key changed, is refused: run `hostkey forget <target>`
first, which unpins the key, and confirm again. `forget` pins nothing and takes only the destination. An agent that
runs these from its shell is asked to confirm, as for the other commands that decide what a host trusts.

`remove <target> --confirm` deletes a destination. Without `--confirm` it refuses and sends nothing. A destination that
another one goes through as a jump host is refused by the daemon: remove the other one first.

`import apply --alias <name>...` turns the named hosts of `~/.ssh/config` into destinations; read `import preview`
first and name only the ones you want, at least one and at most 500. It prints one line per name, `imported as <id>` or
`skipped` with the reason, and exits `1` when any name was skipped (it already exists, it is not in the file, or its
jump hosts loop). A host that names an `IdentityFile` becomes a key-file destination that uses that path. An agent that
runs `add`, `edit`, `remove` or `import apply` from its shell is asked to confirm.

`add <name> --address <host> --user <name>` creates a destination and prints `<name>: added as <id>`. Optional: `--port`
(1 to 65535), `--auth agent|key-file|vault-key|password`, `--secret-ref <key path or vault item name>` (a name, never the secret itself; the agent has none) and `--jump <target>`,
the destination it goes through (a name or an id). It refuses a name that already exists and points to `edit`.
`edit <target>` changes the fields you name and keeps the rest; it needs at least one of `--address`, `--user`,
`--port`, `--auth`, `--secret-ref`, `--jump`, `--no-jump`, `--forward-agent` and `--no-forward-agent`. A new `--auth`
forgets the old key reference unless you give `--secret-ref` with it. Changing the address or the port clears the
pinned host key; the command says so, and you run `hostkey check` and `hostkey confirm` again. `--forward-agent` lets
the remote host use your ssh agent, so it needs `--confirm` and a near connection (this computer or Tailscale): over a far one the daemon refuses it, and also refuses a change of host, port, user, jump or route on a destination that already forwards the agent. `--no-forward-agent` and an edit without it answer anywhere. A local forward that listens beyond this computer (a bind address that is not loopback, such as `0.0.0.0` or `*`) needs a near connection too; one with no bind address, `127.0.0.1` or `localhost` answers anywhere, and so does one already saved. Tags, a host to go through, local forwards and renaming
stay in the app.
