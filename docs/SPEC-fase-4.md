# Flightdeck — Spec da Fase 4 (Board)

## Objetivo e escopo

A Fase 4 transforma tarefas em cards: cada card roda numa worktree própria, anda sozinho pelas colunas conforme o agente trabalha e termina num PR.

Pré-requisito: Fase 3 fechada.

**Dentro da Fase 4**

- Projetos (repositórios git) cadastrados por host, cada um com seu board.
- Cards com título e descrição; iniciar um card cria branch, worktree e sessão.
- Colunas atualizadas pelos eventos da sessão e do PR, com movimento manual permitido.
- Revisão do diff no app, pedido de ajuste e abertura de PR.
- Provedores de PR: GitHub (via `gh`) e Azure DevOps (via `az repos`).
- Fila por host para limitar quantos cards rodam ao mesmo tempo.
- Limpeza segura da worktree quando o card termina.

**Fora da Fase 4**

- Etapas encadeadas, vários agentes por card e aprovações em gate (Fase 5).
- Merge feito pelo Flightdeck: o merge continua acontecendo no provedor.
- Board compartilhado entre hosts ou entre pessoas.
- Importar issues do GitHub ou work items do Azure DevOps.

## Design

O board mora no daemon do host onde o repositório está; o card é só uma camada sobre o que já existe: branch, worktree, sessão e PR.

### Projetos

Cada projeto registra: caminho do repositório (dentro de `allowedRoots`), branch base, provedor de PR (`github`, `azure-devops` ou `none`), script de preparação opcional (por exemplo `bun install`) e um modelo de instruções anexado ao prompt de todo card. O script de preparação é o único comando de shell que o Flightdeck executa por conta própria, e só existe se o usuário o cadastrar no projeto.

### Ciclo do card

1. **Criar:** título e descrição; o card nasce em Backlog.
2. **Iniciar:** `git worktree add <repo>/.flightdeck/worktrees/<slug> -b fd/<slug> <base>`, com `.flightdeck/` adicionado a `.git/info/exclude` (o `.gitignore` do projeto não é tocado). Roda o script de preparação, se houver, e abre uma sessão com `cwd` na worktree e prompt = descrição + modelo do projeto. O modelo padrão pede para trabalhar só nessa worktree e fazer commits com mensagens descritivas.
3. **Trabalhar:** a sessão é uma sessão normal do Flightdeck; tudo das fases anteriores vale (chat, aprovações, replay).
4. **Revisar:** diff de `git diff <base>...HEAD` mais alterações não commitadas, por arquivo.
5. **Ajustar:** mensagem enviada à mesma sessão a partir do card.
6. **Abrir PR:** `git push -u origin fd/<slug>`, depois `gh pr create` ou `az repos pr create` com título e descrição do card.
7. **Concluir:** PR mesclado ou marcação manual; a worktree é removida se não houver alteração pendente, senão o card avisa e espera.
8. **Descartar:** remove worktree e branch local, sempre com confirmação.

Um card pode ter várias execuções (recomeçar com sessão nova); a mais recente é a ativa.

### Colunas automáticas

| Evento | Coluna |
| --- | --- |
| card criado | Backlog |
| iniciado, aguardando vaga na fila | Em andamento (selo "na fila") |
| sessão `starting` ou `running` | Em andamento |
| sessão `awaiting_permission` ou `error` | Esperando você |
| sessão `idle` após um turno | Em revisão |
| PR aberto | Em revisão (selo com estado do PR e dos checks) |
| PR mesclado | Concluído |
| PR fechado sem merge | Esperando você |

Mover um card à mão para Backlog ou Concluído trava a coluna até o próximo início; nas demais, o próximo evento volta a mandar.

### Fila

`maxParallelRuns` por host, padrão 2. Cards iniciados além do limite esperam em ordem de início e sobem quando uma execução termina, é interrompida ou fica `idle`. O limite existe para não esgotar a cota da assinatura com agentes em paralelo.

### PRs

- Interface `PrProvider` com `create`, `status` e `url`; implementações `GithubCli` (via `gh`) e `AzureDevOpsCli` (via `az repos`). Os dois CLIs precisam estar instalados e autenticados no host; o daemon só os invoca.
- Cards com PR aberto são consultados a cada 60 s (intervalo injetável nos testes): estado (aberto, mesclado, fechado) e situação dos checks.
- `gh`, `az` e `git` são procurados com `whichOnPath`, no PATH atual, para os substitutos falsos dos testes funcionarem.

### Dados

```sql
CREATE TABLE projects (id TEXT PRIMARY KEY, path TEXT UNIQUE, name TEXT, base_branch TEXT, pr_provider TEXT,
                       setup_script TEXT, prompt_template TEXT);
CREATE TABLE cards    (id TEXT PRIMARY KEY, project_id TEXT, title TEXT, description TEXT, board_column TEXT,
                       column_locked INTEGER, position REAL, slug TEXT, branch TEXT, worktree_path TEXT,
                       pr_url TEXT, pr_state TEXT, checks_state TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE card_runs (card_id TEXT, session_id TEXT, queued_at TEXT, started_at TEXT, ended_at TEXT,
                        PRIMARY KEY (card_id, session_id));
```

### Protocolo (só adições)

