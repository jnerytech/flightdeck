# Workflows

[Voltar ao manual](../pt-BR.md) · [English](../en/workflows.md)

Um card pode rodar um workflow em vez de uma sessão só: uma sequência de etapas (agentes,
verificações, aprovações suas), com orçamento, acompanhada e aprovada pelo app.

## Declarar

Os workflows são arquivos `.flightdeck/workflows/<nome>.yaml`, versionados no próprio
repositório. O daemon sempre os lê da branch base do projeto (`git show <base>:<caminho>`). Um
workflow escrito pelo agente na branch do card nunca é usado.

```yaml
name: feature
inputs: [task]
budget: { maxTurns: 80, maxMinutes: 120, maxCostUsd: 15 }
steps:
  - id: plan
    agent: { prompt: "Planeje: {{inputs.task}}", permissionMode: plan }
  - id: approve-plan
    gate: { message: "Aprovar o plano?", show: "{{steps.plan.output}}" }
  - id: implement
    agent: { prompt: "Implemente este plano e faça commits:\n{{steps.plan.output}}" }
  - id: tests
    loop:
      max: 3
      until: { check: "bun test" }
      do:
        agent: { continue: implement, prompt: "Os testes falharam:\n{{loop.lastCheck.output}}" }
  - id: review
    parallel:
      - agent: { persona: security, prompt: "Revise o diff com foco em segurança." }
      - agent: { persona: reviewer, prompt: "Revise o diff com foco em legibilidade." }
  - id: pr
    pr: {}
```

| Etapa | O que faz |
| --- | --- |
| `agent` | Abre uma sessão na worktree do card. Com `continue: <id>`, manda a mensagem à sessão daquela etapa. Com `persona: <id>`, a sessão abre naquela persona. A saída é o texto do assistente no turno. |
| `check` | Roda o comando na worktree. Guarda o código de retorno e os últimos 8 KB da saída. Se o comando falhar, a execução falha. |
| `gate` | Pausa até você aprovar ou recusar, com nota opcional. A nota é a saída do gate. |
| `loop` | Roda o `check` do `until`. Enquanto ele falhar, roda o `do` (no máximo `max` vezes). Esgotado o `max`, a execução pausa. |
| `parallel` | Roda os itens ao mesmo tempo, dentro de `maxParallelRuns`. As saídas chegam em `outputs`, na ordem declarada. |
| `pr` | Faz o push e abre o PR pelo provedor do projeto. |
| `cards` | `cards: { from: <etapa agent> }` cria cards no Backlog com os achados da resposta dessa etapa. Veja abaixo. |

A interpolação aceita só `{{inputs.*}}`, `{{steps.<id>.output}}` (`outputs` num `parallel`) e
`{{loop.lastCheck.output|exitCode}}`, este dentro do `do` de um loop. Uma referência
desconhecida, um campo desconhecido, uma etapa sem `id` ou um `continue` para uma etapa que não
é um `agent` anterior são erros de validação. Um valor interpolado maior que 8 KB é cortado.

## Confiar

As etapas `check` rodam comandos de shell: `cmd.exe /d /s /c` no Windows e `sh -c` nos demais,
como o script de preparação. Por isso, cada workflow precisa ser confiado antes da primeira
execução. Na tela Projetos, **Workflows de &lt;projeto&gt;** lista os workflows da base com a
validação e os comandos `check`. **Confiar** mostra esses comandos e pede confirmação.

- **O que fica guardado:** a confiança guarda o hash (sha256) do arquivo.
- **Se o arquivo mudar na base:** o hash muda, e o workflow volta a pedir confiança.
- **Antes de cada check:** o daemon confere que o comando está literalmente no workflow da
  execução e que esse conteúdo continua confiado. Qualquer outro comando é recusado sem chegar
  ao shell.

## Criar cards com os achados de um agente

