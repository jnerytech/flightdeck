# Comandos do flightdeckd: a vigia de PR de um card

[Voltar ao manual](../pt-BR.md) · [English](../en/flightdeckd-watch-commands.md)

Os verbos que leem o que a vigia de PR de um card fez. Funcionam como os outros comandos do `flightdeckd`: veja
[o que todos têm em comum](flightdeckd-commands.md#o-que-todos-têm-em-comum). Não mudam nada.

## fd watch

```sh
fd watch get card-1
fd watch trace card-1 --json
fd watch describe card-1 > pr-description.md
fd watch by-url https://github.com/acme/api/pull/42
fd watch settings api
```

`get <card>` mostra o estado da vigia: `watching`, `needs you` com o motivo, ou `watch off`, quantas das rodadas
permitidas ela usou e uma linha para cada rodada de correção (o número, o id, o status, o custo e os turnos). Uma
rodada retida por mexer em arquivos fora do PR diz quantos são.

`trace <card>` mostra de onde veio o trabalho do card: o título, o PR, o item de trabalho, o custo total, as sessões que
o executaram (o id da sessão, `run` ou `fix`, quando começou, o custo e os checkpoints) e as rodadas de correção.

`describe <card>` mostra a descrição de PR que o daemon escreve a partir das sessões do card, uma linha por linha, para
ir a um arquivo. Não abre PR. Quando o daemon tirou linhas por parecerem um segredo, o comando diz quantas no stderr e
as deixa fora do texto.

`by-url <link>` procura um link de PR: `via: card` e o rastro do card, `via: history` e as sessões do histórico que o
citam, ou `via: none`. Não achar nada não é falha: o comando sai com `0`. Ele não busca nada no GitHub.

`settings <projeto>` mostra as configurações da vigia de PR de um projeto, pelo nome ou pelo id: uma linha para cada
configuração, com `none` para uma lista vazia e `unknown` para uma configuração que um daemon antigo não envia. Um
nome que dois projetos têm é recusado com os ids deles.

Com `--json` os comandos imprimem o valor que o daemon devolve, com `null` para um campo que falta. `--host <nome>`
lê um host pareado. Mudar as configurações, estender uma vigia e resolver uma rodada retida ainda não estão aqui: use
o app.
