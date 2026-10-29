# Flightdeck — Spec da Fase 8 (Custos e uso diário)

## Objetivo e escopo

A Fase 8 responde a duas perguntas do dia a dia:

1. **Quanto estou gastando, onde e em quê?** Gestão de custo e utilização de todas as sessões: terminal, app, cards e workflows. Inclui orçamento, alertas e o histórico da cota do plano.
2. **Como chego mais rápido no que precisa de mim?** Aprovar pela bandeja, abrir uma sessão no terminal com um clique e uma paleta Ctrl+K que leva a qualquer lugar.

Pré-requisito: Fase 7 fechada (tag `fase-7`). Há duas trilhas independentes, em paralelo:

| Trilha | Conteúdo | Onde |
| --- | --- | --- |
| A, custos | uso por mensagem, preços, tela Custos, orçamentos, histórico da cota | worktree próprio, branch `fase-8a`, a partir da tag `fase-7` |
| B, uso diário | bandeja com aprovações, abrir no terminal, resumo na lista, paleta Ctrl+K | worktree próprio, branch `fase-8b`, a partir da tag `fase-7` |

As duas trilhas são rebaseadas, na ordem, sobre a área "plataforma" do checkout principal (correções de CI para Windows e Linux): primeiro a B, depois a A sobre a B. A tag `fase-8` sai com as duas.

**Divisão do que é compartilhado**

- `config.ts` e `packages/protocol/src/index.ts`: cada trilha acrescenta só as próprias chaves.
- Migrações: só a trilha A acrescenta.
- `features` do `host.info`: a trilha A acrescenta `costs`; a trilha B não precisa de feature, porque o que ela faz vive no app.

**Fora da Fase 8**

- Cobrança real: em assinatura, o custo mostrado é o **equivalente em API, estimado**. O Flightdeck não consulta faturas nem a Admin API.
- Resumo de sessão gerado por IA, que gastaria cota. O resumo desta fase é derivado do transcript.
- Botões de ação dentro da notificação do sistema, porque o plugin de notificação do Tauri só tem ações no celular. A aprovação rápida fica na bandeja.
- Abrir terminal num host remoto: para ele, o app copia o comando.

## Fatos levantados pelo orquestrador (claude 2.1.312, transcripts reais)

- **Uma mensagem, várias linhas:**
  - Cada mensagem do assistente aparece em várias linhas do transcript, uma por bloco de conteúdo, com o mesmo `message.id` e o mesmo `message.usage` repetido.
  - Numa sessão real, foram 1772 linhas para 698 mensagens.
  - **O uso tem que ser deduplicado por `message.id`**, senão o custo sai cerca de 2,5× maior.
- **Campos de uso:**
  - `message.usage` traz `input_tokens`, `output_tokens`, `cache_read_input_tokens` e `cache_creation_input_tokens`.
  - Traz também `cache_creation: {ephemeral_5m_input_tokens, ephemeral_1h_input_tokens}`, `speed` (`standard` ou `fast`) e `service_tier`.
  - O modelo vem em `message.model`, e a hora em `timestamp`.
  - O Claude Code grava cache de 1 hora.
- **Subagentes:** os subagentes têm transcripts próprios em `<projeto>/<sessão>/subagents/*.jsonl`, que também precisam entrar no uso.
- **Preços de API por milhão de tokens** (tabela cacheada em 06/10/2026):

  | Modelo | Input | Output | Cache read |
  | --- | --- | --- | --- |
  | `claude-fable-5-1` | 10,00 | 50,00 | 0,25 |
  | `claude-opus-5-5` | 4,00 | 20,00 | 0,20 |
  | `claude-sonnet-5-5` | 2,00 | 10,00 | 0,20 |
  | `claude-haiku-5-5` | 0,10 | 0,50 | — |

  - **Escrita de cache:** 1,25× o input no cache de 5 minutos, 2× no de 1 hora.
  - **Haiku 5.5:** passa a 0,50 e 2,50 acima de 100 mil tokens de prompt.
  - **Fast mode do Opus 5.5:** custa 2×, ou seja 8 e 40.
  - Os valores que faltam (como o cache read do Haiku) entram como padrão documentado em `docs/DECISIONS.md`, com a fonte e a data.