Uma etapa agent pode terminar a resposta com um bloco `json` cercado, uma lista de
`{ key, title, body }`, e uma etapa `cards` seguinte transforma a lista em cards no Backlog do
projeto. A etapa lê só o último bloco assim, e é rígida: um campo que não seja `key`, `title` ou
`body`, uma `key` que não seja um id simples de até 160 caracteres, um `title` de uma linha com até
160, um `body` de até 4000, um caractere de controle ou invisível, ou mais de 50 itens recusam a
lista inteira. Nada é criado e a execução falha com o motivo, que diz qual item e qual campo.

Um achado não é criado de novo quando um card do projeto já tem a mesma `key` (ou um concluído nos
últimos 30 dias), ou um card aberto tem o mesmo título, sem contar maiúsculas e espaços. Cada
execução cria no máximo 10 cards; a etapa diz quantos criou, quantos um card já cobria e quantos
passaram do limite. Os cards vêm marcados como texto do agente, mostram o selo externo e mantêm a
aprovação automática desligada, porque o que um agente lê em um repositório pode ter sido escrito
por qualquer pessoa.

## Executar de novo uma execução que falhou

Uma execução de workflow que falhou, ou que terminou porque o card foi parado, mostra **Executar de
novo** abaixo do motivo, no card. Ela inicia o card de novo com o workflow de mesmo nome como o arquivo está agora
(não como estava quando a execução começou) e as mesmas entradas, na branch do próprio card, com a
persona padrão da coluna, e a execução anterior continua no histórico do card. O botão
fica desligado, com o motivo ao lado e **Abrir Workflows** para a página de Workflows do projeto,
quando o problema é o arquivo: o workflow mudou desde que você confiou nele, tem erros, ou não está
mais na branch base. Se o host recusar o início, a recusa aparece no próprio lugar.

