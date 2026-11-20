# Comandos do flightdeckd: host e sessions

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

## fd architect, fd reviewer, fd security, fd coordinator, fd new

```sh
fd architect
fd new qa
fd new qa --model opus
```

Abre o `claude` com uma persona, igual a `flightdeckd claude --persona <id>`. As quatro palavras são
atalhos para o arquiteto, o revisor de código, o revisor de segurança e o coordenador do time;
`new <persona>` recebe o id de qualquer persona do host, do projeto ou do pacote. O que vier depois
da persona vai para o `claude` como está. Um id que não existe é recusado com código de saída `1`, e
a mensagem lista os ids que existem.

A sessão se chama `<repo>-<persona>` (por exemplo `flightdeck-qa`), ou só o nome do repo quando não
há persona. O repo é a pasta de topo do repositório git onde você está; fora de um, é o nome da
própria pasta. Um nome que você passar (`--name` ou `-n`) vale mais, e uma abertura que retoma uma
sessão (`--resume`, `--continue`) ou roda em modo print (`-p`) não recebe nome.