## Trilha A — Custos e utilização

### Uso por mensagem

- **Fonte única: os transcripts.** O indexador de histórico da Fase 3, que já lê `~/.claude/projects`, passa a extrair o uso de cada mensagem do assistente, inclusive das pastas `subagents/`.
  - A fonte vale para todas as origens: as sessões do app, dos cards e dos workflows também gravam transcript no host.
  - Não há dupla contagem com a Fase 7.
- **Tabela:**
  ```sql
  CREATE TABLE usage_entries (message_id TEXT PRIMARY KEY, claude_session_id TEXT, at TEXT, day TEXT,
                              project_key TEXT, model TEXT, origin TEXT, speed TEXT, input INTEGER,
                              output INTEGER, cache_read INTEGER, cache_write_5m INTEGER,
                              cache_write_1h INTEGER, cost_usd REAL);
  ```
  - A chave por `message_id` garante a deduplicação, também ao reler um arquivo.
  - Sem o `cache_creation` detalhado, o `cache_creation_input_tokens` conta como cache de 5 minutos.
- **`origin`:**
  - `terminal`;
  - `app`, para a sessão gerenciada;
  - `card` e `workflow`, quando a sessão pertence a uma execução de card ou a uma etapa de workflow;
  - `subagent`, para os transcripts de `subagents/`, que herdam a sessão-mãe.
- **`day`:** é contado no fuso do host, por função injetada. O projeto é a `projectKey` da Fase 5.
- **Carga inicial:** o primeiro boot da fase preenche o uso de todos os transcripts que já existem, em segundo plano, sem travar o daemon. O andamento aparece no `costs.status`.
- **Uso do SDK:** o `usage_daily` da Fase 7 deixa de alimentar o painel de uso, que passa a ler daqui. O orçamento por execução da Fase 6 continua com o custo do SDK, em tempo real.
- **Conferência com o SDK:** nas sessões gerenciadas, o daemon compara o custo calculado com o último `total_cost_usd` do SDK da mesma sessão (Fase 6), que é a estimativa do próprio Claude Code. Divergência acima de 10% (e de US$ 0,05) aparece no `costs.status` com o modelo e os dois valores, e o app mostra o aviso "tabela de preços pode estar desatualizada" em Custos.
- **Retenção:** `retention.usageDays`, padrão 400. Entra na limpeza da Fase 7.

### Preços

- **Config:**
  ```json
  { "pricing": { "models": { "claude-opus-5-5": { "input": 4, "output": 20, "cacheRead": 0.2 } },
                 "cacheWrite5mMultiplier": 1.25, "cacheWrite1hMultiplier": 2, "fastMultiplier": { "claude-opus-5-5": 2 } } }
  ```
  - Os padrões são os da tabela acima.
  - Um modelo pode ter `tiers: [{ "abovePromptTokens": 100000, "input": 0.5, "output": 2.5 }]`.
  - O prompt de uma chamada é a soma de input, cache read e cache write.
  - `pricing` na config sobrescreve modelo a modelo.
- **Modelo sem preço:** tem `cost_usd` nulo, conta os tokens e aparece como "sem preço" no app, com o nome do modelo.
- **Preço alterado:** recalcula o custo das entradas existentes (`costs.reprice`), em lote.

### Orçamentos e alertas

- **Tabela:**
  ```sql
  CREATE TABLE budgets (id TEXT PRIMARY KEY, scope TEXT, project_key TEXT, period TEXT,
                        limit_usd REAL, action TEXT, created_at TEXT);
  ```
  - `scope`: `host` ou `project`.
  - `period`: `day` ou `month`, no fuso do host.
  - `action`: `notify` ou `queue`.
