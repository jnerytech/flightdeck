# Comandos do flightdeckd: as ações de um projeto

[Voltar ao manual](../pt-BR.md) · [English](../en/flightdeckd-action-commands.md)

Os verbos que leem, salvam, confiam e removem as ações de um projeto (um comando que uma sessão pode rodar por você, com sua regra de aprovação) e o
que cada execução fez. Funcionam como os outros comandos do `flightdeckd`: veja
[o que todos têm em comum](flightdeckd-commands.md#o-que-todos-têm-em-comum). `list` e `runs` não mudam nada; `save`, `trust` e `remove` mudam o que pode rodar. Como uma
sessão roda uma ação sem ver os segredos dela está no
[capítulo das ações](actions-claude-uses-a-secret-without-seeing-it.md).

## fd action

```sh
fd action list --json --project api
fd action list --plain
fd action runs
fd action runs deploy --project api --limit 20
fd action runs --json
fd action save --project api --definition-file deploy.json --secret-ids token
fd action trust deploy --project api --hash <os 64 caracteres que list imprime>
fd action remove deploy --project api
```

`list --plain` imprime uma linha por ação, confiada ou não: o nome, a descrição, `trusted` ou `not trusted`, a regra de
aprovação, o hash e, quando o arquivo mudou depois de confiado, o que mudou. `list --json` imprime
`{ "actions": [ ... ], "errors": [ ... ], "issues": ... }` com as mesmas chaves em toda ação: `name`,
`description`, `approval`, `params`, `hash`, `trusted` e `changed`. `errors` e `issues` dizem o que há de errado no
arquivo de ações (`null` quando o host não manda `issues`), e `--plain` imprime cada erro numa linha `error:`; assim uma
lista vazia nunca esconde um arquivo quebrado. Nenhum dos dois mostra o comando, o ambiente, a pasta de trabalho nem um segredo. O hash é o que
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

## Salvar, confiar e remover

`save --definition-file <arquivo>` declara uma ação: o arquivo traz a declaração inteira da ação como um objeto JSON, como o
formulário do app a monta. Imprime a ação salva (as mesmas chaves de `list --json`) e sai com `0`. **O host confia no que é
salvo assim no momento em que salva**, então a ação já pode rodar, com os segredos no ambiente, sem um segundo passo. Sem `--project` é uma
ação do próprio host. Uma declaração que o host recusa (um nome já usado por outro tipo, um parâmetro ruim, um segredo que ele
não conhece) sai com `1` e o texto do host. O cofre fica no app, não no host, então o host não sabe quais ids de segredo existem:
`--secret-ids token,deploy-key` envia os ids que você conhece, e o host recusa então a referência a qualquer outro. Sem a
flag o host não confere.

`trust <ação> --hash <hash>` deixa uma ação versionada (de `.flightdeck/actions.yaml`) rodar. Pede o hash inteiro, de 64
caracteres, que `list --plain` imprime, e só confia se ele ainda for o da ação. Se o arquivo mudou, nada é confiado: sai com `1`,
imprime o texto do host e o hash que a ação tem agora, para você comparar o que vai confiar. O hash é só uma palavra que quem
chama digita: prova que viu um hash, não que uma pessoa revisou o arquivo.

`remove <ação>` apaga uma ação salva no host ou no projeto, com a confiança dela, e imprime o que sobrou. Uma ação que vem de
`.flightdeck/actions.yaml` não está nessa tabela: remova editando o arquivo, e o host responde que ela não existe. Um nome
desconhecido sai com `1`.

Uma escrita que não teve resposta (o host caiu ou demorou) sai com `2` e diz, na saída de erro, que a mudança pode ou não ter
sido feita: rode `fd action list --plain` antes de tentar de novo.

### A partir de uma sessão

Quando uma sessão roda `fd action save`, `trust` ou `remove` no próprio shell, o pedido é de **risco alto** e vem para você:
escreveria um comando que roda com segredos, deixaria um rodar ou apagaria um. `list`, `runs` e `run` continuam comandos
comuns de shell. No `save` o pedido mostra o caminho do arquivo de definição, não o que há nele, e uma sessão pode mudar o arquivo
depois da sua resposta: abra o arquivo e negue se não puder ler o que ele roda.
