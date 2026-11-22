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

```sh
fd session create --cwd ~/repos/app --prompt "corrija o build" --permission-mode plan
fd session fork 7c1e... --cwd ~/repos/app --up-to 3f9a... --open terminal
fd session set-mode fd-qa plan
fd session apply-persona fd-qa reviewer --language pt-BR
fd session clear-persona fd-qa
```

Inicia ou remodela uma sessão. `create` inicia uma sessão nova em `--cwd` (uma pasta sob uma raiz permitida; senão
o daemon recusa) e imprime o id; `--prompt`, `--name`, `--model`, `--effort`, `--permission-mode` e `--persona`
(com `--language`) são os campos do formulário de nova sessão. `fork` inicia uma cópia de uma sessão do Claude,
até `--up-to <id da mensagem>` quando dado: `--open flightdeck` (o padrão) a inicia como sessão do daemon, e
`--open terminal` imprime o comando que a abre (`flightdeckd claude --resume <id>`), sem abrir nada.
`set-mode <sessão> <default|acceptEdits|plan|bypassPermissions>` muda o que uma sessão ativa pode fazer sem
perguntar; um host que não permite `bypassPermissions` a recusa. `apply-persona` dá uma persona a uma sessão e
`clear-persona` a tira; cada um manda uma mensagem à sessão e diz se ela entrou, espera a vez ou foi para uma
sessão de terminal. `create`, `fork`, `set-mode` e `apply-persona` têm risco alto quando uma sessão os roda do
próprio shell, então o pedido de permissão pergunta à pessoa. Se o daemon não responde, `create` e `fork` dizem
que uma sessão pode ou não ter sido iniciada: rode `fd sessions` antes de repetir.

## fd session teleport

```sh
fd session teleport api --to cloud --repo /srv/api
fd session teleport api --to cloud --repo /srv/api --confirm --json
```

Move uma sessão ociosa, com a transcrição e o código, para outro host pareado, como o diálogo Teleport
do app. A sessão é o nome ou o id neste host (ou em `--host`); `--to` nomeia o host de destino e `--repo`
o projeto lá, que já precisa existir. Sem `--confirm` não move nada: mostra o que moveria (o modelo, o
modo de permissão, a persona, o tamanho de cada parte, o branch, os commits à frente e os arquivos
alterados, e quantas linhas parecem um segredo com o tipo, nunca o texto), descarta o pacote que fez
neste host e sai com `1`. Rode de novo com `--confirm` para mover. Um movimento que chega imprime
`moved <sessão> to <host> as session <id>` e arquiva a cópia deste host; o andamento
(`sent N of M bytes`) vai para o stderr e não aparece com `--json`, que imprime `moved`, `id`, `sessionId`,
`claudeSessionId`, `target`, `worktree` e `branch` (ou `moved: false` com o `summary` quando parou antes).

Uma sessão ocupada, de um time ou que não roda no Claude é recusada com saída `1`. Uma origem que manda um
pacote que não fecha, um destino que recusa a importação e um Ctrl-C não deixam nada em nenhum dos hosts e
saem com `1` (o Ctrl-C diz `cancelled`). Um host que não responde ou não é alcançado é saída `2`. Se o
destino não responde à importação final, a saída é `1` e a sessão pode ou não existir lá: veja as sessões
dele antes de mover de novo; a cópia daqui não foi arquivada. É classificado como de alto risco quando uma
sessão o roda do próprio shell.
