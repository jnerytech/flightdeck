# Glossário

Um termo, um nome, nos dois idiomas. Os dicionários (`apps/desktop/src/i18n/pt-BR.ts` e `en.ts`)
seguem esta tabela, e o teste `textos` reprova texto visível fora deles.

| Português | English | Quando |
| --- | --- | --- |
| Aprovar | Approve | Pedido de permissão e gate de workflow: sempre o mesmo verbo |
| Negar | Deny | O oposto de Aprovar, também nos gates (o motivo só aparece depois) |
| Precisa de você | Needs you | O estado de uma sessão que espera uma resposta, a tela e o contador da barra lateral |
| sessão do terminal | terminal session | Uma sessão aberta fora do Flightdeck, no terminal, vista pelos hooks |
| sessão do Flightdeck | Flightdeck session | Uma sessão que o próprio app criou e controla |
| card | card | O item do board, com a sua worktree e as suas execuções |
| Vigiar e consertar | Watch and fix | O interruptor do card com PR aberto: o daemon vigia o PR e conserta o que piorou |
| rodada | round | Uma tentativa de conserto de um PR: a sessão corrige, os checks locais passam e o push acontece |
| board | board | O quadro de cards de um projeto |
| workflow | workflow | Uma sequência de etapas (agente, check, gate) de um card |
| gate | gate | A etapa de um workflow que espera a aprovação de uma pessoa |
| host | host | A máquina onde roda o `flightdeckd` |
| daemon | daemon | O `flightdeckd`, o serviço de cada host |
| histórico | history | As conversas já gravadas pelo Claude Code, que o app só lê |
| cota | quota | O limite do plano, em janelas de 5 horas e de 7 dias |
| conta | account | A conta do Claude em que o `claude` do host está conectado; o app só mostra, nunca pede login |
| janela do plano | plan window | Um dos limites da conta (5 horas, 7 dias): a porcentagem usada e quando reinicia |
| snippet | snippet | Um comando ou prompt salvo, com variáveis `{{nome}}`; global (do app), do host ou do projeto |
| persona | persona | Um papel de engenharia que o Claude assume numa sessão; do pacote, do host, do projeto ou global (do app) |
| memória | memory | A memória automática do Claude Code de um projeto (`MEMORY.md` e um arquivo por tópico); só é editada por uma ação explícita, com hash e confirmação |
| orçamento de contexto | context budget | O que entra no contexto na partida de uma sessão, fonte por fonte, com uma estimativa de tokens |
| plugin | plugin | Uma extensão do Claude Code (hooks, monitores, skills, agentes, comandos, MCP); roda código na máquina, por isso se mostra o que instala antes |
| fixar versão | pin version | Impede a atualização de um plugin até a pessoa soltar |
| N sessões anteriores | N earlier sessions | O botão de um projeto que guarda as sessões encerradas e do histórico; o projeto abre com as ao vivo |
| Desenvolvedor | Developer | A persona do pacote que escreve o código; padrão das executoras de um time e sugerida no card |
| árvore do projeto | project tree | Em Projetos, na barra lateral: os branches de cada projeto (o principal e os worktrees dos cards); escolher um reduz o board e as Sessões a ele |
| pacote | pack | As personas que vêm prontas com o Flightdeck; editada, vira "Pacote, editada" |
| Aplicar persona | Apply persona | Manda o papel a uma sessão já aberta, como instrução da conversa; "Voltar ao normal" encerra |
| subagente persona | persona subagent | Uma persona oferecida ao Claude como agente `persona-<id>`, para ele delegar |
| destino SSH | SSH destination | Um servidor cadastrado em Conexões (host, porta, usuário, autenticação, etiquetas); a tela se chama Conexões / Connections |
| chave do servidor | server key | A chave que o servidor SSH mostra; o app guarda o fingerprint e bloqueia se ele mudar |
| cofre | vault | Onde ficam os segredos (chaves SSH, senhas, tokens, variáveis de ambiente), no cofre de credenciais do sistema |
| segredo | secret | Um item do cofre: o valor fica no cofre do sistema e o app só lista nome, tipo e etiquetas |
| frase-senha | passphrase | A frase que cifra o backup `.fdvault`; pelo menos 12 caracteres |
| turno | turn | One message of the user and the agent's whole answer to it; the timeline lists them |
| linha do tempo | timeline | The side panel of a session with its turns, what each changed in the files, and the rewind and fork actions |
| Voltar arquivos | Rewind files | Puts the repository's files back to how they were before a turn; files only, never external commands; it can be undone |
| Desfazer volta | Undo rewind | Brings the files back to how they were just before the last rewind |
| Bifurcar | Fork | A new conversation that starts from a turn of another; the original stays as it is |
| snapshot | snapshot | The git copy of the working tree taken at the start and end of a turn; it never touches the user's index or files |
| agente | agent | In "Agente de {project}", the project's configuration for Claude Code: MCP servers, CLAUDE.md, agents and skills |
| só leitura | read-only | What Flightdeck shows but never writes: the user's `~/.claude` and `~/.claude.json` |
| risco (baixo, médio, alto) | risk (low, medium, high) | O selo de um pedido de permissão; nunca `low`, `medium` e `high` na tela |
| segurar para aprovar | hold to approve | O Aprovar de um pedido de risco alto: o botão tem de ficar pressionado por 2 segundos |
| aprovado automaticamente | approved automatically | Um pedido aprovado por regra ou pela IA, sem a pessoa; a linha diz quem decidiu e o motivo |
| issue | issue | Um item do GitHub ou do Azure Boards listado no painel Issues do board; **Criar card** faz um card a partir dela |
| automação | automation | Um gatilho (horário, comentário no PR, checks do PR que falharam, issue com rótulo) que dispara uma ação; nasce desligada |
| arena | arena | O mesmo pedido de um card rodando em 2 a 4 variantes, para comparar e escolher |
| variante | variant | Uma das execuções de uma arena, com a própria worktree, branch, modelo e esforço |
| aba | tab | A screen open in the window, with its own back and forward history; it can be pinned and moved to the other area |
| área | area | One of the two halves of a split window, each with its own tab bar |
| Não lida | Unread | The badge of a session tab that answered while no tab showed it |
| terminal embutido | embedded terminal | A real shell on the host, opened by the daemon and shown in a tab, with no SSH |
| Desanexar | Detach | Closes the terminal's tab and leaves the process running on the host |
| Encerrar processo | End process | Closes the terminal's tab and ends the process |
| Claude aqui | Claude here | `flightdeckd claude` in a terminal tab, in a folder, a project or a card's worktree; the session is controllable from the app |
| run.yaml | run.yaml | The file `.flightdeck/run.yaml` of the base branch that declares a project's setup, processes and ports; it runs only after the user trusts its hash |
| Run | Run | Starts a card's run environment: the setup once, then each process in a terminal tab |
| Stop | Stop | Ends a card's processes and everything they started |
| bloco de portas | port block | The 10 ports a card holds, from `run.portBase`, until it is done |
| Preview | Preview | The tab that shows a card's running app in a frame, only on 127.0.0.1 and localhost |
| ação | action | A command declared with places for vault secrets and parameters; Claude calls it by name and never receives the secret |
| confiada | trusted | An action whose declaration and executed files the user accepted; a change asks again |
| execuções | runs | The history of an action: who asked, exit code, duration and the masked output |
| regra de uso | usage rule | One rule of a secret: who, for what and when it may be used; the first that matches decides |
| teto | ceiling | What no rule may loosen: allow for run_with_secret, or allow for a prod secret without a window |
| janela | window | Days and hours, on this computer's clock, when a rule decides; outside it another decision holds |
| Conversas | Conversations | The screen with the messages between sessions, of every host with messaging |
| Mensagens | Messages | A session's tab with what it sent to and received from other sessions |
| time | team | A coordinator session and its workers, each worker in a card; the screen is Times / Teams |
| coordenadora | coordinator | The session of a team that splits the goal, dispatches, checks and integrates |
| executora | worker | A session of a team that does one task in its own card |
| nome padrão | standard name | `project · persona · number`, the name every session gets; the number is never reused |
| apelido | alias | `project-persona-number`, the address of a session in messages; a rename adds one and keeps the old |
| Retorno sobre o custo (estimativa) | Return on cost (estimate) | (value − cost) / cost, with the value typed by the person (hours × hourly rate, plus what was billed); never called profit or savings |
| Valor estimado | Estimated value | Estimated hours times the hourly rate, plus the amount billed; an estimate, not a measurement |
| Horas estimadas | Estimated hours | The hours a done card is worth: the card's own, else the project's default; typed, not measured |
| trabalho entregue | delivered work | Cards done and PRs merged in the period, from the host's own records, split into planned and unplanned |
| planejado | planned | A card that was already on the board when the period began and was done inside it |
| não planejado | unplanned | A card created and done inside the same period |
| pessoa | person | A named group of hosts the app keeps, with a monthly token and/or cost limit; a view, never a ranking |
| laço | loop | A pair of sessions messaging back and forth too fast; the host pauses the pair and tells you |
| Soltar o par | Free the pair | Lets a pair paused for a loop talk again, in Needs you and in Settings |
| exceção | exception | A pair (by session, project, team or host) allowed to talk beyond the default, one way or both |
| Tempo | Time | A session's tab with the timeline of its prompts: tools, permission waits, API requests and errors (OTLP telemetry) |
| Tempo por projeto | Time per project | The panel of Costs with the permission wait and the slowest tools of each project |
| telemetria | telemetry | The OpenTelemetry (OTLP) Claude Code exports; the daemon receives it locally and keeps timings, never text |
| espera por permissão | permission wait | How long Claude waited for you to answer a permission: the gap before your answer, an estimate |
| Rastro | Trace | A session's tab with the tree of its turns, tool calls and subagents, with time, cost and tokens |
| Replay | Replay | The trace walked one node at a time, with play, pause and a speed |
| mais caro | costliest | The turn or subagent of a trace that cost most |
| mais lento | slowest | The tool call or subagent of a trace that took longest |
| Segundo plano | Background | A Claude Code session with no terminal (`claude --bg`), listed by `claude agents`; the origin of its rows in Sessions |
| Trazer para o terminal | Bring to the terminal | `claude attach <id>` in a terminal tab of the host |

