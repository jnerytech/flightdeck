# Comandos do flightdeckd: host, sessions, requests, approve e send

[Voltar ao manual](../pt-BR.md) · [English](../en/flightdeckd-commands.md)

Todo comando do `flightdeckd` que pergunta ao daemon desta máquina funciona do mesmo jeito. Abaixo,
`fd` é o nome curto do `flightdeckd`: o `flightdeckd setup` o instala (veja
[flightdeckd claude e o canal](flightdeckd-claude-and-the-channel.md)), e o `flightdeckd` funciona
no lugar dele em todo canto.

## O que todos têm em comum

- **`--json`:** imprime um único valor JSON e mais nada, para um script. Um dado que o daemon não
  informa vem como `null` (ou lista vazia), nunca ausente.
- **Códigos de saída:** `0` feito, `1` recusado, `2` sem daemon (parado, cortado ou lento demais).
- **Esta máquina, por padrão:** o comando lê o token do arquivo de config do daemon e fala apenas
  com `127.0.0.1` ou `::1`. `--token` é recusado.
- **Outro host, com `--host <nome>`:** `fd host`, `fd sessions`, `fd requests`, `fd send`,
  `fd approve` e `fd deny` aceitam o nome de um host pareado no app. O comando pergunta ao daemon
  desse host com o token que o app guarda no cofre de credenciais do sistema. O token nunca é
  impresso, e `--token` e `--config` são recusados com `--host`. Uma recusa é saída `1`: nome
  desconhecido ou ambíguo (a mensagem lista os hosts conhecidos), sem cofre de credenciais (pareie
  pelo app), endereço `ws://` simples fora de rede privada, ou um token que o host não aceita mais
  (pareie o host de novo no app). Um host que não responde é saída `2`. Com `--json`, uma recusa
  de alcançar o host é uma linha JSON no stderr, `{"error": "...", "reason": "..."}`, com um motivo
  estável como `unknown_host`, `no_store`, `token_refused` ou `unreachable`; uma recusa do próprio
  daemon do host (um pedido já fechado, uma sessão desconhecida) é uma linha simples. Uma escrita (`fd send`,
  `fd approve`, `fd deny`) que não recebe resposta avisa que a mudança pode ter sido feita: olhe
  antes de repetir.
- **A config:** `--config <arquivo>`, senão o caminho padrão (não com `--host`).

## fd host

```sh
fd host
fd host --json
```

Mostra o que o daemon diz sobre a sua máquina: o nome do host, a versão do daemon, o sistema, a
versão do Claude, quantas sessões estão ativas, os recursos que oferece e se o modo bypass de
permissões é permitido.

```text
host  orangepi
daemon  0.37.46
system  linux arm64
claude  2.1.0
sessions  2 active
features  central, workflows
bypass permissions  allowed
```

Com `--json` as chaves são `hostName`, `os`, `arch`, `daemonVersion`, `claudeVersion`,
`activeSessions`, `features` e `allowBypassPermissions`.

## fd sessions

```sh
fd sessions
fd sessions --json
```

Lista as sessões do daemon, uma por linha: nome, estado e pasta. Com `--json` mostra uma lista de
objetos com `id`, `name`, `cwd`, `status`, `permissionMode` e `updatedAt`. Sem sessões, a lista é
vazia.

## fd architect, fd reviewer, fd security, fd coordinator, fd new

```sh
fd architect
fd new qa
fd new qa --model opus
```

Abre o `claude` com uma persona, igual a `flightdeckd claude --persona <id>`. As quatro palavras são
atalhos para o arquiteto, o revisor de código, o revisor de segurança e o coordenador do time;
`new <persona>` recebe o id de qualquer persona do host, do projeto ou do pacote. O que vier depois
da persona vai para o `claude` como está. Um id que não existe é recusado com código de saída `1`, e
a mensagem lista os ids que existem.

A sessão se chama `<repo>-<persona>` (por exemplo `flightdeck-qa`), ou só o nome do repo quando não
há persona. O repo é a pasta de topo do repositório git onde você está; fora de um, é o nome da
própria pasta. Um nome que você passar (`--name` ou `-n`) vale mais, e uma abertura que retoma uma
sessão (`--resume`, `--continue`) ou roda em modo print (`-p`) não recebe nome.

