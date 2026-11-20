# flightdeckd commands: ssh destinations

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/flightdeckd-ssh-commands.md)

The verbs that read, test and pin the keys of the ssh destinations of a host. They work as the other `flightdeckd` commands do: see
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
