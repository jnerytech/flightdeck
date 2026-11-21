# Comandos do flightdeckd: as ações de um projeto

[Voltar ao manual](../pt-BR.md) · [English](../en/flightdeckd-action-commands.md)

Os verbos que leem as ações de um projeto (um comando que uma sessão pode rodar por você, com sua regra de aprovação) e o
que cada execução fez. Funcionam como os outros comandos do `flightdeckd`: veja
[o que todos têm em comum](flightdeckd-commands.md#o-que-todos-têm-em-comum). As duas leituras não mudam nada. Como uma
sessão roda uma ação sem ver os segredos dela está no
[capítulo das ações](actions-claude-uses-a-secret-without-seeing-it.md).

## fd action

```sh
fd action list --json --project api
fd action list --plain
fd action runs
fd action runs deploy --project api --limit 20
fd action runs --json
```

`list --plain` imprime uma linha por ação, confiada ou não: o nome, a descrição, `trusted` ou `not trusted`, a regra de
aprovação, o hash e, quando o arquivo mudou depois de confiado, o que mudou. `list --json` imprime
`{ "actions": [ ... ] }` com as mesmas chaves em toda ação: `name`, `description`, `approval`, `params`, `hash`,
`trusted` e `changed`. Nenhum dos dois mostra o comando, o ambiente, a pasta de trabalho nem um segredo. O hash é o que
um `action trust --hash` futuro recebe.

`list` sem nenhuma das duas flags é o que o mod `flightdeck` lê: JSON cru só com as ações confiadas, com nome, descrição,
aprovação e parâmetros. Fica como está para o mod continuar funcionando, e não aceita `--json` nem `--host`. O `run`
também é do mod.

`runs [<ação>]` imprime as execuções, da mais nova para a mais antiga: a hora, a ação, quem pediu, como terminou
(`exit`, `timed out`, `output cut`) e a saída, indentada. Os segredos na saída já vêm mascarados pelo host. `--limit`
recebe um número inteiro de 1 a 500. Com `--json` imprime `{ "runs": [ ... ] }` como o host responde.

`--project <nome ou id>` indica o projeto; um nome que dois projetos compartilham é recusado com os ids deles. Sem ele,
`list` pede as ações do próprio host e `runs` as execuções de todos os projetos do host. `--host <nome>` lê um host pareado. Saída `0` feito, `1` recusado, `2` sem
daemon.