## fd requests

```sh
fd requests
fd requests --session fd-qa
fd requests --json
```

Lista os pedidos de permissão que esperam resposta, o mais antigo primeiro. `--session` deixa só uma
sessão (o nome ou o id). Cada linha traz o id do pedido, a sessão, o risco, a ferramenta e o que ela
pede, cortado em 120 caracteres. Com `--json` imprime uma lista de objetos com `id`, `sessionId`,
`session`, `tool`, `risk`, `riskReason`, `createdAt` e `input`. Sem nada esperando, a lista é vazia.

Ele lista os pedidos das sessões que o Flightdeck gerencia. O pedido de uma sessão que você abriu à
mão não aparece, mas `fd approve` e `fd deny` ainda podem respondê-lo se você souber o id.

## fd approve e fd deny

```sh
fd approve <pedido>
fd approve <pedido> --message "só desta vez"
fd deny <pedido> --message "amplo demais"
```

Respondem um pedido aberto pelo id, como os botões Aprovar e Negar. `--message` é o que o Claude
recebe junto com a resposta. Imprime `allowed <id>` ou `denied <id>`; com `--json`, um objeto com
`id`, `decision` e, quando dada, `message`.

Um pedido que o daemon julga de **risco alto**, ou uma permissão que salva uma regra, não é para a
linha de comando: `fd approve` é recusado com saída `1` e manda aprovar no app. O app assina a resposta
com a chave do seu dispositivo (veja `fd approvers`), e um script ou um agente não tem essa chave. O
`deny` nunca precisa dela. `--hold` ainda é aceito para os scripts antigos continuarem rodando, e não
faz nada.

Um pedido que não está aberto (já respondido, ou que nunca existiu) é recusado com saída `1` e
`no such request`. Se o daemon cair antes de responder, a saída é `2` e a resposta pode ou não ter
sido registrada: rode `fd requests` para ver se o pedido continua aberto.

## fd send

```sh
fd send fd-qa "rode a suíte"
fd send 01J9… "pare e relate" --json
```

Coloca um texto numa sessão, como a caixa de entrada faz. A sessão é o nome ou o id; um nome que duas
sessões compartilham é recusado, e o erro lista os ids. Imprime `sent to <id>`, ou `queued for <id>`
quando a sessão está ocupada e o texto espera o fim do turno. Com `--json` imprime `session` e
`queued`. Se o daemon cair depois que o texto saiu, a saída é `2` e o texto pode ou não ter entrado:
olhe a sessão antes de enviar de novo.

## fd approvers

```sh
fd approvers enroll
fd approvers enroll --json
fd approvers reset
```

Um pedido de risco alto, ou uma permissão que salva uma regra, só é aprovado com a prova assinada de
um dispositivo que você cadastrou: o app assina a resposta com uma chave que nunca sai do dispositivo,
e o daemon confere a assinatura. Estes dois comandos são o único jeito de começar ou desfazer isso, e
funcionam só no terminal do host: nenhuma mensagem do app, de uma sessão ou de um script abre o
cadastro nem remove uma chave.

- **`enroll`:** imprime um código de uso único e abre uma janela de 10 minutos. Digite o código na tela de
  cadastro de dispositivo do app. A janela fecha quando o primeiro dispositivo
  é cadastrado, quando os 10 minutos passam ou depois de cinco códigos errados, e cada execução gera um
  código novo. Com `--json` imprime `code` e `expiresAt`. É recusado com saída `1` quando já há um
  dispositivo cadastrado: adicione outro pelo app do primeiro, ou rode `reset`.
- **`reset`:** remove todos os dispositivos cadastrados e fecha a janela. O host volta a ser como era
  antes do primeiro dispositivo: uma permissão de risco alto exige só o botão Aprovar segurado. Imprime
  quantos dispositivos saíram; com `--json`, `removed`. O host mantém a sua identidade.

Os dois leem a pasta de dados do arquivo de configuração e funcionam com o daemon rodando ou parado.
Enquanto nenhum dispositivo estiver cadastrado, nada muda para você.

