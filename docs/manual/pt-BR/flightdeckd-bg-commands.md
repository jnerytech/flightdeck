# Comandos do flightdeckd: as sessões em segundo plano de um host

[Voltar ao manual](../pt-BR.md) · [English](../en/flightdeckd-bg-commands.md)

Os verbos que listam as sessões em segundo plano de um host: as sessões que o Claude Code roda com `claude --bg`, sem
terminal ligado. Funcionam como os outros comandos do `flightdeckd`: veja
[o que todos têm em comum](flightdeckd-commands.md#o-que-todos-têm-em-comum). Aceitam `--host <nome>` para rodar em um
host pareado e `--json` para imprimir o valor que o daemon devolve.

## fd bg

```sh
fd bg list
fd bg list --json
fd bg list --host pi
```

`list` imprime quantas sessões em segundo plano o host tem e depois uma linha para cada uma: seu id, seu estado
(`working`, `blocked`, `done`, `failed` ou `stopped`), enquanto o processo está vivo se está `busy`, `waiting` ou
`idle`, o que uma sessão em espera aguarda (`permission prompt`, `input needed`), seu nome (a pasta quando não tem nome)
e quanto custou até agora. Não muda nada.

```text
2 background sessions
  ab12 working (busy) fix the parser $0.42
  cd34 blocked (waiting), waiting for permission prompt /work/web
```

Um host sem nenhuma imprime `no background sessions`. Um host cujo `claude` é antigo demais para tê-las imprime
`this host's claude has no background sessions` e sai com `0`: é um fato sobre o host, não uma falha.

Com `--json` imprime `supported` e a lista de sessões, cada uma com `id`, `name`, `cwd`, `state`, `status`,
`waitingFor`, `pid`, `claudeSessionId`, `startedAt` (milissegundos Unix) e `costUsd`, e `null` onde o daemon não tem
valor. Quando `supported` é `false` a lista vem vazia.
