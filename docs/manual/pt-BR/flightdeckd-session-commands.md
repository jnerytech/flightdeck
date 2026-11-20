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
`--host <nome>` lê um host pareado. Estes verbos só leem; os que agem sobre uma sessão vêm a seguir.

```sh
fd session interrupt fd-qa
fd session close fd-qa
fd session resume fd-qa
fd session sleep fd-qa
fd session set-model fd-qa opus
fd session set-effort fd-qa high
fd session meta set fd-qa name=Revisão pinned=true
```

Age sobre uma sessão, como os botões do app. `interrupt` para o turno em andamento, `close` encerra a sessão
e `resume` retoma uma que já terminou. `sleep` põe uma sessão ociosa para dormir: sai com `0` quando a sessão
dorme (ou já dormia) e com `1`, com o motivo, quando o daemon a mantém acordada porque está ocupada, tem uma
mensagem esperando, tem motivo para ficar de pé ou alguém a observa. `set-model <sessão> <modelo>` e
`set-effort <sessão> <low|medium|high|xhigh|max>` mudam o modelo ou o esforço dos próximos turnos; a palavra
`default` devolve o da própria sessão. `meta set <sessão>` aceita `name=<texto>`, `pinned=true|false` e
`archived=true|false` (pelo menos um); `name=` sozinho limpa o nome, e uma sessão que ainda não tem sessão do
Claude é recusada. Um nome que duas sessões dividem é recusado com os ids. Se o daemon não responde, o comando
sai com `2` e diz que a mudança pode ou não ter chegado: olhe a sessão antes de repetir. Com `--json` cada um
imprime `{"session": ..., "action": ...}` mais o novo valor. `--host <nome>` alcança um host pareado.