## Estados de uma sessão

| Português | English |
| --- | --- |
| rodando | running |
| precisa de você | needs you |
| ociosa | idle |
| encerrada | ended |

## Modos de permissão

O valor técnico do modo nunca aparece na tela: só o nome e uma linha de explicação.

| Valor | Nome | Explicação |
| --- | --- | --- |
| `default` | Padrão / Default | pergunta antes de agir / asks before acting |
| `acceptEdits` | Aceitar edições / Accept edits | edita arquivos sem perguntar / edits files without asking |
| `plan` | Planejar / Plan | só lê e propõe um plano / only reads and proposes a plan |
| `auto` | Automático / Automatic | um classificador decide o que segue / a classifier decides what goes on |
| `dontAsk` | Só o permitido / Allowed only | nega o que as regras não liberam / denies what the rules do not allow |
| `bypassPermissions` | Sem perguntas / No questions | executa tudo, sem pedir aprovação (aviso em vermelho) / runs everything without asking (red warning) |

## Termos que não aparecem na tela

`bypassPermissions`, `acceptEdits`, `dontAsk`, `allowedRoots`, `subtype`, `claudeSessionId`,
`awaiting_permission`, `needs_you` e `pendingPermissions`. O teste `textos` varre as telas
principais atrás deles.

## Modo simples (fase 33)

