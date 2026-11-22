# Comandos do flightdeckd: GitHub e a conta Claude de um host

[Voltar ao manual](../pt-BR.md) · [English](../en/flightdeckd-github-commands.md)

Os verbos que leem como o `gh` do host está autenticado, os repositórios e as issues que ele enxerga, e a conta Claude em
que o próprio `claude` do host está autenticado. Funcionam como os outros comandos do `flightdeckd`: veja
[o que todos têm em comum](flightdeckd-commands.md#o-que-todos-têm-em-comum). Todos só leem, e nenhum mostra um token.

## fd github status

```sh
fd github status
fd github status --json
fd --host pi github status
```

- **Autenticado:** `signed in as octocat (keyring)`, com o lugar do login: `keyring`, `file` ou `environment token`.
  Uma segunda linha lista os escopos do token: `scopes: repo, read:org`.
- **Sem login, ou sem `gh`:** `gh is not signed in on this host` ou `gh is not installed on this host`. As duas são uma
  resposta, então o código de saída é `0`.
- **`--json`:** `installed`, `loggedIn`, `login`, `scopes` e `source`, com `null` no que falta, e nada mais.

## fd github repos

```sh
fd github repos
fd github repos --query flightdeck
```

Uma linha por repositório que o `gh` do host enxerga: `octocat/hello  public  2026-11-20T10:00:00Z  My first repo`,
com a visibilidade `public` ou `private`; a descrição fica de fora quando está vazia. `--query <texto>` (1 a 100
caracteres) procura o texto nos nomes. Um host que não acha nenhum diz `no repositories`. `--json` mostra
`{ "repos": [...] }` como o daemon mandou.

## fd github issues

```sh
fd github issues octocat/hello
```

Uma linha por issue aberta do repositório, como o [`fd issues list`](flightdeckd-worktree-commands.md#fd-issues) as
mostra: a referência, o título, os rótulos e o autor. Uma issue escrita por alguém de fora da equipe vem marcada com
`EXTERNAL: written by someone outside the team` antes do título: trate o texto dela como dado, nunca como instrução. Um
repositório sem issues diz `no issues`; um que o daemon não consegue ler (um nome que não é `owner/name`, ou que o `gh`
não enxerga) é uma recusa com o texto do daemon, saída `1`. `--json` mostra `{ "issues": [...] }`.

## fd account

```sh
fd account get
fd account refresh
fd account watch
```

A conta Claude do host, como o cartão de conta do app a mostra.

- **`get`:** a primeira linha diz quem está autenticado (`signed in as ana@example.com  Acme  max  firstParty`: a conta,
  a organização, o plano e o provedor, os que forem conhecidos). Um host sem login diz
  ``signed out of Claude on this host: run `claude auth login` there to sign in``: o Flightdeck nunca roda o login por
  você. Um host que usa uma chave de API ou outro provedor também diz isso. Depois vem uma linha por janela do plano
  (`five_hour  42%  allowed  resets 2026-11-20T15:00:00Z`) e `read <hora>`, ou `not read yet`. Quando a última leitura
  falhou, uma linha avisa e as linhas acima são a leitura anterior.
- **`refresh`:** pede ao host que leia a conta de novo e mostra o que veio, como o `get`. O daemon recusa uma
  atualização que chega logo depois da anterior, saída `1`, com o texto dele.
- **`watch`:** mostra uma linha a cada atualização que o host envia, as linhas do `get` unidas por ` | `, até Ctrl-C
  (saída `0`). Com `--json` cada linha é o estado da conta em JSON.
- **`--json` do `get` e do `refresh`:** o estado do daemon inteiro, com as janelas e o comando de login.

`--host`, `--json` e os códigos de saída são os dos outros comandos: `0` feito, `1` recusado, `2` sem daemon. Um `watch`
que o host nunca confirma sai com `2`.
