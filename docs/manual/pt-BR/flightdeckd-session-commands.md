# Comandos do flightdeckd: uma sessão

[Voltar ao manual](../pt-BR.md) · [English](../en/flightdeckd-session-commands.md)

Os verbos que leem ou agem sobre uma sessão do daemon. Funcionam como os outros comandos do `flightdeckd`:
veja [o que todos têm em comum](flightdeckd-commands.md#o-que-todos-têm-em-comum). `fd sessions` lista as
sessões; `fd send` manda uma mensagem a uma delas.

## fd session

```sh
fd session interrupted
fd session summary fd-qa
fd session files fd-qa --json
```

Lê uma sessão do daemon. `interrupted` lista as sessões que uma reinicialização do daemon interrompeu nas
últimas 24 horas, uma por linha: nome, pasta, quanto tempo rodou, quando foi interrompida e a última coisa
que você pediu. `summary <sessão>` mostra o que pediram à sessão, o que ela fez, os arquivos que tocou, o
custo e o estado, a partir da transcrição (sem chamar o modelo). `files <sessão>` lista os arquivos que ela
editou, com o número de edições e a última edição. A sessão é o nome ou o id; um nome que duas sessões
dividem é recusado com os ids, e uma sessão que ainda não tem sessão do Claude não tem o que ler. Com
`--json` cada verbo imprime o que o daemon devolveu: `{"sessions": [...]}`, o resumo ou `{"files": [...]}`.
`--host <nome>` lê um host pareado. Estes verbos só leem; os que agem sobre uma sessão vêm em outra etapa.