## fd board

```sh
fd board settings
fd board settings --max-parallel-runs 4
fd board settings --json
fd board watch
fd board watch --json
```

`settings` mostra os ajustes do quadro para o host todo, como a tela de Projetos. `watch` acompanha o quadro.

- **`settings`:** imprime `max parallel runs: <n>`, quantas execuções de cartão o quadro inicia ao mesmo
  tempo neste host. Com `--json` imprime a resposta do daemon.
- **`settings --max-parallel-runs <n>`:** muda esse limite (um número inteiro, 1 ou mais) e imprime o
  novo. Um valor que não seja inteiro de 1 ou mais sai com `1` e não envia nada.

- **`watch`:** fica conectado e imprime uma linha a cada vez que um cartão muda, com as palavras de
  `card list` (`<id>  <coluna>  <título>`, com o motivo da espera, se houver). Roda até você apertar
  Ctrl-C, que sai com `0`. Com `--json` imprime um cartão por linha, em JSON, para um script. O limite de
  15 s vale só para a conexão; se o daemon sumir enquanto você acompanha, sai com `2`.

Uma alteração que fica sem resposta sai com `2` e diz que pode ou não ter sido feita: rode
`board settings` antes de tentar de novo. Os códigos de saída são os dos outros comandos: `0` feito, `1`
recusado, `2` sem daemon.

## fd history

```sh
fd history list [--cwd <pasta>] [--project-key <chave>] [--from <hora>] [--to <hora>] [--origin flightdeck|external] [--hide-automated] [--limit 20] [--cursor <c>] [--json]
fd history search "bug do login" [--cwd <pasta>] [--from <hora>] [--to <hora>] [--limit 10] [--json]
fd history get <sessão> [--tail] [--limit 50] [--cursor <c>] [--json]
fd history tool <sessão> <mensagem> <índice> [--json]
fd history resume <sessão> [--name <texto>] [--permission-mode <modo>] [--force] [--json]
fd history watch [--json]
fd history reindex
```

`list`, `search`, `get` e `tool` leem as conversas que o Claude Code já gravou, como a tela de
Histórico. Não mudam nada, e as pastas de `history.excludeCwds` ficam de fora, como no app.

- **`list`:** uma linha por sessão: id, hora da última mensagem, pasta, título e número de mensagens, com
  `[may be running]` quando outro processo ainda pode estar gravando. Uma lista mais longa termina com
  `more: history list --cursor <c>`; passe esse cursor para ler a próxima página.
- **`search <texto>`:** uma linha por resultado: sessão, mensagem, hora e papel, depois o trecho com cada
  ocorrência entre `«` e `»`. Imprime `no session matches` quando não há nenhum.
- **`get <sessão>`:** o transcript como texto, um bloco por mensagem (hora, papel, depois o texto). `--tail`
  abre nas últimas mensagens. Uma página termina com `more:` e, num tail, `earlier:`, que dão o comando
  que lê a próxima página ou a anterior.
- **`tool <sessão> <mensagem> <índice>`:** a entrada e o resultado inteiros de uma chamada de ferramenta
  de uma mensagem (o id da `<mensagem>` é a segunda coluna de `search`, e o `<índice>` conta a partir de
  0). Diz quando o transcript tinha mais que os 64 KiB mostrados. Uma chamada que o transcript não tem
  sai com `1`.
- **`resume <sessão>`:** inicia uma sessão nova que continua o transcript, na pasta dele, e imprime
  `resumed as session <id>` (com `--json`, a resposta do daemon). `--name` dá o nome (o título do
  transcript por padrão) e `--permission-mode` escolhe o modo (o padrão do host, se omitido). Um
  transcript que pode estar rodando em outro lugar é recusado com `1` até você somar `--force`. Se o
  daemon não responder, a mensagem diz que a sessão pode ou não ter sido iniciada: veja `sessions` antes
  de tentar de novo.
- **`watch`:** mantém uma conexão aberta e imprime uma linha por transcript que cresce: id, hora da
  última mensagem, pasta e `[may be running]` (com `--json`, um objeto por linha: `claudeSessionId`,
  `cwd`, `lastTs`, `maybeActive`). Roda até Ctrl-C (saída `0`); se o daemon sumir, sai com `2`.
