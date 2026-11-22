# Comandos do flightdeckd: GitHub e a conta Claude de um host

[Voltar ao manual](../pt-BR.md) · [English](../en/flightdeckd-github-commands.md)

Os verbos que leem como o `gh` do host está autenticado, os repositórios e as issues que ele enxerga, e a conta Claude em
que o próprio `claude` do host está autenticado, e os três que mudam algo: o login no GitHub, o logout e o início do
trabalho num repositório. Funcionam como os outros comandos do `flightdeckd`: veja
[o que todos têm em comum](flightdeckd-commands.md#o-que-todos-têm-em-comum). Nenhum mostra um token.

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

## fd github login

```sh
fd github login
fd github login --cancel
```

Inicia o login do host no GitHub e mostra o que a pessoa precisa para terminá-lo: `one-time code: ABCD-1234` e depois
a página a abrir (`open https://github.com/login/device and type the code there`). O comando não abre nada e não
espera nada: digite o código nessa página e rode `fd github status` para ver quando o login terminou. `--cancel`
encerra um login em andamento (`the sign-in was cancelled`). `--json` mostra `{ "code": ..., "url": ... }`. Um host sem
`gh` é uma recusa com o texto do daemon, saída `1`. Se a conexão cair depois do pedido, a saída é `2` e a mensagem diz
que o login pode ou não estar em andamento: rode `fd github login --cancel` para encerrá-lo ou `fd github status` para
conferir.

## fd github logout

```sh
fd github logout --confirm
```

Desconecta o host do GitHub, o que encerra todo recurso que lê os repositórios e as issues dele. Sem `--confirm` é
recusado antes de enviar qualquer coisa. Um login que vem de uma variável de ambiente do daemon não pode ser removido
assim: o daemon recusa, saída `1`, com o texto dele. Diz `signed out of GitHub on this host`, ou mostra
`{ "loggedOut": true }` com `--json`. Depois de uma conexão que caiu a saída é `2` e a mensagem manda conferir com
`fd github status`.

## fd github start

```sh
fd github start octocat/hello --root ~/work --mode card
fd github start octocat/hello --root ~/work --mode session --issue 7
```

Clona o repositório numa pasta dentro de `--root`, que precisa ser uma pasta permitida do host, e abre um cartão
(`--mode card`) ou uma sessão do Claude (`--mode session`) nele. Com `--issue <n>` o texto dessa issue é o prompt do
cartão ou da sessão: qualquer pessoa que possa abrir uma issue o escreve, então leia antes. A saída diz se clonou ou
reaproveitou uma pasta que já era um clone, e depois o projeto e o cartão ou a sessão:

```
cloned into /home/ana/work/hello
project p1
card c9
```

O repositório é `owner/name`, `--issue` é um número a partir de 1, e uma pasta que existe e não é um clone, ou um
repositório que o host não enxerga, é uma recusa com o texto do daemon, saída `1`. `--json` mostra a resposta do
daemon. Um clone pode levar minutos; o comando espera até cinco minutos. Depois de uma conexão que caiu a saída é `2` e
a mensagem diz que o clone e o cartão ou a sessão podem ou não existir: rode `fd project list` para conferir antes de
rodar de novo.

No shell de uma sessão do Claude, `login`, `logout` e `start` são de risco alto: o app pede que a pessoa inicie ou
confirme cada um, e um `--confirm` digitado não é a pessoa. `status`, `repos` e `issues` continuam comuns.

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
  falhou, uma linha avisa: depois de uma leitura boa, as linhas acima são essa leitura anterior; num host nunca lido,
  elas estão vazias.
- **`refresh`:** pede ao host que leia a conta de novo e mostra o que veio, como o `get`. O daemon recusa uma
  atualização que chega logo depois da anterior, saída `1`, com o texto dele.
- **`watch`:** mostra o estado atual na hora e depois uma linha a cada atualização que o host envia, as linhas do
  `get` unidas por ` | `, até Ctrl-C (saída `0`). Com `--json` cada linha é o estado da conta em JSON.
- **`--json` do `get` e do `refresh`:** o estado do daemon inteiro, com as janelas e o comando de login.

`--host`, `--json` e os códigos de saída são os dos outros comandos: `0` feito, `1` recusado, `2` sem daemon. Um `watch`
que o host nunca confirma sai com `2`.
