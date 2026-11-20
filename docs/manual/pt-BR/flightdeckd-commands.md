# Comandos do flightdeckd: host, sessions, requests, approve e send

[Voltar ao manual](../pt-BR.md) · [English](../en/flightdeckd-commands.md)

Todo comando do `flightdeckd` que pergunta ao daemon desta máquina funciona do mesmo jeito. Abaixo,
`fd` é o nome curto do `flightdeckd` (veja #3433); até ele chegar, digite `flightdeckd` no lugar.

## O que todos têm em comum

- **`--json`:** imprime um único valor JSON e mais nada, para um script. Um dado que o daemon não
  informa vem como `null` (ou lista vazia), nunca ausente.
- **Códigos de saída:** `0` feito, `1` recusado, `2` sem daemon (parado, cortado ou lento demais).
- **Só esta máquina:** o comando lê o token do arquivo de config do daemon e fala apenas com
  `127.0.0.1` ou `::1`. `--token` é recusado.
- **A config:** `--config <arquivo>`, senão o caminho padrão.

## fd host

```sh
fd host
fd host --json
```

Mostra o que o daemon diz sobre a sua máquina: o nome do host, a versão do daemon, o sistema, a
versão do Claude, quantas sessões estão ativas, os recursos que oferece e se o modo bypass de
permissões é permitido.

```text
host  orangepi
daemon  0.37.46
system  linux arm64
claude  2.1.0
sessions  2 active
features  central, workflows
bypass permissions  allowed
```

Com `--json` as chaves são `hostName`, `os`, `arch`, `daemonVersion`, `claudeVersion`,
`activeSessions`, `features` e `allowBypassPermissions`.

## fd sessions

```sh
fd sessions
fd sessions --json
```

Lista as sessões do daemon, uma por linha: nome, estado e pasta. Com `--json` mostra uma lista de
objetos com `id`, `name`, `cwd`, `status`, `permissionMode` e `updatedAt`. Sem sessões, a lista é
vazia.

## fd requests

```sh
fd requests
fd requests --session fd-qa
fd requests --json
```

Lista os pedidos de permissão que esperam resposta, o mais antigo primeiro. `--session` deixa só uma
sessão (o nome ou o id). Cada linha traz o id do pedido, a sessão, o risco, a ferramenta e o que ela
pede, cortado em 120 caracteres. Com `--json` imprime uma lista de objetos com `id`, `sessionId`,
`session`, `tool`, `risk`, `riskReason`, `createdAt` e `input`. Sem nada esperando, a lista é vazia.

Ele lista os pedidos das sessões que o Flightdeck gerencia. O pedido de uma sessão que você abriu à
mão não aparece, mas `fd approve` e `fd deny` ainda podem respondê-lo se você souber o id.

## fd approve e fd deny

```sh
fd approve <pedido>
fd approve <pedido> --message "só desta vez"
fd approve <pedido> --hold
fd deny <pedido> --message "amplo demais"
```

Respondem um pedido aberto pelo id, como os botões Aprovar e Negar. `--message` é o que o Claude
recebe junto com a resposta. Imprime `allowed <id>` ou `denied <id>`; com `--json`, um objeto com
`id`, `decision` e, quando dados, `message` e `held`.

Um pedido que o daemon julga de **risco alto** é recusado, a menos que você use `--hold` no
`approve`. `--hold` quer dizer que você olhou o pedido e pretende permitir. É a sua palavra: o daemon
não a confere, então um agente que roda `fd approve --hold` decide por conta própria. O `deny` nunca
precisa dele.

Um pedido que não está aberto (já respondido, ou que nunca existiu) é recusado com saída `1` e
`no such request`. Se o daemon cair antes de responder, a saída é `2` e a resposta pode ou não ter
sido registrada: rode `fd requests` para ver se o pedido continua aberto.

## fd send

```sh
fd send fd-qa "rode a suíte"
fd send 01J9… "pare e relate" --json
```

Coloca um texto numa sessão, como a caixa de entrada faz. A sessão é o nome ou o id; um nome que duas
sessões compartilham é recusado, e o erro lista os ids. Imprime `sent to <id>`, ou `queued for <id>`
quando a sessão está ocupada e o texto espera o fim do turno. Com `--json` imprime `session` e
`queued`. Se o daemon cair depois que o texto saiu, a saída é `2` e o texto pode ou não ter entrado:
olhe a sessão antes de enviar de novo.
