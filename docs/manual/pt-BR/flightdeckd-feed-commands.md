# Comandos do flightdeckd: o log, os releases, os alertas e a atividade de um host

[Voltar ao manual](../pt-BR.md) · [English](../en/flightdeckd-feed-commands.md)

Os verbos que leem quatro fontes de um host: o log do próprio daemon, os releases do app, os alertas abertos do
repositório de um projeto e o que aconteceu no host desde um horário. Funcionam como os outros comandos do
`flightdeckd`: veja [o que todos têm em comum](flightdeckd-commands.md#o-que-todos-têm-em-comum). Nenhum deles muda
nada. `--host <nome>` lê um host pareado, e o código de saída é `0` para feito, `1` para recusado e `2` quando nenhum
daemon responde. Com `--json` cada verbo imprime um valor JSON com todas as chaves, e `null` para o que um host deixa de
enviar. O texto que uma pessoa, um scanner ou uma sessão escreveu é impresso com os caracteres de controle trocados,
para que não comande o terminal.

## fd logs

```sh
fd logs tail
fd logs tail --lines 200 --json
```

`tail` imprime as últimas linhas do log do próprio daemon, uma por linha, a mais nova por último. `--lines <n>` aceita
um número inteiro de 1 a 500; o host decide o padrão. Um log vazio imprime `no log lines`. `--json` imprime
`{ "lines", "path" }`. O daemon oculta os segredos do log, mas ele tem caminhos e hosts; por isso, no shell de uma
sessão, `logs tail` é um comando de risco alto: o app pergunta antes à pessoa.

## fd releases

```sh
fd releases list
fd releases list --limit 5 --json
```

`list` imprime o número de releases e depois uma linha para cada (a tag, quando foi publicado e o título), seguida dos
destaques das notas, uma linha `-` para cada. `--limit <n>` aceita um número inteiro de 1 a 20. Sem releases imprime
`no releases`. `--json` imprime uma lista de `{ tag, title, publishedAt, url, highlights }`.

## fd alert

```sh
fd alert list api
fd alert list api --json
```

`list <projeto>` imprime os alertas abertos de code scanning e do Dependabot do repositório do projeto, que o host lê
com o `gh`: uma linha para cada, com a gravidade, o tipo e o número, o título e onde está. O projeto é dado pelo id ou
pelo nome; um nome desconhecido sai com `1` e lista os projetos que existem. Uma fonte que o host não conseguiu ler
acrescenta uma linha como `dependabot alerts could not be read: gh is not signed in`. Sem alertas imprime
`no open alerts in <projeto>`. `--json` imprime `{ "alerts", "unavailable" }`.

## fd activity

```sh
fd activity since 2026-11-20T09:00:00Z
fd activity since 2026-11-20T09:00:00+02:00 --limit 10 --json
```

`since <horário>` imprime o que terminou, chegou à revisão, foi mesclado ou falhou no host desde o horário, como o
"Enquanto você estava fora" do app: as sessões que terminaram, os cartões em revisão, os pull requests (mesclados, ou
abertos com checks falhando) e as execuções que falharam, cada lista com sua contagem (`3 of 12` quando o host a cortou
nas mais novas), e depois as janelas de cota agora. O horário é uma data e hora ISO com o fuso; outra forma, como
`yesterday` ou uma data sem hora, sai com `1`. `--limit <n>` aceita um número inteiro de 1 a 50. Quando nada aconteceu
imprime `nothing happened since then`. `--json` imprime `{ since, sessions, reviewCards, prs, failedRuns, quota }`, cada
lista como `{ total, items }`.
