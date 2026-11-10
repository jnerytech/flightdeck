# Deploy

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/deploy.md)

`bun run deploy <alias>` reads `deploy.hosts.json` at the root (outside git):

```json
{ "pi": { "ssh": "ubuntu@orange", "target": "linux-arm64", "path": "~/.local/bin/flightdeckd" } }
```

It builds the target, copies it with `scp` to `<path>.new`, swaps the binary, restarts with
`systemctl --user restart flightdeckd` over `ssh` and checks `systemctl --user is-active`.

After the first [`flightdeckd update`](host-operations.md#updating-with-flightdeckd-update), the service starts
running `~/.flightdeck/bin/flightdeckd`: set the `path` in `deploy.hosts.json` to that path.
