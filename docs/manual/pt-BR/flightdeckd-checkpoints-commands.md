# Comandos do flightdeckd: os snapshots e o trace de uma sessão do Claude

[Voltar ao manual](../pt-BR.md) · [English](../en/flightdeckd-checkpoints-commands.md)

Os verbos que leem os snapshots git que o Flightdeck tira em volta de cada turno de uma sessão do Claude, o que voltar
a um deles mudaria, e o trace da sessão: seus turnos, chamadas de ferramenta e subagentes com tempo e custo. Funcionam
como os outros comandos do `flightdeckd`: veja [o que todos têm em comum](flightdeckd-commands.md#o-que-todos-têm-em-comum).
Todos só leem, exceto `rewind apply` e `rewind undo` (sem `--preview`), que devolvem arquivos e exigem `--confirm`. Aceitam
`--host <nome>` para rodar em um host pareado e `--json` para imprimir o valor que o daemon devolve.

`<sessão>` é o id da sessão do Claude, o que os comandos de histórico imprimem. Uma sessão que o daemon não conhece é
recusada com saída `1`.

## fd snapshots

```sh
fd snapshots list 3f9c1a
fd snapshots files 3f9c1a 2
fd snapshots files 3f9c1a 2 --json
```

`list <sessão>` imprime uma linha para cada snapshot: seu número, seu tipo (`before`, `after` ou `safety`), quando foi
tirado e o prompt do turno, quando há um. O número é o turno que os outros verbos recebem. Uma sessão sem nenhum
imprime `no snapshots`. Com `--json` imprime número, tipo, id do turno, prompt e hora de cada snapshot, com `null`
quando falta o prompt; o caminho do repositório e a referência git ficam com o daemon.

`files <sessão> <turno>` imprime quantos arquivos aquele turno mudou e as linhas adicionadas e removidas, e depois uma
linha para cada arquivo com a forma como mudou. Um turno que não mudou nada imprime `no file changed`. O turno é um
número inteiro a partir de `0`; qualquer outra coisa é recusada com saída `1` antes de o daemon ser consultado.

## fd rewind

```sh
fd rewind preview 3f9c1a 2
```

`preview <sessão> <turno>` diz o que voltar a sessão àquele turno mudaria, e se o daemon faria isso pelo checkpoint do
SDK ou por um snapshot: os arquivos e as linhas adicionadas e removidas. Não muda arquivo nem referência; no caminho do snapshot o git pode guardar os objetos da árvore de trabalho, e depois os coleta.

```sh
fd rewind undo 3f9c1a --preview
```

`undo <sessão> --preview` diz o que o `undo` mudaria agora: os arquivos que diferem entre o estado guardado antes do
último rewind e o checkout como está, com as linhas adicionadas e removidas. Isso inclui as edições feitas depois do
rewind, que um undo sobrescreveria. Não aceita `--confirm`, não muda arquivo nem referência, e `--preview` com `--confirm` é recusado
com saída `1`. Depois que o undo rodou, ou quando o checkout já é igual ao estado guardado, imprime `no file changed`.
Sem rewind para desfazer, o daemon recusa com saída `1`.

```sh
fd rewind apply 3f9c1a 2 --confirm
fd rewind undo 3f9c1a --confirm
```

`apply <sessão> <turno>` devolve os arquivos do checkout da sessão ao estado daquele turno, e `undo <sessão>` os devolve
ao estado anterior ao último rewind. Cada um imprime os arquivos que devolveu e as linhas adicionadas e removidas, e se
passou pelo checkpoint do SDK ou por um snapshot. Os dois exigem `--confirm`; sem ele o comando é recusado com saída
`1` e o daemon não é consultado. Leia o `preview` antes. O `undo` não tira um snapshot próprio: ele restaura o estado guardado antes do último rewind,
então as edições feitas desde aquele rewind se perdem. O daemon recusa com saída `1` enquanto a sessão está em um
turno, e quando não há nada para desfazer. Se a conexão cair depois de o pedido sair, o comando diz que os arquivos
podem ou não ter sido devolvidos e sai com `2`: olhe os arquivos com `preview` e `snapshots list` antes de tentar de novo.

Um rewind que mudaria um arquivo que o Claude Code lê como configuração (qualquer coisa numa pasta `.claude`, um `CLAUDE.md`, um `CLAUDE.local.md` ou um `.mcp.json`) ou um arquivo que tem outro hard link exige uma conexão próxima (este computador ou a Tailscale): por uma distante o daemon recusa com `transport_refused` antes de escrever qualquer coisa. O mesmo vale para uma bifurcação que volta os arquivos antes (`session.fork` com um turno de volta). Qualquer outro rewind funciona de qualquer lugar.

O shell de uma sessão não roda `rewind apply` nem `rewind undo` sem a pessoa aprovar no app; `rewind undo --preview` só lê, então roda sem isso.

## fd trace

```sh
fd trace get 3f9c1a
fd trace export 3f9c1a > trace.json
fd trace export 3f9c1a --include-content > trace.json
```

`get <sessão>` imprime o custo e a duração da sessão, o turno ou subagente que mais custou e a chamada que mais
demorou, e depois a árvore: uma linha para cada turno, chamada de ferramenta, subagente e pensamento, com seu tempo,
seu custo e `error` quando falhou. O texto dos prompts dos turnos é cortado em uma linha; `--json` imprime o trace
inteiro que o daemon montou, com as entradas e os resultados das ferramentas, como estão na transcrição: os segredos não são substituídos, então `get --json` não é o arquivo para compartilhar. O `export` é.

`export <sessão>` imprime o trace como JSON na saída padrão, o arquivo que a exportação do app salvaria, para que o
shell o redirecione para onde quiser. O arquivo tem a estrutura e os números; `--include-content` acrescenta os
prompts e as entradas e resultados das ferramentas, com qualquer campo que tinha um segredo substituído. Quando o
daemon substituiu algum, o comando diz quantos na saída de erro, nunca no arquivo. Com `--json` imprime o nome do
arquivo, seu texto e essa contagem como um só valor.
