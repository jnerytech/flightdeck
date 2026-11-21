# Comandos do flightdeckd: as automações de um projeto

[Voltar ao manual](../pt-BR.md) · [English](../en/flightdeckd-automation-commands.md)

Os verbos que leem as automações de um projeto (um gatilho, como um horário, um comentário em PR, checks que falham
ou uma issue com label, e a ação que ele dispara) e o que cada uma fez quando disparou. Funcionam como os outros
comandos do `flightdeckd`: veja [o que todos têm em comum](flightdeckd-commands.md#o-que-todos-têm-em-comum). Não
mudam nada.

## fd automation

```sh
fd automation list api
fd automation list api --json
fd automation runs a1
fd automation runs a1 --limit 20 --json
```

`list <projeto>` imprime uma linha para cada automação de um projeto, dado pelo nome ou pelo id: seu id, seu nome,
`on` ou `off`, o que a dispara, o que ela faz e quantas execuções por dia ela pode fazer. `external authors allowed`
é acrescentado quando ela age sobre conteúdo de terceiros. Um projeto sem nenhuma imprime `no automations` e sai com
`0`. Um nome que dois projetos compartilham é recusado com os ids deles.

`runs <automação>` imprime as execuções de uma automação, da mais nova para a mais antiga: a hora, o status (`ok`,
`failed`, `ignored`, `skipped`, `limited` ou `missed`), a causa e o detalhe. `--limit` aceita um número inteiro de
1 a 500. Um id que o host não conhece também imprime `no runs`: o host responde com uma lista vazia, então confira o id com `automation list`.

Com `--json` os comandos imprimem o valor que o daemon devolve, com `null` num campo ausente. `--host <nome>` lê um
host pareado.
