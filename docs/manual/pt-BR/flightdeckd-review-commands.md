# Comandos do flightdeckd: os comentários de revisão

[Voltar ao manual](../pt-BR.md) · [English](../en/flightdeckd-review-commands.md)

Os verbos que leem e escrevem os comentários em linha de um diff. Funcionam como os outros comandos do
`flightdeckd`: veja [o que todos têm em comum](flightdeckd-commands.md#o-que-todos-têm-em-comum). `list` não muda
nada; `add`, `update`, `remove` e `send` mudam os rascunhos de um alvo ou os enviam. O fluxo do próprio app está em
[Revisão de mudanças](reviewing-changes.md).

## fd review

```sh
fd review list card:card-1
fd review list session:s1 --json
```

`list <alvo>` imprime os comentários no diff de um alvo, que é `session:<id>`, `card:<id>`, `terminal:<id>` ou
`project:<id>`. Cada comentário é uma linha: seu id, o arquivo e as linhas que cobre, o lado do diff (`new` ou `old`)
e seu estado (`draft` ou `sent`), com `outdated` quando as linhas citadas não estão mais no arquivo e o autor e a
gravidade de um achado de segunda opinião. O texto do comentário vem em seguida, recuado. Um alvo sem comentário
imprime `<alvo>: no comments` e sai com `0`. Um alvo que o host recusa sai com `1` e diz o motivo.

Com `--json` o comando imprime o valor que o daemon devolve, com `null` em `author` e `severity` quando o comentário
não tem. `--host <nome>` lê um host pareado.

## Escrever os comentários

```sh
fd review add card:card-1 --path src/a.ts --lines 10-12 --body "por que isso?"
fd review update c1 --body "por que isso, e não um mapa?"
fd review remove c1
fd review send card:card-1 --confirm
```

- `add <alvo> --path <arquivo> --lines <n|a-b> --body <texto> [--side new|old]` guarda um rascunho nessas linhas do
  arquivo. O lado é `new`, a menos que `--side old` diga outro. Imprime `added <id> <arquivo>:<linhas> <lado>`. O host
  recusa linhas que o arquivo não tem e o alvo `project:`, com o texto dele e saída `1`.
- `update <id> --body <texto>` muda o texto de um comentário e imprime `updated <id> ...`. Um comentário que o host não
  tem mais sai com `1` e `comment <id> no longer exists`.
- `remove <id>` apaga um comentário e imprime `removed <id>`. O host não diz se o id existia, então um `remove` de um id
  desconhecido imprime a mesma linha.
- `send <alvo> --confirm [--language en|pt-BR]` põe os rascunhos do alvo na sessão, no cartão ou no terminal dele como
  uma mensagem, como o Enviar revisão do app, e imprime `sent <n> comment(s) to the <session|card|terminal>`. Quando
  ninguém pode receber a mensagem, ele diz isso e imprime a revisão, para copiar. `--confirm` é obrigatório porque o
  comando envia texto a uma sessão.

Cada verbo aceita `--json`, que imprime o que o host devolve, e `--host <nome>`. Uma escrita que não recebe resposta
sai com `2` e diz o que olhar antes de repetir: rode `review list` no alvo. No shell de uma sessão, `send` é um comando
de risco alto, assim como `update` e `remove`, que podem reescrever ou apagar um rascunho que a pessoa escreveu: o app
pergunta à pessoa antes. `list` e `add` são comuns.