Uma execução que falhou também pode continuar de onde parou (#1266): **Executar de novo a partir
de <passo>** fica ao lado de **Executar de novo**. A mesma execução continua: os passos que
terminaram guardam a saída e não rodam de novo, um gate aprovado não é perguntado de novo, e o passo
que falhou roda do zero, com tudo o que vem depois. A execução do card espera uma vaga como qualquer
outra. Ela só é oferecida quando é seguro; senão, o motivo aparece abaixo de **Executar de novo**: o
workflow mudou desde a execução, a branch do card mudou desde que ela parou (um commit, reset ou rebase), o card
sumiu ou roda outra coisa, ou a execução terminou antes de o Flightdeck guardar onde o código
estava. Ela precisa de uma conexão próxima (este computador ou a Tailscale): por uma distante, esse é o
motivo mostrado, e só **Executar de novo** é oferecido.

## Modelos

Três workflows já vêm com o Flightdeck, para trabalho recorrente:

- **Varredura de dívida técnica:** lê o repositório (em modo de plano, nada é enviado) atrás de TODOs,
  APIs obsoletas e avisos de lint ou de segurança, e cria os 10 que mais importam como cards no
  Backlog. Para rodar toda semana, crie uma automação que inicie este workflow por horário.
- **Corretor de alertas:** pega um alerta de lint ou de segurança que você cola, corrige na branch
  do card com um teste (até 3 tentativas com o seu comando de teste), pergunta a você e abre o
  pull request.
- **Rascunho de post-mortem:** redige o post-mortem de um incidente (resumo, impacto, linha do
  tempo, causa, ações) em um arquivo Markdown, marca o que não conseguiu confirmar, pergunta a você
  e abre o pull request.

Os dois param em uma aprovação antes de enviar qualquer coisa e têm um orçamento de turnos e de
minutos. Com o pull request aberto, vale para ele o limite de rodadas do Vigiar PRs.

Para iniciar o corretor de alertas, inicie um card com ele e preencha o campo `alert`. **Escolher um
alerta**, ao lado do campo, lista os alertas abertos de code scanning e do Dependabot do repositório,
os mais graves primeiro, lidos pelo host com o próprio `gh` (só leitura; o Flightdeck não guarda token
do GitHub). Escolher um copia o texto dele para o campo: leia antes de iniciar, porque as palavras de
um alerta vêm de um scanner ou de um aviso. Uma fonte que não dá para ler (o code scanning está
desligado, ou o `gh` não tem acesso ou não está conectado) aparece citada ao lado da lista, e a lista
nunca diz "nenhum alerta aberto" quando uma delas falhou. O botão só aparece quando o host sabe ler
alertas.

**Post-mortem de um card que falhou.** Um card que parou com um problema, ou cuja execução de
workflow falhou, mostra **Redigir um post-mortem** no detalhe. Abre os fatos que o Flightdeck tem do
incidente: o card, o problema, os passos que falharam na execução e o resumo da sessão. São linhas
simples, cortadas e limpas, que você pode ler e editar. **Iniciar o post-mortem** cria um card novo,
"Post-mortem: <título>", e o inicia com o workflow Rascunho de post-mortem e esse texto; o card que
falhou não é mexido. O botão fica desligado, com um aviso, quando o projeto ainda não adicionou esse
workflow.

Um modelo é um arquivo. Na tela **Workflows**, **Adicionar de um modelo** lista os modelos. Abra
um para ler o arquivo. Depois, adicione de um destes dois jeitos:

- **Adicionar ao projeto** (num host a partir desta versão). O Flightdeck pergunta antes, faz o
  commit do arquivo em `.flightdeck/workflows/` numa branch nova, a partir da cópia da branch
  base no origin (os seus commits ainda não enviados ficam de fora),
  `flightdeck/workflow-<modelo>-<data>`, envia e abre um pull request para a branch base, como um
  card faz. **Ver o pull request** abre o PR. A branch base e o seu checkout não mudam: a sua
  branch atual, o seu índice e os arquivos não salvos ficam como estão. O commit usa o `user.name`
  e o `user.email` do repositório, e o projeto precisa de um provedor de PR. Um modelo cujo arquivo
  já está na branch base é recusado.
- **Copiar o arquivo**, e você mesmo faz commit em `.flightdeck/workflows/` na branch base.

Nos dois casos, quando o arquivo estiver na branch base, **confie** nele na mesma tela, como em
qualquer workflow: ele não roda antes disso. A linha `check` do corretor de alertas já traz o comando de teste do projeto
quando o Flightdeck consegue descobrir (`npm run test`, `cargo test`...). Quando não consegue, a
linha traz um texto provisório que falha de propósito: troque pelo seu comando de teste antes do
commit.
Se a área de transferência recusar a cópia, o diálogo avisa como alerta: selecione o texto do arquivo
mostrado ali e copie à mão. Um host sem modelos diz isso, em vez de mostrar uma lista vazia.

## Rodar e acompanhar

No detalhe do card, escolha o workflow (ou **Nenhum**, para o card simples), preencha os
`inputs` e clique em Iniciar.

- **Linha do tempo:** o detalhe mostra cada etapa com status, tentativa, duração e, num `agent`,
  os turnos e o custo estimado. Clicar abre a conversa da etapa ou a saída do `check`.
- **Gate aberto:** leva o card a Precisa de você e libera a vaga do host. Ele aparece no próprio
  card e em **Precisa de você**, com Aprovar, Recusar e nota.
  - Aprovado, a execução volta à fila do host e segue.
  - Recusado, termina como `rejected`.
- **Etapa `pr`:** leva o card a Em revisão. O merge leva a Concluído e fecha as sessões das
  etapas.
- **Reinício do daemon:** a execução retoma de onde parou.
  - Um agent no meio do turno retoma a sessão e reenvia o prompt, precedido de "A execução foi
    interrompida; continue de onde parou."
  - Um check roda de novo.
  - Um gate continua aberto.

## Orçamento de uma execução

`budget` limita a execução inteira, somando todas as suas sessões:

- **Turnos:** contados entre todas as sessões.
- **Minutos:** o tempo de relógio dos turnos.
- **Custo:** o que o SDK informa (`total_cost_usd`). Em assinatura, é uma estimativa útil como
  teto.
  - O valor é cumulativo por sessão: vale o último total de cada sessão.
  - Uma sessão retomada conta só a diferença.

O orçamento é conferido antes de cada turno. Estourado, a execução pausa em Precisa de você com
o motivo. Uma execução pausada não continua: inicie o card de novo. O medidor no detalhe do
card mostra turnos, minutos e custo estimado. (Não confundir com os [orçamentos em
US$](costs-budgets-and-quota.md#orçamentos) de host e de projeto.)

## O servidor MCP flightdeckd mcp

`flightdeckd mcp [--config <arquivo>]` é um servidor MCP stdio para o Claude Code do mesmo host.
Ele lê a config do daemon e conecta no daemon local pelo protocolo, com o token da config. Isso
deixa uma sessão do Claude criar cards e disparar workflows. Ferramentas:

- `list_projects` e `list_workflows`;
- `create_card` e `start_card` (com `workflow` e `inputs`);
- `get_card` e `get_run`;
- `move_card` (para `backlog`, `in_progress`, `waiting`, `review` ou `done`, pelas mesmas regras de
  arrastar um card no app), `update_card` (título, descrição), `comment_card` (acrescenta uma
  nota datada à descrição) e `finish_card` (`done` conclui o card, `discard` o descarta com a
  worktree e a branch).

Uma sessão gerencia só os cards do **próprio projeto**, e o próprio card quando não cita nenhum
(a sessão roda na worktree de um card); o card de outro projeto é recusado com o motivo. O quadro
no app atualiza ao vivo. `finish_card` com `discard` não tem volta, então sempre pede a sua
aprovação na sessão: a aprovação automática nunca o aprova, e não se oferece "permitir sempre"
para ele.

Não há ferramenta para aprovar permissões nem para responder gates: isso fica só com você, no
app. Para registrar no Claude Code:

```sh
claude mcp add flightdeck -- flightdeckd mcp
```

As sessões que o próprio Flightdeck abre (coordenadora e executoras de um time, cartões do quadro e
sessões comuns) já recebem esse servidor, sem configurar nada: o daemon o junta à sessão, ao lado
dos seus servidores MCP. O comando acima só é preciso para um `claude` aberto num terminal fora do
Flightdeck. A linha "Ferramentas do time" do Doutor avisa quando o programa do daemon não está mais
onde as sessões esperam.

## O comando flightdeckd card

`flightdeckd card` conduz o quadro de um terminal, de um alias do git, de um cron ou de um passo de
CI. Ele fala com o daemon do mesmo host, com o token do arquivo de config, como o servidor MCP
acima. O daemon aplica as mesmas regras do app: a fila, as retenções e os limites.

```sh
flightdeckd card list [--project <nome ou id>] [--json]
flightdeckd card show <card> [--json]
flightdeckd card new "<título>" [--project <nome ou id>] [--description <texto>] [--json]
flightdeckd card start <card> [--workflow <nome>] [--json]
flightdeckd card move <card> <coluna> [--position <n>] [--force] [--json]
flightdeckd card update <card> [--title <texto>] [--description <texto>] [--estimate <horas|none>]
  [--validation-note <texto|none>] [--spec-path <caminho|none>] [--blocked-by <ids|none>] [--json]
flightdeckd card stop <card> [--json]
flightdeckd card complete|discard|delete <card> --confirm [--json]
flightdeckd card diff <card> [--json]
flightdeckd card spec <card> [--json]
flightdeckd card review <card> [--language en|pt-BR] [--json]
flightdeckd card message <card> "<texto>" [--json]
flightdeckd card templates [--project <nome ou id>] [--json]
flightdeckd card validation-template <card> [--json]
flightdeckd card pr-create <card> [--title "<texto>"] [--description "<texto>"] [--json]
flightdeckd card update-from-base <card> [--json]
flightdeckd card merge-local <card> --confirm [--squash] [--message "<texto>"] [--json]
```

- `list` imprime uma linha por card (projeto, id, coluna, título e por que um card espera). Sem
  `--project` lista todos os projetos. `--project` aceita um id ou um nome; um host com um só
  projeto dispensa `--project` no `new`.
- `start` de um card que precisa esperar diz por quê (vaga livre, cota do plano, memória do host,
  orçamento, host pausado, cards de que ele depende) e sai com 0: o card fica na fila.
- `move` recebe uma coluna (`backlog`, `in_progress`, `waiting`, `review` ou `done`) e, como arrastar
  um card no app, é recusado quando o contrato da coluna não é cumprido; `--force` move assim mesmo e o
  card guarda um aviso. `--position` é o lugar na coluna, a partir de 0.
- `update` muda só os campos que você passa. `none` limpa a estimativa, a nota de validação, o caminho
  da spec e os bloqueios; `--blocked-by` recebe uma lista de ids separados por vírgula. Sem nenhum
  campo ele recusa e não envia nada.
- `stop` para a execução do card. `complete`, `discard` e `delete` não têm volta, então cada um exige
  `--confirm`; sem ele o comando sai com 1 e não envia nada. `delete` só remove um card que nunca
  começou (use `discard` para um que começou).
- `diff` imprime as mudanças do card como o git faz: um cabeçalho por arquivo e depois os trechos. Um
  arquivo que pode guardar uma credencial, um binário e um grande demais aparecem sem linhas. O texto
  mostra a tabulação como espaço; `--json` mantém o texto exato. `spec` diz onde está o arquivo de spec
  do card e se ele foi encontrado.
- `review` pede a um modelo uma segunda opinião sobre o diff do card, como o botão do app: pode levar
  alguns minutos (o comando espera até 5), pode mover o card, e uma revisão que falhou sai com 1. Os
  achados sem uma linha alterada são impressos; os outros viram comentários de revisão no app.
  `--language` é o idioma dos achados.
- `message` envia o texto à sessão do card (o mesmo que `flightdeckd send`); se a sessão está
  trabalhando, o texto entra na fila e é lido depois do turno dela.
- `templates` lista os modelos de card de um projeto (`.flightdeck/templates/cards.json`), e
  `validation-template` imprime o formato próprio do projeto para uma nota de validação, ou diz por que
  ele não foi usado.
- `pr-create` envia o branch do card e abre o pull request com o título e o texto do card, ou com
  `--title` e `--description`; um texto que parece ter um segredo é recusado. O link é impresso.
- `update-from-base` faz o rebase do branch do card sobre a base; num conflito ele para e deixa o
  worktree como estava (saída 1).
- `merge-local` é para um card sem pull request: junta o card na base (um commit de merge, ou um só
  commit com `--squash`), remove o worktree e o branch dele e o move para Concluído. Não dá para
  desfazer, então exige `--confirm`; `--message` é a mensagem do commit. O shell de uma sessão que o
  roda fica retido até o sim da pessoa, como no `discard`.
- `--json` imprime a resposta para um script.
- **Códigos de saída:** 0 feito, 1 recusado (o motivo vai para o stderr, com o código do daemon), 2
  sem daemon (parado, ou mudo por 15 s; 5 minutos no `review`).
- **O token** vem só do arquivo de config: `--token` é recusado e o ambiente não é lido. Ele nunca
  é impresso. O comando fala só com um daemon no loopback (`127.0.0.1` ou `::1`); um daemon ligado a
  outro endereço é recusado. Como no `flightdeckd mcp`, o token vai para o que estiver escutando
  naquela porta local, então mantenha o daemon rodando ao usar o comando.
- Com `--json` a resposta é JSON no stdout, mas um erro continua sendo uma linha de texto no stderr.