| Item | Tipo | Conteúdo |
| --- | --- | --- |
| `project.list` / `project.add` / `project.update` | comando | cadastro de projetos |
| `board.get` | comando | `projectId` → colunas com cards |
| `card.create` / `card.update` / `card.move` | comando | edição e movimento manual |
| `card.start` / `card.stop` | comando | inicia (ou enfileira) e interrompe |
| `card.diff` | comando | `cardId` → arquivos com hunks |
| `card.message` | comando | ajuste enviado à sessão ativa |
| `card.pr.create` | comando | push e abertura do PR |
| `card.complete` / `card.discard` | comando | conclusão e descarte, com `confirm: true` |
| `board.watch` | comando | passa a receber `card.updated` |
| `card.updated` | evento | card completo após cada mudança |

## App desktop

O board é a tela principal de cada projeto; a conversa da sessão continua um clique adiante.

- **Board:** cinco colunas (Backlog, Em andamento, Esperando você, Em revisão, Concluído), arrastar e soltar entre colunas e dentro delas, filtro por texto.
- **Card no board:** título, selo de status da sessão, selo "na fila", estado do PR e dos checks, e o host quando a visão juntar projetos de vários hosts.
- **Detalhe do card:** descrição editável, histórico de execuções, conversa da execução ativa (o mesmo componente de chat da Fase 1) e aba de diff.
- **Diff:** lista de arquivos com contagem de linhas, visualização lado a lado ou unificada, e marcação do que ainda não foi commitado.
- **Ações:** Iniciar, Parar, Pedir ajuste, Abrir PR, Concluir, Descartar; as duas últimas pedem confirmação e Descartar avisa se houver alterações não enviadas.
- **Projetos:** tela para cadastrar repositório, branch base, provedor de PR, script de preparação, modelo de instruções e `maxParallelRuns` do host.

## Disciplina TDD

Segue [`docs/TDD.md`](TDD.md): ciclo por área, travas e regras de evidência. A auditoria `bun run tdd:audit -- --since fase-3` (criada na Fase 2) confere a ordem dos commits e a ausência de testes desligados.

**Trava desta fase: CLIs de PR e remotos.** O preload de testes ganha sentinelas de `gh` e `az`, que reprovam a suíte se forem chamadas sem um falso instalado pelo próprio teste. No Windows, cada falso tem versão `.cmd`. Push só para remotos locais (`git init --bare` em pasta temporária); o teste confere a URL do remoto antes do push.

## Testes e critérios

Os testes usam git de verdade em repositórios temporários e substitutos falsos de `gh` e `az` colocados no PATH, que registram os argumentos e devolvem respostas fixas, com as travas de `docs/TDD.md` e a trava de CLIs ativas; nada é enviado a um remoto real.

**Áreas de teste (cada uma entra no TDD e na auditoria)**

| Área | O que precisa passar |
| --- | --- |
| `projetos` | cadastro valida caminho dentro de `allowedRoots` e repositório git; script de preparação só existe se cadastrado |
| `protocolo-board` | `board.get` devolve as colunas; `board.watch` recebe `card.updated` após cada mudança |
| `board-ui` | arrastar entre colunas move o card; filtro por texto; Concluir e Descartar pedem confirmação |
| `worktree` | iniciar cria branch `fd/<slug>` e a worktree a partir da base; `.flightdeck/` entra em `.git/info/exclude` e o `.gitignore` fica intacto |
| `preparacao` | script cadastrado roda na worktree antes da sessão; falha leva o card para Esperando você com o erro |
| `colunas` | cada linha da tabela de colunas automáticas move o card para a coluna certa; trava manual é respeitada |
| `fila` | com `maxParallelRuns: 1`, o segundo card espera e sobe quando o primeiro fica `idle` |
| `diff` | inclui commits desde a base e alterações não commitadas |
| `pr` | `gh` e `az` falsos recebem os argumentos esperados; estado mesclado leva a Concluído |
| `limpeza` | worktree limpa é removida ao concluir; com alteração pendente, não remove e avisa |
| `descarte` | sem `confirm: true` é recusado; com ele, remove worktree e branch local |

**Smoke (`bun run smoke:board`)**

Começa vermelho, roda com as travas ativas, cria um repositório temporário com um remoto local (`git init --bare`), cadastra o projeto com provedor `github` apontando para o `gh` falso, cria e inicia um card com o `FakeRuntime` configurado para criar um arquivo e commitar, espera Em revisão, confere o diff, abre o PR, simula o merge no `gh` falso e espera Concluído com a worktree removida. Imprime `SMOKE BOARD OK`.

**Critérios de aceite**

- [ ] Para cada área da tabela acima, a conversa mostra o teste falhando por asserção antes da implementação e passando depois.
- [ ] `bun run tdd:audit -- --since fase-3` imprime `TDD AUDIT OK`.
- [ ] `bun run typecheck`, `bun run lint` e `bun test` saem com código 0, com cobertura de 100%.
- [ ] Todos os smokes anteriores continuam passando e `bun run smoke:board` imprime `SMOKE BOARD OK`.
- [ ] `bun run build:daemon` e `bun run build:desktop` saem com código 0, e `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` também, no Windows nativo, se a casca Rust tiver mudado.
- [ ] README explica cadastro de projeto, provedores de PR e o limite de execuções paralelas.
- [ ] Divergências registradas em `docs/DECISIONS.md`, `git status` limpo e a tag `fase-4` criada.
