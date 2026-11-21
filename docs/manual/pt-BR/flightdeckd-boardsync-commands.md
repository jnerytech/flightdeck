# Comandos do flightdeckd: a sincronização de quadro de um projeto

[Voltar ao manual](../pt-BR.md) · [English](../en/flightdeckd-boardsync-commands.md)

Os verbos que leem e mudam como o quadro de um projeto está sincronizado com um quadro do GitHub Projects. Funcionam
como os outros comandos do `flightdeckd`: veja [o que todos têm em comum](flightdeckd-commands.md#o-que-todos-têm-em-comum).
`boards`, `status` e `log` não mudam nada; `link`, `unlink`, `set-map`, `set-push` e `sync-now` fazem o que o botão
**Sincronizar** faz no app: veja
[Sincronização do quadro com o GitHub Projects](board.md#sincronização-do-quadro-com-o-github-projects).

## fd boardsync

```sh
fd boardsync boards
fd boardsync status api
fd boardsync status api --json
fd boardsync log card-1
fd boardsync link api PVT_kwHOAbc
fd boardsync link api PVT_kwHOAbc --map "No status=backlog" --map "Shipped=done"
fd boardsync set-map api --map "In review=review"
fd boardsync set-push api --on --confirm
fd boardsync set-push api --off
fd boardsync sync-now api
fd boardsync unlink api
```

`boards` imprime os quadros do GitHub Projects da conta em que o `gh` do host está logado, uma linha para cada: o id
do quadro, quem é o dono e o número, o título e o link. Precisa do `gh` instalado e logado no host: quando não está, o
comando sai com `1` e diz isso.

`status <projeto>` imprime como está a sincronização de um projeto, nomeado pelo nome ou pelo id: o quadro, se os
movimentos locais são enviados a ele (`push`), quando foi lido pela última vez e, quando se aplicam, até quando está
pausado, o último erro, um aviso de que o quadro tem mais itens do que uma leitura traz, o mapa dos status do quadro
para as colunas e os status que o quadro tem. Um projeto sem quadro imprime `not linked to a board` e sai com `0`. Um
nome que dois projetos têm é recusado com os ids deles.

`log <card>` imprime o log de sincronização de um card, do mais novo ao mais antigo, uma linha para cada entrada:
quando aconteceu, o tipo e, no que se aplica, quem ganhou, o que foi mantido, o que foi perdido e o motivo. Um card
sem entradas (ou que o host não conhece) imprime `no sync log`.

`link <projeto> <id do quadro>` liga um projeto a um quadro; o id é a primeira coluna de `boards`. O host lê o quadro
uma vez durante a ligação e transforma seus itens em cards, então o comando imprime o estado depois dessa sincronização.
Sem `--map` o host escolhe sozinho a coluna de cada status, como o app; cada `--map "<status>=<coluna>"` diz um status do
quadro e a coluna para onde ele vai (`backlog`, `in_progress`, `waiting`, `review` ou `done`). O status pode ter um `=`:
a coluna é o que vem depois do último. Um projeto que já está ligado, um quadro que a conta não vê e um quadro sem o
campo Status são recusados com saída `1`.

`set-map <projeto> --map "<status>=<coluna>"...` troca o mapa de um projeto ligado; dê pelo menos um `--map`, cada
status uma vez.

`set-push <projeto> --on --confirm` envia os movimentos dos cards do projeto ao quadro; `--off` para. Ligar exige
`--confirm`, que diz que a pessoa leu o que isso faz: a coluna do card vira o Status do item, e mais nada no quadro
muda. O login precisa da permissão `project`: quando falta, o comando sai com `1` e diz isso, e nada é enviado. `--on`
sem `--confirm` é recusado pelo host.

`sync-now <projeto>` lê o quadro uma vez e imprime o que fez (criados, movidos, atualizados, conflitos, sem mapa, que
saíram, pulados, enviados, ocultados), sem o que é zero; `nothing to change` quando tudo é zero. Um quadro que não mudou
desde a última leitura diz isso.

`unlink <projeto>` para a sincronização e mantém os cards, com seus links.

Uma escrita que ficou sem resposta (o host calou ou fechou a conexão) sai com `2` e diz que a mudança pode ou não ter
acontecido: rode `fd boardsync status <projeto>` antes de repetir.

Uma sessão que roda `link`, `set-map`, `sync-now` ou `set-push --on` pelo shell é um pedido de risco alto, então o app
pergunta a você antes; `unlink`, `set-push --off` e as leituras são comandos comuns.

Com `--json` os comandos imprimem o valor que o daemon devolve, com `null` para um campo ausente (`sync-now` imprime o
`status` e o `report`; `unlink` imprime `{ "unlinked": true, "projectId": ... }`). `--host <nome>` alcança um host
pareado.