- **Alertas:**
  - Disparam em 50%, 80% e 100% do período, uma vez cada, como notificação do sistema e na faixa "Precisa de você".
  - `queue` em 100% põe os cards novos daquele escopo na fila com o motivo `budget`, como a fila por cota da Fase 7.
  - Eles saem sozinhos no período seguinte, ou quando o limite sobe.
  - Sessões do terminal e sessões manuais nunca são bloqueadas.
- **O que conta:** o custo estimado de todas as origens.

### Histórico da cota

- **Amostras:**
  ```sql
  CREATE TABLE quota_samples (window TEXT, utilization REAL, resets_at TEXT, status TEXT, taken_at TEXT);
  ```
  - Guarda cada leitura do `rate_limit_event`.
  - Leituras iguais da mesma janela em menos de 5 minutos viram uma só.
  - Retenção de 30 dias.
- **Projeção:** com pelo menos 3 amostras na janela atual, uma regressão linear estima quando a utilização chega a 100%: "no ritmo atual, a janela de 5 h esgota às HH:MM". Se o ritmo não chega lá antes do reinício, mostra "não esgota antes de HH:MM".
- **Quem consumiu a janela:** dentro da janela de 5 horas atual, a fatia de cada projeto no custo estimado das entradas desse intervalo. É uma atribuição aproximada e o app diz isso.

### Protocolo da trilha A (só adições)

| Item | Tipo | Conteúdo |
| --- | --- | --- |
| `costs.summary` | comando | `from`, `to` e filtros (`projectKey?`, `model?`, `origin?`); totais, série por dia, por projeto, por modelo e por origem, top 20 sessões e economia do cache |
| `costs.session` | comando | `claudeSessionId`; total e série por modelo da sessão (e das subagentes dela) |
| `costs.status` | comando | progresso da carga inicial e modelos sem preço |
| `costs.reprice` | comando | recalcula com a tabela atual |
| `costs.export` | comando | mesmos filtros; devolve CSV (uma linha por dia, projeto, modelo e origem) |
| `budget.list` / `budget.set` / `budget.remove` | comando | orçamentos; `set` cria ou altera, com validação |
| `budget.updated` | frame de topo | estado de um orçamento depois de cada mudança ou de cada limiar cruzado |
| `quota.history` | comando | `window` e `hours`; amostras e projeção |
| `host.info` | comando | `features` ganha `costs` |

A economia do cache é quanto o cache read custou a menos do que o mesmo volume como input normal.

### App, trilha A

- **Tela Custos**, no menu lateral:
  - Período: hoje, 7 dias, 30 dias, mês atual ou intervalo. Filtros por host, projeto, modelo e origem.
  - Totais: custo estimado, tokens e economia do cache.
  - Gráfico por dia, empilhado por projeto. Quebras por modelo e por origem.
  - Top sessões: clicar abre a sessão.
  - Botão Exportar CSV, salvo pelo diálogo do sistema.
  - Aviso fixo: "equivalente em API, estimado; em assinatura, não é cobrado".
- **Cota:**
  - Gráfico das janelas de 5 horas e de 7 dias ao longo do tempo, por host, com a projeção e o "quem consumiu".
  - As barras do topo da tela Sessões (Fase 7) ganham a projeção no tooltip.
- **Orçamentos**, em Configurações: lista, criar e editar (escopo, período, limite e ação), com o percentual atual de cada um.
- **Na lista de sessões e no detalhe:** custo estimado da sessão. No card e na execução de workflow, a soma das sessões.
- **Hosts sem `costs`:** nada disso aparece para eles, e nenhum banner de erro.

## Trilha B — Uso diário

### Bandeja

- **Submenu "Precisa de você":** lista até 10 pedidos abertos, de sessões gerenciadas e do terminal, no formato `host · sessão · ferramenta: resumo da entrada`.
  - Cada pedido abre um submenu com Aprovar, Negar e Abrir.
  - "Aprovar" e "Negar" respondem pelo mesmo `permission.respond`, sem abrir a janela.
  - Acima de 10, mostra "e mais N…", que abre o app.
