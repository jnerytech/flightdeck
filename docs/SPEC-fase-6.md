# Flightdeck — Spec da Fase 6 (Workflows)

## Objetivo e escopo

A Fase 6 troca "um card, uma sessão" por workflows: um card executa uma sequência de etapas (agentes, verificações e aprovações suas), com orçamento, acompanhada e aprovada pelo app desktop.

Pré-requisito: Fase 4 fechada. A Fase 6 é desenvolvida em paralelo à Fase 5, num worktree próprio (branch `fase-6`, criada a partir da tag `fase-4`), e é rebaseada sobre a tag `fase-5` antes de fechar.

**Dentro da Fase 6**

- Workflows declarados em YAML no próprio repositório.
- Motor de execução com etapas de agente, verificação, aprovação, repetição e paralelismo.
- Orçamento por execução (turnos, tempo, custo informado pelo SDK).
- Servidor MCP local do Flightdeck, para uma sessão do Claude criar cards e disparar workflows no host.
- Linha do tempo, gates, orçamento e tela de workflows no app desktop.

**Fora da Fase 6**

- Hub, despacho automático entre hosts e escolha de host por rótulos: o card roda no host do projeto, escolhido no app.
- Celular, PWA e notificações push: o produto é desktop.
- Agentes que não sejam o Claude Code.
- Agendamento por horário (cron) de workflows.

## Design

O workflow roda no daemon que tem a worktree do card; o app continua conectando direto em cada host, como desde a Fase 2.

### Workflows

Arquivos `.flightdeck/workflows/<nome>.yaml` no repositório, lidos da branch base com `git show <base>:<caminho>` (nunca da worktree do card). A pasta `.flightdeck/workflows/` é versionada; só `.flightdeck/worktrees/` fica em `.git/info/exclude` (Fase 4). Exemplo:

```yaml
name: feature
inputs: [task]
budget: { maxTurns: 80, maxMinutes: 120, maxCostUsd: 15 }
steps:
  - id: plan
    agent:
      prompt: "Planeje a implementação de: {{inputs.task}}. Responda só com o plano."
      permissionMode: plan
  - id: approve-plan
    gate: { message: "Aprovar o plano?", show: "{{steps.plan.output}}" }
  - id: implement
    agent: { prompt: "Implemente este plano e faça commits:\n{{steps.plan.output}}" }
  - id: tests
    loop:
      max: 3
      until: { check: "bun test" }
      do:
        agent: { continue: implement, prompt: "Os testes falharam:\n{{loop.lastCheck.output}}\nCorrija." }
  - id: review
    parallel:
      - agent: { prompt: "Revise o diff com foco em segurança." }
      - agent: { prompt: "Revise o diff com foco em legibilidade." }
  - id: apply-review
    agent: { continue: implement, prompt: "Aplique o que fizer sentido destas revisões:\n{{steps.review.outputs}}" }
  - id: pr
    pr: {}
```

| Etapa | O que faz |
| --- | --- |
| `agent` | abre uma sessão na worktree do card; `continue: <id>` manda a mensagem para a sessão de outra etapa; a saída é o texto do assistente no turno da etapa, com os blocos de texto de todas as mensagens desse turno concatenados na ordem |
| `check` | roda um comando declarado no workflow, na worktree; a saída é o código de retorno e os últimos 8 KB do output |
| `gate` | pausa a execução até você aprovar ou recusar, com nota opcional |
| `loop` | repete `do` até o `until` passar ou atingir `max`; estourou, pausa em Esperando você com o motivo |
| `parallel` | roda os itens ao mesmo tempo (respeitando `maxParallelRuns` do host) e junta as saídas em `outputs`, na ordem declarada |
| `pr` | push e abertura do PR pelo provedor do projeto (Fase 4) |

Interpolação só com `{{inputs.*}}`, `{{steps.<id>.output}}`, `{{steps.<id>.outputs}}` e `{{loop.lastCheck.*}}`; referência desconhecida é erro de validação, não texto vazio. Valor interpolado maior que 8 KB é cortado.

### Confiança e execução de comandos

- Etapas `check` executam shell, então cada workflow precisa ser aprovado por você antes da primeira execução. A aprovação guarda o hash do arquivo; se o arquivo mudar na base, volta a pedir aprovação. Workflows vindos da branch do próprio card nunca são usados.
- O `check` roda por um executor injetado (`CheckRunner`), com o mesmo shell do script de preparação da Fase 4 (`cmd.exe /d /s /c` no Windows, `sh -c` no resto), na worktree do card. O executor recebe só comandos que estão literalmente no workflow confiado; qualquer outro é recusado antes de chegar ao shell.

