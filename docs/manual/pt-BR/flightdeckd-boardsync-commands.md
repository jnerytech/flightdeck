# Comandos do flightdeckd: a sincronização de quadro de um projeto

[Voltar ao manual](../pt-BR.md) · [English](../en/flightdeckd-boardsync-commands.md)

Os verbos que leem como o quadro de um projeto está sincronizado com um quadro do GitHub Projects. Funcionam como os
outros comandos do `flightdeckd`: veja [o que todos têm em comum](flightdeckd-commands.md#o-que-todos-têm-em-comum).
Não mudam nada. Ligar um projeto a um quadro, e a sincronização em si, continuam no app: veja
[Sincronização do quadro com o GitHub Projects](board.md#sincronização-do-quadro-com-o-github-projects).

## fd boardsync

```sh
fd boardsync boards
fd boardsync status api
fd boardsync status api --json
fd boardsync log card-1
```

`boards` imprime os quadros do GitHub Projects da conta em que o `gh` do host está logado, uma linha para cada: o id
do quadro, quem é o dono e o número, o título e o link. Precisa do `gh` instalado e logado no host: quando não está, o
comando sai com `1` e diz isso.

`status <projeto>` imprime como está a sincronização de um projeto, nomeado pelo nome ou pelo id: o quadro, se os
movimentos locais são enviados a ele (`push`), quando foi lido pela última vez e, quando se aplicam, até quando está
pausado, o último erro, um aviso de que o quadro tem mais itens do que uma leitura traz, o mapa dos status do quadro
para as colunas e os status que o quadro tem. Um projeto sem quadro imprime `not linked to a board` e sai com `0`. Um
nome que dois projetos têm é recusado com os ids deles.

`log <card>` imprime o log de sincronização de um card, do mais antigo ao mais novo, uma linha para cada entrada:
quando aconteceu, o tipo e, no que se aplica, quem ganhou, o que foi mantido, o que foi perdido e o motivo.

Com `--json` os comandos imprimem o valor que o daemon devolve, com `null` para um campo ausente. `--host <nome>` lê
um host pareado.