- **Gates de workflow:** entram na lista com "Abrir", sem aprovação direta, porque o gate pede leitura.
- **Clique na notificação:** abre o app focado no pedido, pelo deep link `flightdeck://`.
- **Atualização:** o menu é refeito a cada mudança na lista, com debounce de 500 ms.

### Abrir no terminal

- **Botão "Abrir no terminal"** na sessão, no card e no projeto.
- **Host local** (o daemon em `127.0.0.1` da própria máquina):
  - Windows: `wt.exe -d <cwd> <flightdeckd> claude [--resume <id>]`. Sem o `wt.exe`, usa `cmd.exe /c start "" /d <cwd> cmd /k <flightdeckd> claude …`.
  - `<flightdeckd>` é o caminho estável da Fase 7 quando ele existe, senão o do PATH.
- **WSL supervisionado:** `wt.exe wsl.exe -d <distro> --cd <cwd> -- flightdeckd claude …`.
- **Outros hosts:** "Copiar comando", com `cd <cwd> && flightdeckd claude --resume <id>`.
- **Execução:** o comando sai de um comando Rust da casca Tauri, com os argumentos em lista e sem passar por shell, exceto no `cmd /k` do fallback.
- **Testes:** usam um executor injetado e nunca abrem um terminal de verdade.

### Resumo na lista

- **Na linha de cada sessão:** uma linha de resumo derivada do transcript, sem IA:
  - "Pedido: <primeira linha do último prompt do usuário, até 80 caracteres>";
  - o estado: "rodando Bash", "esperando aprovação de Write" ou "ociosa há 12 min".
- **Onde é calculado:** no daemon, junto com o indexador. Vai num campo `summary` da lista de sessões, que é só adição ao protocolo.

### Paleta Ctrl+K

- A busca de histórico do Ctrl+K vira uma paleta com seções:
  - sessões ao vivo;
  - cards;
  - projetos;
  - hosts;
  - ações: nova sessão em…, abrir no terminal, ir para Custos, ir para Configurações;
  - histórico, a busca atual da Fase 3.
- **Navegação:** setas e Enter. Uma tecla de ação (Tab) abre o submenu de ações do item.
- **Resultados:** os locais (sessões, cards, projetos, ações) aparecem na hora. O histórico chega depois, como hoje.

## Disciplina TDD

Segue [`docs/TDD.md`](TDD.md): ciclo por área, travas e regras de evidência.

- A trilha B audita com `bun run tdd:audit -- --since fase-7`.
- A trilha A audita com `--since fase-7` no próprio branch e, depois do rebase, a partir do último commit da trilha B.

**Travas desta fase**

- Fixtures de transcript com uso:
  - escritas à mão em `apps/daemon/test/fixtures/history/`;
  - com mensagens repetidas em várias linhas, subagentes, fast mode, cache de 5 minutos e de 1 hora, e um modelo sem preço.
  - Os testes nunca leem o `~/.claude` real; a trava de home continua valendo.
- Terminal: o executor de "abrir no terminal" é injetado, e o preload reprova se o real for chamado.

## Testes e critérios

**Áreas de teste (cada uma entra no TDD e na auditoria)**