### Motor de execução

- **Persistência:** o estado é gravado a cada transição. Reiniciado o daemon, a execução retoma da etapa corrente:
  - `agent` cujo turno não terminou: retoma a sessão com `resume` e reenvia o prompt da etapa precedido de "A execução foi interrompida; continue de onde parou.";
  - `check`: roda de novo;
  - `gate`: continua aberto.
- **Colunas:** o card segue as colunas da Fase 4, com mais três regras:
  - `gate` aberto leva a Esperando você;
  - a etapa `pr` leva a Em revisão;
  - gate recusado encerra a execução com status `rejected` e leva o card a Esperando você.
- **Orçamento:** somado de todas as sessões da execução, em turnos, minutos de relógio e o custo que o SDK informa (em assinatura, é uma estimativa útil como teto). Estourou, a execução pausa em Esperando você com o motivo.
- **Custo é cumulativo por sessão.** O `costUsd` do `turn.result` vem do `total_cost_usd` do SDK, que é o total acumulado do processo da sessão, não o custo do turno. Guarde o último valor de cada sessão e some entre sessões; nunca some turno a turno. Uma sessão retomada com `resume` começa já com o total anterior: conte só a diferença em relação ao último valor conhecido.
- **`FakeRuntime`:** ganha um custo cumulativo configurável por gatilho na mensagem (por exemplo `[cost:0.25]` soma 0,25 ao total da sessão), para os testes de orçamento.

### MCP

`flightdeckd mcp` é um servidor MCP stdio (via `@modelcontextprotocol/sdk`, numa versão compatível com a peer dependency do Agent SDK) para o Claude Code do mesmo host. Ele lê a config do daemon, conecta no daemon local pelo protocolo com o token da config e expõe:

- `list_projects` e `list_workflows`;
- `create_card` e `start_card` (com `workflow` e `inputs`);
- `get_card` e `get_run`.

Não há ferramenta para aprovar permissões nem para responder gates: isso fica só com você, no app.

### Dados

```sql
CREATE TABLE workflow_runs (id TEXT PRIMARY KEY, card_id TEXT, workflow_name TEXT, workflow_hash TEXT, status TEXT,
                            status_reason TEXT, budget TEXT, usage TEXT, inputs TEXT, started_at TEXT, ended_at TEXT);
CREATE TABLE step_runs     (run_id TEXT, step_id TEXT, attempt INTEGER, type TEXT, status TEXT, session_id TEXT,
                            output TEXT, exit_code INTEGER, started_at TEXT, ended_at TEXT,
                            PRIMARY KEY (run_id, step_id, attempt));
CREATE TABLE trusted_workflows (project_id TEXT, name TEXT, hash TEXT, trusted_at TEXT,
                                PRIMARY KEY (project_id, name, hash));
```

### Protocolo (só adições)

| Item | Tipo | Conteúdo |
| --- | --- | --- |
| `workflow.list` / `workflow.validate` | comando | workflows do projeto (nome, hash, confiado?, comandos `check`) e erros de validação |
| `workflow.trust` | comando | `projectId`, `name`, `hash` |
| `card.start` | comando | ganha `workflow?` e `inputs?` |
| `run.get` / `run.watch` | comando | estado da execução; passa a receber `run.updated` |
| `gate.respond` | comando | `runId`, `stepId`, `attempt`, `decision` (`approve` ou `reject`), `note?` |
| `run.updated` | frame de topo | execução com etapas, uso e orçamento (fora do `SessionEvent`, como `card.updated`) |

## App desktop

- Ao iniciar um card: escolher o workflow (ou nenhum, que é o card simples da Fase 4) e preencher os `inputs`.
- Linha do tempo da execução no detalhe do card: cada etapa com status, tentativa, duração e uso; clicar abre a conversa da sessão ou a saída do `check`.
- Card de gate inline, com Aprovar, Recusar e nota; gates abertos também entram em "Precisa de você".
- Medidor de orçamento (turnos, minutos, custo estimado) por execução.
- Tela de workflows do projeto: validação, lista dos comandos `check` e o botão de confiar, que mostra os comandos antes de confirmar.

## Disciplina TDD