- **`reindex`:** reconstrói o índice; pare o daemon antes (veja [Histórico](history.md)).

`--limit` aceita de 1 a 200 (até 500 em `get`). Com `--json` tudo menos `reindex` imprime a resposta do
daemon. Na shell de uma sessão, um resume com `--force` ou `--permission-mode` conta como alto risco: a
pessoa confirma. Os códigos de saída são os dos outros comandos: `0` feito, `1` recusado, `2` sem daemon.

## fd vault

```sh
fd vault decisions [<segredo>] [--days <1-365>] [--limit <1-1000>] [--json]
fd vault report [--days <1-365>] [--csv] [--json]
fd vault rules <segredo> [--json]
fd vault rules preview <segredo> --requester <you|claude|automation|workflow> --purpose <ssh|action|run_with_secret> [--action <nome>] [--host <h>] [--project <p>] [--session <s>] [--tag <t>]... [--risk <low|medium|high>] [--approval <always|never|first-per-session>] [--at <hora>] [--json]
```

O lado de leitura do cofre, como a tela de Segredos mostra. Nenhum imprime o valor de um segredo e
nenhum muda nada: entregar um segredo e usá-lo continuam no app.

- **`decisions [<segredo>]`:** uma linha por decisão, na ordem do daemon: hora, segredo, quem pediu,
  finalidade (e a ação) em um host, `decisão/resultado` com quem aprovou, e o motivo. `--days` e `--limit`
  restringem; `--json` imprime a resposta do daemon. A auditoria não filtra por risco nem por host aqui,
  porque o daemon não filtra por eles.
- **`report`:** os usos contados por segredo, quem pediu e resultado. `--csv` imprime o texto que o app salva.
- **`rules <segredo>`:** as tags do segredo e uma linha por regra, como o daemon a guarda.
- **`rules preview <segredo>`:** o que um uso receberia, como ensaio: `allow`, `ask` ou `deny`, a regra ou o
  padrão que decidiu e o motivo, com `[once per session]`, `[approval must be held 2 s]` ou
  `[limit reached]` quando valem. `--requester` e `--purpose` são obrigatórios; `--at` aceita data e hora ISO
  com fuso, como `2026-11-20T03:00:00Z` (agora por padrão). Não grava nada na auditoria. Um segredo chamado
  `preview` não pode ser lido com `rules <segredo>`.

Os códigos de saída são os mesmos dos outros comandos: `0` feito, `1` recusado, `2` sem daemon.

## fd persona

```sh
fd persona list
fd persona list --scope project --project-path ~/work/api --language en
fd persona show architect
fd persona subagents --project-path ~/work/api --json
fd persona save architect --scope host --name Architect --description "Desenha módulos" --body-file architect.md
fd persona remove architect --scope host
fd persona reset reviewer
fd persona publish-agent architect --project-path ~/work/api --confirm
fd persona trust local --project-path ~/work/api --hash abcdef012345
```

`list`, `show` e `subagents` leem as personas deste host, como a tela Personas faz. `save`, `remove`,
`reset`, `publish-agent` e `trust` as alteram.

- **`list`:** uma linha por persona: o id, onde ela mora (`pack`, `host` ou `project`), o nome,
  `(edited)` para uma persona do pacote que este host alterou e, para uma persona de projeto, o começo do
  hash e `not trusted` até o hash ser confiado. Uma última linha nomeia os arquivos do projeto que ficaram
  de fora e o motivo. `--scope` mantém só `host`, `project` ou `all` (o padrão).
- **`show <id>`:** a persona com a descrição, o modelo, o esforço, as ferramentas e o modo de permissão
  que ela define, e o seu prompt. Diz de onde a persona veio. Um id que o daemon não conhece é recusado
  com saída `1`.
- **`subagents`:** os agentes que uma sessão do projeto recebe (`persona-<id>`) e as personas de projeto
  deixadas de fora porque ninguém confiou nelas ainda.