| Trilha | Área | O que precisa passar |
| --- | --- | --- |
| A | `uso-mensagens` | uma mensagem em várias linhas conta uma vez; subagentes entram com a sessão-mãe; reler o arquivo não duplica; `origin` certo para terminal, app, card, workflow e subagente; dia no fuso injetado |
| A | `precos` | custo por modelo com input, output, cache read, cache write de 5 minutos e de 1 hora; tier acima de 100 mil tokens; fast mode; modelo sem preço com custo nulo; config sobrescreve; `costs.reprice` recalcula; divergência com o `total_cost_usd` do SDK acima do limite aparece no `costs.status` |
| A | `carga-inicial` | o primeiro boot preenche de transcripts existentes em segundo plano; `costs.status` mostra o progresso; o daemon responde durante a carga |
| A | `custos-resumo` | `costs.summary` com filtros e quebras; top sessões; economia do cache; `costs.session` soma as subagentes; `costs.export` gera CSV estável |
| A | `orcamentos` | limiares de 50%, 80% e 100% uma vez por período; `queue` segura card novo com motivo `budget` e solta no período seguinte ou com limite maior; sessão manual e do terminal não bloqueadas; `budget.updated` |
| A | `cota-historico` | amostras guardadas com deduplicação de 5 minutos; projeção com 3 ou mais amostras; "não esgota antes do reinício"; atribuição por projeto na janela; retenção de 30 dias |
| A | `custos-ui` | tela Custos com período, filtros, gráficos, top sessões e exportar; aviso de estimativa; host sem `costs` sem tela nem banner de erro |
| A | `orcamentos-ui` | criar, editar e remover orçamento; percentual atual; alerta em "Precisa de você" |
| A | `cota-ui-historico` | gráfico das janelas com projeção; tooltip das barras; custo na linha da sessão, no card e no workflow |
| B | `bandeja-aprovacao` | submenu lista até 10 pedidos com Aprovar, Negar e Abrir; aprovar e negar chegam ao `permission.respond`; "e mais N"; gates só com Abrir; debounce |
| B | `abrir-terminal` | comando certo para Windows com e sem `wt.exe`, WSL e host remoto (copiar); argumentos em lista; caminho estável ou PATH; executor real nunca chamado nos testes |
| B | `resumo-lista` | pedido cortado em 80 caracteres; estado rodando, esperando ou ocioso; `summary` na lista |
| B | `paleta` | seções na ordem; setas, Enter e Tab; ações levam à tela certa; histórico chega depois sem apagar os locais |

**Smokes**

- **`bun run smoke:costs` (trilha A):**
  - Começa vermelho e roda com as travas ativas.
  - Sobe um daemon `--runtime fake` com raízes de histórico temporárias e transcripts de fixture: uma sessão do terminal com mensagens repetidas, uma subagente e um modelo sem preço.
  - Espera a carga inicial e confere o `costs.summary` contra o valor calculado à mão.
  - Cria um orçamento de projeto com `queue` e um limite já ultrapassado. Um card novo desse projeto fica na fila com o motivo `budget`. Sobe o limite e o card sai da fila.
  - Exporta o CSV.
  - Imprime `SMOKE COSTS OK`.
- **Trilha B:** não tem smoke de daemon próprio, porque o que ela faz vive no app. As áreas de UI cobrem a trilha.

**Critérios de aceite**

- [ ] Para cada área da tabela acima, a conversa mostra o teste falhando por asserção antes da implementação e passando depois.
- [ ] Trilha A rebaseada sobre o fim da trilha B, e `bun run tdd:audit -- --since fase-7` imprimindo `TDD AUDIT OK` no resultado integrado.
- [ ] `bun run typecheck`, `bun run lint` e `bun run test` saem com código 0, com cobertura de 100%.
- [ ] Todos os smokes anteriores e o `smoke:costs` imprimem cada um o seu `SMOKE … OK`.
- [ ] `bun run build:daemon` e `bun run build:desktop` saem com código 0, e o `cargo check` também, porque a trilha B muda a casca Rust.
- [ ] A CI do GitHub fica verde no `main`.
- [ ] As versões vão a `0.8.0`.
- [ ] O README cobre:
  - custos, com o aviso de estimativa;
  - preços e como sobrescrevê-los;
  - orçamentos;
  - histórico da cota;
  - bandeja com aprovação;
  - abrir no terminal;
  - paleta.
- [ ] Divergências em `docs/DECISIONS.md`, `git status` limpo e a tag `fase-8` criada pelo orquestrador.
