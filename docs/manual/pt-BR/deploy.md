# Deploy

[Voltar ao manual](../pt-BR.md) · [English](../en/deploy.md)

`bun run deploy <alias>` lê `deploy.hosts.json` na raiz (fora do git):

```json
{ "pi": { "ssh": "ubuntu@orange", "target": "linux-arm64", "path": "~/.local/bin/flightdeckd" } }
```

Compila o alvo, copia com `scp` para `<path>.new`, troca o binário, reinicia com
`systemctl --user restart flightdeckd` via `ssh` e confere `systemctl --user is-active`.

Depois do primeiro [`flightdeckd update`](host-operations.md#atualizar-com-flightdeckd-update), o serviço passa a
rodar `~/.flightdeck/bin/flightdeckd`: ajuste o `path` do `deploy.hosts.json` para esse caminho.
