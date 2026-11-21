# Comandos do flightdeckd: sessões de terminal e nomes

[Voltar ao manual](../pt-BR.md) · [English](../en/flightdeckd-external-commands.md)

Os verbos que listam as sessões de um `claude` comum rodando num terminal de um host, acompanham as mudanças delas, colocam uma
mensagem numa delas e listam os nomes que o host dá às suas sessões. Funcionam como os outros comandos do `flightdeckd`: veja
[o que todos têm em comum](flightdeckd-commands.md#o-que-todos-têm-em-comum). `--host <nome>`, `--json` e `--config` valem para cada um.

## fd external

```sh
fd external list
fd external list --json
fd external watch
fd external watch --json --host pi
fd external message <id-da-sessão-claude> --text "continue"
```

`list` imprime quantas sessões o host vê e depois uma linha para cada: o id da sessão do Claude, o nome, como ela está
(com o motivo, como a ferramenta que ela espera), se aceita mensagem, a pasta e a hora do último evento.
Com `--json` imprime uma lista com as mesmas chaves para toda sessão: `claudeSessionId`, `name`, `cwd`, `status`,
`statusReason`, `controllable`, `source`, `projectKey`, `permissionMode`, `waiting`, `startedAt`, `lastEventAt` e
`endedAt`, com `null` no que falta. O caminho da transcrição, o id de lançamento, o último prompt e o texto do plano
não são impressos: leia-os no app.

`watch` imprime uma linha para cada sessão que o host informa (todas ao começar, depois cada mudança), até você
apertar Ctrl-C, que o encerra com saída `0`. Com `--json` cada linha é uma linha JSON, a mesma que `list` imprime.

`message` coloca o texto na sessão, como a caixa de entrada do app faz. Só uma sessão aberta com
`flightdeckd claude` tem o canal para isso: qualquer outra é recusada com saída `1`, e também uma sessão que o host não
conhece. Um texto vazio é recusado antes de o comando conectar. Imprime `sent to <id>`; com `--json` imprime `session`
e `sent`. Se o host cair depois que o texto saiu, a saída é `2` e o texto pode ou não ter entrado:
olhe a sessão antes de enviar de novo.

## fd names

```sh
fd names list
fd names list --json
```

Imprime uma linha para cada sessão do host: o apelido que você pode digitar, o nome que o app mostra, a sessão que ele
nomeia e, quando há mais, os outros apelidos (`also ...`). Com `--json` imprime todas as chaves do nome (`sessionId`,
`display`, `alias`, `aliases`, `project`, `persona`, `number`, `cardNumber`, `standard` e `team`), com `null` no que um
host mais antigo deixa de fora. Não muda nada.
