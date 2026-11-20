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

## fd persona

```sh
fd persona list
fd persona list --scope project --project-path ~/work/api --language en
fd persona show architect
fd persona subagents --project-path ~/work/api --json
```

Lê as personas deste host, como a tela Personas faz. Nada aqui altera uma persona.

- **`list`:** uma linha por persona: o id, onde ela mora (`pack`, `host` ou `project`), o nome,
  `(edited)` para uma persona do pacote que este host alterou e, para uma persona de projeto, o começo do
  hash e `not trusted` até o hash ser confiado. Uma última linha nomeia os arquivos do projeto que ficaram
  de fora e o motivo. `--scope` mantém só `host`, `project` ou `all` (o padrão).
- **`show <id>`:** a persona com a descrição, o modelo, o esforço, as ferramentas e o modo de permissão
  que ela define, e o seu prompt. Diz de onde a persona veio. Um id que o daemon não conhece é recusado
  com saída `1`.
- **`subagents`:** os agentes que uma sessão do projeto recebe (`persona-<id>`) e as personas de projeto
  deixadas de fora porque ninguém confiou nelas ainda.

`--project-path` indica a pasta do projeto (relativa a onde você roda); sem ele só contam as personas do
host. `--language en` ou `pt-BR` escolhe o idioma das personas do pacote. Com `--json` cada comando
imprime a resposta do daemon como um objeto JSON.
