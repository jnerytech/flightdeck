# Comandos do flightdeckd: os comentários de revisão

[Voltar ao manual](../pt-BR.md) · [English](../en/flightdeckd-review-commands.md)

Os verbos que leem os comentários em linha que uma pessoa deixou em um diff. Funcionam como os outros comandos do
`flightdeckd`: veja [o que todos têm em comum](flightdeckd-commands.md#o-que-todos-têm-em-comum). Não mudam nada.
Escrever um comentário e enviar a revisão à sessão continuam no app: veja [Revisão de mudanças](reviewing-changes.md).

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
