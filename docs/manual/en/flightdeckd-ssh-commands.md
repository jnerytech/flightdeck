# flightdeckd commands: ssh destinations

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/flightdeckd-ssh-commands.md)

The verbs that read the ssh destinations of a host. They work as the other `flightdeckd` commands do: see
[what they all share](flightdeckd-commands.md#what-they-all-share).

## fd ssh

```sh
fd ssh list
fd ssh list --json
fd ssh import preview
fd ssh hostkey check prod
fd ssh test prod
```

`list` prints the destinations of the daemon, one line each: name, id, `user@host:port`, how it signs in (`agent`,
`key-file`, `vault-key` or `password`) and the fingerprint of the server key it pins, or `not pinned` before the
first confirmation. A destination that goes through another host, a jump destination, a vault item or tags shows
them after that. The vault item is named by its id; a secret is never printed. `import preview` prints the names of
`~/.ssh/config` that the import in the app would turn into destinations, and marks the ones already registered. It
writes nothing. With no destination, or no host in the file, the command says so and exits `0`. With `--json` the
commands print `{"targets": [...]}` and `{"entries": [...]}`, as the daemon returns them, with `null` for a missing
field. `--host <name>` reads a paired host. These verbs do not connect to any server.

`hostkey check <target>` and `test <target>` name a destination by its name or its id, and make the daemon connect to
it. `hostkey check` reads the server key and compares it with the one pinned: it prints `host key pinned`,
`host key not pinned yet` or `host key CHANGED` with the fingerprints, and exits `0` only when the key is pinned and
matches. `test` signs in without a terminal and prints `reachable`, or `failed` with the reason, and exits `0` only
when the login works. Neither pins a key or changes a destination: confirming a key stays in the app. A destination
that signs in with a vault key cannot be tested from a terminal, because a terminal never sends the key: the command
says so and exits `1`. A name that two destinations share is refused with their ids. These two wait up to a minute
for the server.