- **`save <id>`:** cria ou edita uma persona. Exige `--scope host|project`, `--name`, `--description` e o
  prompt, por `--body <texto>` ou `--body-file <caminho>` (um dos dois). Também aceita `--model`,
  `--effort low|medium|high|xhigh|max`, `--tools Read,Grep` (só restringe), `--permission-mode` e
  `--icon`. Salvar substitui a persona inteira: um campo omitido é apagado, então repita os que quiser
  manter. Uma persona de projeto exige `--project-path`. O daemon recusa um prompt que contém um
  segredo, com saída `1`.
- **`remove <id> --scope host|project`:** apaga a persona desse escopo.
- **`reset <id>`:** devolve uma persona do pacote ao que veio; a edição do host some.
- **`publish-agent <id> --project-path <pasta>`:** grava a persona como o agente do projeto
  `.claude/agents/persona-<id>.md`. Altera um arquivo do projeto, então recusa com saída `1` e não envia
  nada até você passar `--confirm`.
- **`trust <id> --project-path <pasta> --hash <hash>`:** confia numa persona de projeto versionada, e o
  texto dela passa a chegar a todas as sessões do projeto. `--hash` é o começo (12 ou mais caracteres
  hexadecimais) do hash que `persona list` mostrou: se o arquivo mudou desde então, o comando recusa com
  saída `1` e diz o novo hash, para você ler de novo. Uma persona que já é confiável fica como está.

Uma alteração que fica sem resposta sai com `2` e diz que pode ou não ter sido feita: rode
`persona list` antes de tentar de novo.

`--project-path` indica a pasta do projeto (relativa a onde você roda); sem ele só contam as personas do
host. `--language en` ou `pt-BR` escolhe o idioma das personas do pacote. Com `--json` cada comando
imprime a resposta do daemon como um objeto JSON.

## fd rules e fd autoapprove

```sh
fd rules list --project api
fd rules list --json
fd autoapprove list
fd autoapprove list --project api --session <chave> --limit 20 --json
fd rules remove 'Bash(bun test:*)' --project api --confirm
fd autoapprove resume --session <chave> --confirm
```

`list` lê o que protege as sessões de um projeto, como a tela de Segurança; `remove` e `resume` o alteram.

- **`rules list`:** as regras de permissão que o projeto libera (`permissions.allow` do
  `.claude/settings.local.json`), uma por linha, exatamente como o arquivo as guarda (não são censuradas: uma regra que contém um segredo o mostra). `--project` é o nome ou o id do
  projeto; um host com um só projeto dispensa o `--project`. Com `--json` imprime a lista de regras. Um
  projeto sem regras avisa, e `--json` imprime uma lista vazia.
- **`autoapprove list`:** primeiro as sessões com a aprovação automática suspensa (receberam conteúdo de
  terceiros), depois as decisões do aprovador automático, a mais nova primeiro: a hora, `allow` ou `ask`, o
  risco, a ferramenta, a chave da sessão, quem decidiu (`rule` ou `ai`) e por quê. `--project` deixa só as
  decisões de um projeto e `--session` as decisões e a suspensão de uma chave de sessão; `--limit` lê de 1 a 1000 decisões. Com `--json` imprime a
  resposta do daemon, `decisions` e `suspended`. Um segredo que o aprovador citou num motivo é cortado.
- **`rules remove <regra> --confirm`:** remove uma regra do `permissions.allow` do projeto, mantendo o resto
  do arquivo. Passe a regra exatamente como o `rules list` a imprimiu, entre aspas. Recusa com saída `1` e não
  envia nada até você passar `--confirm`, e recusa uma regra que o projeto não tem. Imprime quantas regras
  sobraram; com `--json`, as regras que sobraram.
- **`autoapprove resume --session <chave> --confirm`:** liga de novo o aprovador automático de uma sessão
  que foi suspensa depois de receber conteúdo de terceiros. Recusa com saída `1` uma sessão que não está
  suspensa. Com `--json` imprime as sessões que continuam suspensas.

Uma mudança que fica sem resposta sai com `2` e avisa que pode ou não ter sido feita: rode `rules list` ou
`autoapprove list` antes de tentar de novo. Rodados no shell de uma sessão, `rules remove` e
`autoapprove resume` são classificados como comandos de risco alto.
