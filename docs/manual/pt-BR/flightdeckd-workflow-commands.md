# Comandos do flightdeckd: os workflows de um projeto e suas execuções

[Voltar ao manual](../pt-BR.md) · [English](../en/flightdeckd-workflow-commands.md)

Os verbos que leem os workflows de um projeto e suas execuções: os workflows com o hash e a confiança de cada um, os
modelos que o projeto pode adicionar, um workflow verificado de novo, uma execução com seus passos, um fluxo de cada
mudança de uma execução e se uma execução que falhou pode retomar. Funcionam como os outros comandos do
`flightdeckd`: veja [o que todos têm em comum](flightdeckd-commands.md#o-que-todos-têm-em-comum). Confiar em um
workflow, adicionar um modelo, retomar uma execução e responder a um gate continuam no app.

## fd workflow

```sh
fd workflow list api
fd workflow templates api
fd workflow validate api ship
fd workflow run r1 --json
fd workflow watch
fd workflow resume r1
```

Um projeto é o nome ou o id dele.

`list <projeto>` imprime os workflows da branch base, uma linha cada: o nome, o hash inteiro do arquivo, `trusted`,
`untrusted` ou `invalid`, quantos comandos `check` ele pode rodar e suas entradas. Um workflow com erros imprime cada um
abaixo dele como `error: ...`. Um projeto sem workflows imprime `no workflow in .flightdeck/workflows on the base branch`.

`templates <projeto>` imprime os workflows que acompanham o produto: o id, o título, onde o arquivo vai, a persona dos
passos de agente e se a linha `check` traz o comando de teste do projeto (`filled`), um marcador que falha
(`placeholder`) ou nenhum.

`validate <projeto> <workflow>` verifica um workflow de novo e o imprime por inteiro: o nome, o hash e o estado, depois
suas entradas, seus comandos de verificação e seus erros. Um workflow com erros sai com `0`: os erros são o resultado.

`run <execução>` imprime uma execução: o estado e o motivo, o que ela gastou, até quando espera a cota do plano e cada
passo com tentativa, tipo, estado e código de saída. Uma execução desconhecida sai com `1`.

`watch` escreve uma linha a cada mudança de uma execução neste host, começando pelas que estão ativas, até Ctrl-C
(saída `0`). Com `--json` cada linha é uma execução.

`resume <execução>` só verifica: imprime de onde uma execução que falhou retomaria e não inicia nada. Quando não pode
retomar, imprime o motivo, com os parâmetros dele, e sai com `1`.

Com `--json` os comandos imprimem o que o daemon respondeu. `--host <nome>` lê um host pareado.