Segue [`docs/TDD.md`](TDD.md): ciclo por área, travas e regras de evidência. Depois do rebase sobre `fase-5`, a auditoria `bun run tdd:audit -- --since fase-5` confere a ordem dos commits e a ausência de testes desligados. Antes do rebase, use `--since fase-4` no branch `fase-6`.

**Trava desta fase: comandos `check`.** Nos testes, o `CheckRunner` real é trocado por um executor que só aceita comandos falsos instalados pelo próprio teste (resolvidos com `whichOnPath`); o preload reprova a suíte se o executor real de shell for chamado.

## Testes e critérios

**Áreas de teste (cada uma entra no TDD e na auditoria)**

| Área | O que precisa passar |
| --- | --- |
| `workflow-schema` | YAML válido carrega; campo desconhecido, etapa sem `id`, `continue` para etapa inexistente e referência inexistente em `{{…}}` são erros de validação |
| `interpolation` | `inputs`, `steps.<id>.output`, `steps.<id>.outputs` e `loop.lastCheck` resolvem; valor maior que 8 KB é cortado |
| `engine-agent` | etapa `agent` abre sessão na worktree; a saída junta os textos do turno; `continue` manda a mensagem à sessão da etapa indicada |
| `engine-check` | `check` grava código de retorno e saída; comando fora do workflow confiado nunca chega ao executor |
| `engine-gate` | `gate` pausa e move o card para Esperando você; aprovado segue; recusado encerra com `rejected` |
| `engine-loop` | repete até o `check` passar; estourou `max`, pausa com o motivo |
| `engine-parallel` | itens rodam juntos dentro da fila do host e as saídas chegam em `outputs` na ordem declarada |
| `engine-resume` | daemon reiniciado no meio de cada tipo de etapa retoma do ponto certo |
| `budget` | turnos e minutos somam entre sessões; o custo usa o último total de cada sessão e só a diferença após `resume`; estouro pausa a execução |
| `trust` | workflow não confiado não roda; hash diferente pede nova confiança; workflow da branch do card é ignorado |
| `mcp` | cada ferramenta responde pelo cliente MCP em processo; não existe ferramenta de permissão nem de gate |
| `run-ui` | linha do tempo mostra etapas, tentativas e uso; clicar abre a conversa ou a saída do `check`; medidor de orçamento |
| `gate-ui` | gate inline aprova e recusa com nota; gate aberto aparece em Precisa de você |
| `workflows-ui` | tela lista workflows com validação e comandos; confiar mostra os comandos e pede confirmação; iniciar card escolhe workflow e preenche inputs |

**Smoke (`bun run smoke:workflow`)**

Começa vermelho, roda com as travas ativas e sobe um daemon `--runtime fake` com um repositório temporário que tem remoto local e o workflow de exemplo na base, com `check` apontando para um comando falso. Cadastra o projeto com provedor `github` apontando para o `gh` falso, confia no workflow e inicia um card com ele. Executa o workflow inteiro:

1. plano;
2. gate aprovado pelo `gate.respond`;
3. implementação com `[commit]`;
4. `check` que falha uma vez e passa na segunda;
5. revisão em paralelo;
6. PR no `gh` falso, merge simulado e card em Concluído.

Imprime `SMOKE WORKFLOW OK`.

**Critérios de aceite**

- [ ] Para cada área da tabela acima, a conversa mostra o teste falhando por asserção antes da implementação e passando depois.
- [ ] Branch `fase-6` rebaseada sobre a tag `fase-5` e `bun run tdd:audit -- --since fase-5` imprimindo `TDD AUDIT OK`.
- [ ] `bun run typecheck`, `bun run lint` e `bun run test` saem com código 0, com cobertura de 100%.
- [ ] `bun run smoke`, `smoke:multi`, `smoke:history`, `smoke:board`, `smoke:central` e `smoke:workflow` imprimem `SMOKE OK`, `SMOKE MULTI OK`, `SMOKE HISTORY OK`, `SMOKE BOARD OK`, `SMOKE CENTRAL OK` e `SMOKE WORKFLOW OK`.
- [ ] `bun run build:daemon` e `bun run build:desktop` saem com código 0, e `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` também, no Windows nativo, se a casca Rust tiver mudado.
- [ ] README cobre workflows, confiança, orçamento e o `flightdeckd mcp`.
- [ ] Divergências em `docs/DECISIONS.md`, `git status` limpo, `fase-6` integrada ao branch principal de trabalho e a tag `fase-6` criada.
