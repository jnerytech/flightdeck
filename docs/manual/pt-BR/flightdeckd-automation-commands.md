# Comandos do flightdeckd: as automações de um projeto

[Voltar ao manual](../pt-BR.md) · [English](../en/flightdeckd-automation-commands.md)

Os verbos que leem, salvam, ligam e desligam e removem as automações de um projeto (um gatilho, como um horário, um
comentário em PR, checks que falham ou uma issue com label, e a ação que ele dispara) e o que cada uma fez quando
disparou. Funcionam como os outros comandos do `flightdeckd`: veja
[o que todos têm em comum](flightdeckd-commands.md#o-que-todos-têm-em-comum). `list` e `runs` não mudam nada.

## fd automation

```sh
fd automation list api
fd automation list api --json
fd automation runs a1
fd automation runs a1 --limit 20 --json
fd automation save api --name "Triagem noturna" --definition-file nightly.json --max-runs 5
fd automation enable a1 --confirm
fd automation disable a1
fd automation remove a1 --confirm
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

`save <projeto> --name <texto> --definition-file <arquivo>` grava uma automação e a imprime. O arquivo é JSON com as
duas coisas que formam uma automação, `{ "trigger": { ... }, "action": { ... } }`, nos formatos que o app grava: por
exemplo `{ "trigger": { "type": "cron", "expr": "0 3 * * *", "tz": "Europe/Lisbon" }, "action": { "type":
"start_workflow", "workflow": "triage" } }`. Um arquivo que não pode ser lido, não é JSON ou não se encaixa é
recusado com saída `1` antes de perguntar ao host. `--max-runs <n>` define quantas execuções por dia ela pode fazer
(um número inteiro a partir de 1), `--external-authors on|off` diz se ela age sobre conteúdo de terceiros e
`--automation <id>` altera essa automação em vez de criar uma nova. `save` sempre deixa a automação desligada, então
nada dispara até o `enable`: salvar sobre uma automação que estava ligada a desliga, e você a liga de novo com
`enable`. Um id de `--automation` que o projeto não tem é recusado.

`enable <automação> --confirm` a liga: a partir daí ela dispara sozinha. `--confirm` é obrigatório e é só a sua
palavra de que você leu o gatilho e a ação (`automation list` imprime o que a dispara e o que ela faz).
`disable <automação>` a desliga e não pede nada. `remove <automação> --confirm` a apaga junto com as execuções, e
`--json` imprime as automações que o projeto ainda tem.

Um host que não responde depois de um destes ter sido enviado deixa o resultado desconhecido: saída `2`, e a mensagem
manda conferir com `automation list` antes de tentar de novo. Um id de automação que o host não conhece é recusado com
saída `1`.

No shell de uma sessão, `automation save`, `enable` e `remove` são de **risco alto** e pedem a aprovação da pessoa
(`--confirm` não prova nada ali, pois é só uma flag que a sessão digita). `disable` e as duas leituras continuam
comuns.