As palavras que o modo simples põe no lugar das do modo completo (`apps/desktop/src/i18n/simple.ts`):

| Modo completo / Full mode | Modo simples / Simple mode |
| --- | --- |
| sessão / session | tarefa / task |
| Precisa de você / needs you | esperando a sua resposta / waiting for your answer |
| persona | estilo / style |
| pedido de permissão / permission request | pergunta / question |
| encerrar a sessão / end session | parar a tarefa / stop the task |
| host / projeto | computador / pasta (computer / folder) |
| custo, tokens, orçamento / cost, tokens, budget | escondidos; quando um orçamento para a tarefa: "Esta tarefa parou: o limite de gastos foi atingido." |

### Termos que não aparecem no modo simples

Nome de ferramenta, JSON, id de sessão, nomes de worktree e de branch, hooks, MCP, plugins, cofre,
nomes de modo de permissão, terminal, "Continuar no terminal" e "Copiar comando". A lista que o
teste `simple-vocabulary` varre está em `apps/desktop/src/lib/simple-words.ts` (as duas línguas).

## Domains

The domain folders of the code (#1600), one word each: `apps/daemon/src/<folder>`, later
`apps/desktop/src/features/<folder>` and `packages/protocol/src/<folder>`. The same domain keeps
the same folder name in every app. The context map that groups them and draws their borders is
`docs/decisions/2026-11-10-context-map.md`; `scripts/test/guards/domain-glossary.test.ts` fails on a
folder with no row here. Folders still named after a layer (`server`, `store`, `bg`) are in that
test's baseline, with the issue that renames them.

| Folder | Domain | What it owns |
| --- | --- | --- |
| `account` | account | The Claude account the host's `claude` is signed in to, shown and never asked for |
| `actions` | action | Declared commands with places for vault secrets, their trust and their runs |
| `activity` | activity | What happened on the host since a time, read from what the daemon already keeps |
| `agentcfg` | agent | A project's Claude Code configuration: MCP servers, CLAUDE.md, agents and skills |
| `appupdate` | app update | The app's own signed update: the check, the download in the background, the install, and the one on quit |
| `assistant` | assistant | The host's assistant: checks a request, writes a commit message or a PR text |
| `automations` | automation | Triggers (time, PR comment, failing checks, labeled issue) and the action each fires |
| `background` | background session | Claude Code's own background sessions of a host (`claude --bg`): list, stop, respawn, message, attach and start |
| `backup` | backup | The whole-app backup file (settings, hosts, vault): saved encrypted, read from a file or Google Drive, compared with this profile and restored; the daemon's own is `maintenance` |
| `board` | board | A project's cards, their columns, launches, PR flow, blockers and arenas |
| `boardsync` | board sync | Two-way sync of a board with an external board (GitHub Projects, Azure Boards) |
| `central` | terminal session | Terminal sessions seen through Claude Code's hooks: the receptor, the hooks, the wrapper |
| `checkpoints` | snapshot | The git snapshots of each turn, rewind files and fork |
| `cli` | command line | The `flightdeckd` command line: its words, flags and usage, parsed with no effect |
| `clients` | client | The clients that group projects across hosts: their rules, colors, month budget, hourly rate and defaults, the switcher that scopes the app, the selection the work screens filter by (kept across starts) and the client of each project |
| `costs` | cost | Estimated costs from the transcripts, price table, budgets and the status line |
| `deps` | dependency | The tools a host needs (git, gh, claude...), probed and reported |
| `files` | file | The files of a session or a card: the explorer, the search, the viewer, a session's files tab and a card's files panel |
| `github` | GitHub | `gh` on a project: login, status, alerts, start a PR |
| `harness` | harness | A project's Markdown harness shared as a host template |
| `history` | history | The conversations Claude Code already recorded, indexed and read only |
| `home` | home | The landing screen: KPIs, sparklines and leaderboards over the chosen scope and period; also the simple mode's home, task and settings views |
| `hosts` | host | The machines the app talks to: what each reports about its health (dependencies and doctor), then its saved list and connection |
| `inbox` | notification | The notification center: what the app sent, kept for the bell, read and unread, the taskbar badge, the system toast and the sound |
| `issues` | issue | GitHub and Azure Boards issues of a project, through their CLIs |
| `kernel` | shared kernel | The daemon's small helpers every domain uses and that know no domain: running a command, finding an executable, the daemon error and its refusals, writing a file atomically, reading a regular file, parsing JSON text, ids, the logger shape, the daemon version, queues, line reading, text trims, a child's environment, NTFS names, path containment and the allowed working folder (#1594) |
| `knowledge` | library | A project's document library and what a session is given from it |
| `logs` | log | The daemon's own log files: rotation, scan and serve |
| `maintenance` | maintenance | Backup and retention of the daemon's data |
| `memory` | memory | Claude Code's auto memory of a project, edited only by an explicit action |
| `messaging` | message | Messages between sessions, their policy, loops and exceptions |
| `names` | standard name | The display name and alias of every session |
| `needs-you` | needs you | The sessions that wait for an answer: the screen and its rows, and the summary of what happened while the person was away |
| `notifications` | notification | Which events notify, quiet hours, the sound and the preferences screen that sets them |
| `palette` | palette | The command palette and the global search: the box, its sections and scope chips, and what a choice opens |
| `pairing` | pairing | How the app reaches this daemon the first time: the address in the pairing link, its QR code, the Tailscale IP and the token rotation |
| `permissions` | permission | Permission requests, risk, auto-approval and the rules behind them |
| `personas` | persona | Engineering roles a session takes, the pack and their storage |
| `plugins` | plugin | Claude Code plugins of the host, through the `claude plugin` CLI |
| `power` | keep awake | Keeps the computer awake while sessions run |
| `projects` | project | The projects of a host: add, find and start from GitHub, the sidebar tree, the Projects and Project screens, the overview and the session tiles |
| `quota` | quota | The plan's 5-hour and 7-day windows and the queue they hold |
| `releases` | release | The product's GitHub releases, read and cached |
| `resources` | resources | The host's CPU and memory, per process, and the memory gate |
| `review` | review | The changes of a session or card: files, diff, comments, commit and PR |
| `roi` | return on cost | Delivered work, its estimated value and the return on cost |
| `runenv` | run environment | A card's `run.yaml`: setup, processes, port block and Preview |
| `runtime` | runtime | The engines that run a session: the Claude Code SDK and OpenCode over ACP |
| `service` | service | Installs, updates and removes flightdeckd as an OS service (systemd, Task Scheduler), with its stable binary and the user's PATH |
| `sessions` | session | The Flightdeck sessions of a host: start, state, stall and sleep |
| `settings` | setting | The app's own choices on this machine: tray, autostart, global shortcut, update and preview switches |
| `setup` | setup | The first-day setup screen: the steps a person does in order (host, hooks, project, first session) and the one to do next |
| `shell` | shell | The app's frame: the page shell with its header slot, the top bar, the breadcrumb, the status bar, the quota bars, the scope menu and the account footer |
| `shortcuts` | keyboard shortcut | The `?` sheet that lists every shortcut of the registry, by group |
| `snippets` | snippet | Saved commands and prompts with `{{name}}` places, and their use |
| `ssh` | SSH destination | SSH destinations, server keys, key delivery and the ssh runs of actions |
| `summary` | summary | A short summary of a session built from its transcript, with no model call |
| `tabs` | tab | The strip of open tabs: each tab's title, icon, badge, host color and the words a screen reader gets |
| `teams` | team | A coordinator session and its workers, started together |
| `telemetry` | telemetry | Claude Code's OTLP export, received locally: timings, never text |
| `teleport` | teleport | Moves a session with its work to another host |
| `templates` | template | The task templates of simple mode and the presets they start with |
| `terminal` | embedded terminal | Real shells on the host behind a PTY, attached by the app |
| `trace` | trace | The tree of a session's turns, tool calls and subagents, with time and cost |
| `tray` | tray | The tray badge, its "needs you" submenu and the window title, and the answers given from the submenu |
| `trust` | trusted | What a project's own files would load, read without running, and its trust |
| `updates` | update | Checks, verifies and applies the daemon's signed updates |
| `vault` | vault | Secrets in the OS store, their usage rules, windows and requests |
| `viewprefs` | view preferences | How the person left the windows on this computer: list width, sidebar and tree folds, hub view and filter, tile layout, the board last opened |
| `watch` | watch and fix | The rounds that watch a PR and fix what got worse |
| `webhook` | webhook | Posts the app's events to a webhook URL, kept as a secret |
| `workflows` | workflow | A card's steps (agent, check, gate), their engine and findings |
| `worktrees` | worktree | A card's git worktree and branch, locks and cleanup |
| `wsl` | WSL | A host that runs inside WSL, and the distros whose daemons a Windows host keeps running |
