# Flightdeck — Spec da Fase 7 (Operação)

## Objetivo e escopo

A Fase 7 deixa o Flightdeck pronto para uso diário em vários hosts:

- versões conferidas entre o app e cada daemon, e atualização do daemon sem quebrar serviço nem hooks;
- dados com retenção e backup;
- cota do plano do Claude visível por host, protegendo os cards;
- "permitir sempre" nas aprovações, para não responder a mesma pergunta toda vez.

Pré-requisito: Fase 6 fechada (tag `fase-6`). A fase tem duas trilhas independentes, desenvolvidas em paralelo:

| Trilha | Conteúdo | Onde |
| --- | --- | --- |
| A, operação do host | versões e compatibilidade, atualização, retenção, backup | checkout principal, branch `fase-2-v2` |
| B, limites e regras | cota do plano por host, uso, "permitir sempre" | worktree próprio, branch `fase-7b` criada a partir do commit desta spec (depois da tag `fase-6`) |

A trilha B é rebaseada sobre o fim da trilha A antes de fechar. A tag `fase-7` sai com as duas.

**Divisão do que é compartilhado**

- `config.ts` e `packages/protocol/src/index.ts`: cada trilha acrescenta só as próprias chaves e itens.
- Migrações: só a trilha B acrescenta uma (`usage_daily`). Se a trilha A precisar de uma, avisa o orquestrador antes.
- `features` do `host.info`: a trilha A cria o campo, com `central`, `workflows` e `maintenance`. A trilha B acrescenta `quota` e `rules` no rebase final sobre a trilha A, não antes.

**Dentro da Fase 7**

- Versão única do produto, `--version`, compatibilidade de protocolo e recursos por host.
- `flightdeckd update`: instala um binário novo num caminho estável, com volta automática se o novo não subir.
- Retenção configurável, backup automático e manual, e restauração.
- Cota do plano (janelas de 5 horas e de 7 dias) por host, uso por dia e por projeto, e fila de cards por cota.
- "Permitir nesta sessão" e "Sempre neste projeto", nas sessões gerenciadas e nas do terminal, com a lista de regras do projeto.

**Fora da Fase 7**

- Baixar atualizações da internet e canal de releases: o binário novo é sempre um arquivo que você indica.
- Atualizar remotamente outro host a partir do app: em cada host, roda-se `flightdeckd update` ali mesmo.
- Regras globais no `~/.claude/settings.json` (destino `userSettings`): só regras do projeto.
- Celular, PWA, hub e despacho entre hosts.

## Provas de conceito (feitas pelo orquestrador, claude 2.1.312 e Agent SDK 0.3.312, Windows)

- **Cota:** cada turno de uma sessão do SDK recebe uma mensagem `rate_limit_event`. O formato observado, numa conta Max, foi:
  ```json
  {"status":"allowed","resetsAt":1793286000,"rateLimitType":"five_hour",
   "unifiedWindows":{"five_hour":{"utilization":0.53,"resetsAt":1793286000,"status":"allowed"},
                     "seven_day":{"utilization":0.22,"resetsAt":1793487600,"status":"allowed"}}}
  ```
  - `utilization` é uma fração entre 0 e 1, e não uma porcentagem.
  - `resetsAt` vem em segundos desde a época Unix.
  - `unifiedWindows` não aparece nos tipos do SDK. Leia de forma defensiva; sem ele, use `rateLimitType`, `utilization` e `resetsAt` do topo.
- **Sugestões:**
  - O `canUseTool` do SDK recebe `suggestions` (`PermissionUpdate[]`), e o `PermissionResult` de allow aceita `updatedPermissions`.
  - O hook `PermissionRequest` recebe `permission_suggestions`, e a decisão allow aceita `updatedPermissions`.
  - Para um `mkdir`, as sugestões vieram só com destino `session`: `addDirectories` da pasta e `setMode acceptEdits`.
- **Hook com `updatedPermissions`:**
  - Devolvendo as sugestões de sessão, dois `mkdir` na mesma sessão geraram um único pedido.
  - Devolvendo `{"type":"addRules","rules":[{"toolName":"Bash","ruleContent":"mkdir:*"}],"behavior":"allow","destination":"localSettings"}`, o próprio Claude Code gravou `Bash(mkdir:*)` em `<projeto>/.claude/settings.local.json`. A sessão seguinte não pediu permissão.
- **Fase 5, confirmada no terminal interativo:** a mensagem do app chegou e o Claude respondeu. O Claude Code mostra `server:flightdeck · no MCP server configured with that name` na abertura, mesmo com o canal funcionando, porque o aviso é avaliado antes dos servidores do `--mcp-config`. Vai para o README como aviso conhecido.

## Trilha A — Operação do host

### Versões e compatibilidade

- **Versão única do produto:**
  - Ficam com a mesma versão: `packages/protocol`, `apps/daemon`, `apps/desktop` e o `tauri.conf.json`. No `tauri.conf.json`, ela vem de `"version": "../package.json"`.
  - Um teste falha se elas divergirem.
  - A Fase 7 fecha em `0.7.0`, e cada fase seguinte sobe a versão menor.
- **`--version`:** `flightdeckd --version` imprime `flightdeckd <versão> (protocolo <n>)` e sai com 0.
- **Protocolo:**
  - `PROTOCOL_VERSION` continua 1 enquanto as mudanças forem só adições. Entra `MIN_PROTOCOL_VERSION`, também 1.
  - O `hello` ganha `protocolVersion?` do cliente; quando ausente, vale 1.
  - Fora de `[MIN_PROTOCOL_VERSION, PROTOCOL_VERSION]`, o ack é o erro `protocol_incompatible` com as duas versões, e a conexão continua sem autenticar.
- **Recursos por host:**
  - O `host.info` ganha `features: string[]`, com `central`, `workflows`, `maintenance`, `quota` e `rules`, conforme o que o daemon tem.
  - O app esconde a tela ou o botão de um recurso que o host não anuncia, em vez de mostrar erro.
- **No app:**
  - A tela de hosts mostra a versão do daemon e a do `claude` de cada host.
  - Daemon com versão diferente da do app mostra o selo "versão diferente".
  - Host com protocolo incompatível fica "incompatível: atualize o daemon", com o comando a rodar no host, e não entra nas listas.

### Atualização (`flightdeckd update`)

```sh
flightdeckd update --from <caminho do binário novo> [--allow-downgrade] [--config <arquivo>]
```

- **Caminho estável:** `~/.flightdeck/bin/flightdeckd` (`.exe` no Windows).
  - O `update` sempre instala ali.
  - Se o serviço ou os hooks apontam para outro caminho (por exemplo `dist/`), o `update` reinstala o serviço apontando para o caminho estável. Os hooks são reinstalados só se já estiverem instalados: substituir as entradas do próprio Flightdeck é o mesmo opt-in já dado. A saída diz o que foi reescrito.
- **Passos:**
  1. Roda `<novo> --version` com timeout de 10 s; sem uma versão válida, recusa. Versão menor que a atual é recusada, salvo com `--allow-downgrade`.
  2. Se há um daemon rodando sem serviço (lock do `dataDir` ocupado), recusa com "pare o daemon e rode de novo". Com serviço, para o serviço.
  3. Troca o binário:
     - No Windows, renomeia o atual para `flightdeckd.exe.old` (um executável em uso pode ser renomeado) e copia o novo.
     - Fora do Windows, copia para um arquivo temporário na mesma pasta e renomeia por cima.
  4. Sobe o serviço e espera o daemon novo responder em `GET /health` na porta da config, por até 30 s. Se a rota não existir, ela é criada nesta fase e responde sem token.
  5. Se o daemon novo não sobe, volta o `.old`, sobe de novo e sai com código 1 explicando. Com sucesso, apaga o `.old` na próxima execução do `update`.
- **Testes:** usam serviço, exec e sistema de arquivos injetados, e um executável falso que imprime uma versão. Nenhum teste para ou sobe um serviço de verdade.
- **README:** como atualizar cada tipo de host (Windows, WSL, Linux remoto): copie o binário para o host e rode `flightdeckd update --from` ali.

### Retenção

- **Config:**
  ```json
  { "retention": { "eventsDays": 90, "externalSessionsDays": 30 } }
  ```
  `0` vale como "apagar assim que encerrar". Os padrões são esses.
- **O que é apagado:**
  - eventos e pedidos de permissão de sessões gerenciadas encerradas há mais de `eventsDays` dias;
  - sessões externas encerradas há mais de `externalSessionsDays` dias.
- **O que nunca é apagado:**
  - sessões vivas;
  - sessões fixadas (`session_meta.pinned`);
  - sessões de cards fora de Concluído;
  - cards, execuções de workflow e o `session_meta` em si.
- **Conversa removida:** a conversa de um card concluído cuja sessão foi limpa mostra "conversa removida pela retenção".
- **Quando roda:** no boot e a cada 24 h, com relógio e agendador injetados. Também pelo protocolo (`maintenance.prune`, com `dryRun`) e pelo CLI (`flightdeckd db prune [--dry-run]`). O resultado é a contagem por tabela.
- **Fora daqui:** o índice de histórico segue os transcripts e não entra na retenção. Não há `VACUUM` automático.

### Backup e restauração

- **Automático:**
  - Uma vez por dia, `VACUUM INTO <dataDir>/backups/flightdeck-<AAAAMMDD-HHmmss>.db`, mantendo os últimos `backup.keep` (padrão 7).
  - Config: `{ "backup": { "enabled": true, "keep": 7 } }`.
  - Funciona com o daemon rodando.
- **Manual:**
  - `flightdeckd backup [--out <arquivo>]` e o comando `maintenance.backup`.
  - Os arquivos são criados só para o dono (0600 fora do Windows).
- **Restauração:** `flightdeckd restore <arquivo>`.
  - Só roda com o daemon parado; com o lock ocupado, recusa.
  - Confere `PRAGMA integrity_check` e se o `user_version` do arquivo é no máximo o número de migrações atuais.
  - Guarda o banco atual como `flightdeck.db.before-restore` e copia o backup no lugar. No boot seguinte, as migrações que faltarem rodam normalmente.
- **Config fora do backup:** a `config.json` não entra no backup, porque tem tokens. O README diz para guardá-la à parte.

### Protocolo da trilha A (só adições)

| Item | Tipo | Conteúdo |
| --- | --- | --- |
| `hello` | comando | ganha `protocolVersion?`; erro `protocol_incompatible` |
| `host.info` | comando | ganha `features` |
| `maintenance.status` | comando | tamanho do banco, último backup, lista de backups, última limpeza e contagens |
| `maintenance.backup` | comando | cria um backup agora; devolve caminho e tamanho |
| `maintenance.prune` | comando | `dryRun?`; devolve contagens por tabela |

### App, trilha A

- Selo de versão por host, e o estado "incompatível".
- Seção **Manutenção** na tela do host:
  - tamanho do banco;
  - último backup, com "Fazer backup agora";
  - última limpeza, com "Simular" (`dryRun`) e "Limpar", que pede confirmação.

## Trilha B — Limites e regras

### Cota do plano por host

- **Origem:** o `rate_limit_event` das sessões gerenciadas. Todas as sessões de um host usam o mesmo login, então a cota é do host.
  - O runtime normaliza o evento num evento interno de cota.
  - O daemon guarda a última leitura de cada janela (`five_hour`, `seven_day` e as outras que vierem): utilização (fração), `resetsAt`, `status` e quando foi lida.
- **Sessões do terminal:** os hooks não trazem cota. A leitura vale para o host todo, e o app mostra a idade dela ("lida há 12 min"). Quem usa só o terminal vê barras vazias ou antigas até rodar um card ou uma sessão gerenciada; o README diz isso. O `rate_limits` do SDK só existe no relatório de uso (`SDKUsageReport`, experimental) e fica fora desta fase.
- **Leitura vencida:** depois do `resetsAt`, a leitura daquela janela deixa de valer até chegar uma nova.
- **Fila por cota:** config `{ "quota": { "pauseAt": 0.9 } }` (`null` desliga). Enquanto alguma janela válida tem utilização ≥ `pauseAt` ou `status` `rejected`:
  - um card novo entra na fila com o motivo `quota` e sai sozinho quando a janela reinicia;
  - um workflow em andamento espera antes do próximo turno de agente, com o estado "aguardando cota até HH:MM", conferido no mesmo ponto do orçamento da Fase 6;
  - sessões manuais não são bloqueadas; o app mostra o aviso.
- **`FakeRuntime`:** um gatilho `[ratelimit:five_hour=0.95@<epoch>]` na mensagem emite o evento, para os testes.

### Uso

- **Tabela:**
  ```sql
  CREATE TABLE usage_daily (day TEXT, project_key TEXT, cost_usd REAL, input_tokens INTEGER,
                            output_tokens INTEGER, turns INTEGER, PRIMARY KEY (day, project_key));
  ```
- **Atualização:** incremental, a cada `turn.result` de sessão gerenciada.
- **Custo:** a diferença do total da sessão, pela regra da Fase 6, nunca a soma turno a turno.
- **Dia e projeto:** o dia é contado no fuso do host, por uma função injetada. O projeto é a `projectKey` da Fase 5.
- **Sessões do terminal:** ficam fora do uso nesta fase, porque os hooks não trazem custo.

### "Permitir sempre"

- **Pedido:** passa a levar as sugestões. Na sessão gerenciada, vêm de `suggestions` no `permission.requested`; na do terminal, de `permission_suggestions` no `external.permission`. Mesmo formato do `PermissionUpdate` do SDK, validado com zod.
- **Resposta:** o `permission.respond` ganha `updatedPermissions?`. O daemon aceita cada item só se for:
  1. **uma das sugestões do próprio pedido**, igual campo a campo, e só com destino `session` ou `localSettings`. Os destinos `userSettings`, `projectSettings` (o `.claude/settings.json` versionado) e `cliArg` são recusados, assim como `setMode` para `bypassPermissions` ou `auto`;
  2. **ou uma regra do projeto**: `{type: "addRules", behavior: "allow", destination: "localSettings", rules: [{toolName, ruleContent?}]}`, com `toolName` igual ao da ferramenta do pedido e `ruleContent` não vazio, sem quebra de linha, com até 500 caracteres.

  Qualquer outra coisa recebe o erro `invalid_permission_update`, nada é aplicado e o pedido continua aberto.
- **Aplicação:**
  - Na sessão gerenciada, vai como `updatedPermissions` do `PermissionResult`.
  - Na sessão do terminal, vai como `updatedPermissions` na decisão do hook. Quem grava o arquivo é o Claude Code (prova de conceito).
- **Sessões de card:** rodam numa worktree, que tem o próprio `.claude`.
  - Ao aceitar uma regra do projeto para uma sessão de card, o daemon também a grava no `.claude/settings.local.json` da raiz do repositório. A gravação mescla em `permissions.allow`, sem duplicar e sem tocar nas outras chaves.
  - Toda worktree nova recebe uma cópia do `settings.local.json` da raiz.
  - O daemon garante `.claude/settings.local.json` no `.git/info/exclude` do repositório. É o diretório git comum, então vale para todas as worktrees, e o arquivo nunca entra no diff do card nem num commit. Não dá para contar com o ignore global que o Claude Code configura, porque ele é de cada máquina.
- **Regras do projeto:**
  - `rules.list` lê `permissions.allow` do `.claude/settings.local.json` da raiz de um projeto cadastrado.
  - `rules.remove` remove uma regra, com `confirm: true`, preservando o resto do arquivo.
  - O Flightdeck não escreve em nenhum outro arquivo de settings.

### Protocolo da trilha B (só adições)

| Item | Tipo | Conteúdo |
| --- | --- | --- |
| `permission.requested` / `external.permission` | evento / frame | ganham `suggestions?` |
| `permission.respond` | comando | ganha `updatedPermissions?`; erro `invalid_permission_update` |
| `quota.get` / `quota.watch` | comando | janelas do host e `pauseAt`; passa a receber `quota.updated` |
| `quota.updated` | frame de topo | janelas depois de cada leitura nova |
| `usage.summary` | comando | `days` (padrão 7); por dia e por projeto: custo, tokens e turnos |
| `rules.list` / `rules.remove` | comando | `projectId`; `rule` e `confirm` no remove |

### App, trilha B

- **Topo da tela Sessões:** duas barras por host online, 5 horas e 7 dias, com a porcentagem, a hora de reinício e a idade da leitura.
  - A barra fica vermelha a partir de `pauseAt`.
  - Cruzar o `pauseAt` gera uma notificação do sistema, uma vez por janela.
- **Painel de uso do host:** últimos 7 dias, por dia e por projeto.
- **Cards na fila por cota:** mostram "aguardando cota até HH:MM".
- **Aprovação:** além de Aprovar e Negar, tem:
  - "Permitir nesta sessão", quando há sugestões de destino `session`;
  - "Sempre neste projeto", que abre a regra para edição. Para o Bash, o padrão é o comando exato, e você pode trocá-lo por um prefixo como `npm test:*`. Para as outras ferramentas, o padrão é o nome da ferramenta.
- **Tela do projeto:** seção **Regras**, com a lista e o botão de remover, que pede confirmação.

## Disciplina TDD

Segue [`docs/TDD.md`](TDD.md): ciclo por área, travas e regras de evidência.

- A trilha A audita com `bun run tdd:audit -- --since fase-6`.
- A trilha B audita com `--since fase-6` enquanto está no próprio branch e, depois do rebase, a partir do último commit da trilha A.

**Travas desta fase**

- Serviço e binário: nenhum teste para, sobe ou instala um serviço de verdade, nem escreve em `~/.flightdeck/bin` de verdade. O `update` recebe serviço, exec e caminhos injetados, e o preload reprova se o controlador real de serviço for chamado.
- Settings de projeto: os testes de regras só escrevem em repositórios temporários. As travas de home da Fase 5 continuam valendo para `~/.claude`.

## Testes e critérios

**Áreas de teste (cada uma entra no TDD e na auditoria)**

| Trilha | Área | O que precisa passar |
| --- | --- | --- |
| A | `versao` | as quatro versões batem; `--version` imprime versão e protocolo |
| A | `protocolo-compat` | `hello` sem versão vale 1; versão fora do intervalo dá `protocol_incompatible` e não autentica; `host.info` traz `features` |
| A | `update` | recusa binário sem `--version` e downgrade sem a flag; recusa com daemon rodando sem serviço; troca, sobe e confere `/health`; falha volta o `.old`; serviço e hooks fora do caminho estável são reinstalados |
| A | `retencao` | apaga só o que passou do prazo; nunca apaga sessão viva, fixada ou de card aberto; `0` apaga ao encerrar; `dryRun` só conta; roda no boot e a cada 24 h com relógio injetado |
| A | `backup` | `VACUUM INTO` com o daemon rodando; mantém os últimos `keep`; restauração recusa com lock ocupado, confere integridade e `user_version` e guarda o `.before-restore` |
| A | `versoes-ui` | selo "versão diferente"; host incompatível fora das listas com o comando de atualização; recurso não anunciado escondido |
| A | `manutencao-ui` | seção Manutenção mostra o status; backup agora; Simular e Limpar com confirmação |
| B | `cota` | `rate_limit_event` com e sem `unifiedWindows` vira as janelas do host; leitura vencida no `resetsAt` deixa de valer; `quota.updated` chega a quem fez `quota.watch` |
| B | `cota-fila` | acima do `pauseAt`, card novo fica na fila com motivo `quota` e sai no reinício; workflow espera antes do próximo turno de agente; sessão manual não é bloqueada; `pauseAt: null` desliga |
| B | `uso` | `usage_daily` soma por dia (fuso injetado) e projeto, com custo pela diferença do total da sessão; `usage.summary` responde |
| B | `permitir-sempre` | sugestões chegam no pedido gerenciado; resposta com sugestão ou regra válida é aplicada; `userSettings`, `projectSettings`, `cliArg`, `bypassPermissions`, `auto` e regra de outra ferramenta dão `invalid_permission_update` e o pedido segue aberto |
| B | `permitir-externo` | `permission_suggestions` chegam no `external.permission`; a decisão do hook leva `updatedPermissions` validado |
| B | `regras-projeto` | regra aceita numa sessão de card também vai para o `settings.local.json` da raiz sem duplicar nem perder chaves; worktree nova recebe a cópia; `.claude/settings.local.json` está no `.git/info/exclude` e a cópia nunca aparece no diff do card; `rules.list` e `rules.remove` com confirmação |
| B | `cota-ui` | barras por host com porcentagem, reinício e idade; vermelho a partir de `pauseAt`; notificação uma vez por janela; painel de uso; card "aguardando cota" |
| B | `permitir-ui` | "Permitir nesta sessão" só com sugestão de sessão; "Sempre neste projeto" edita a regra (Bash com o comando exato por padrão); seção Regras remove com confirmação |

**Smokes**

- **`bun run smoke:ops` (trilha A):**
  - Começa vermelho e roda com as travas ativas.
  - Sobe um daemon `--runtime fake` com `retention.eventsDays: 0` e cria e encerra uma sessão.
  - `maintenance.backup` produz um arquivo que abre, passa no `integrity_check` e tem o mesmo `user_version`.
  - `maintenance.prune` apaga os eventos da sessão encerrada e preserva uma sessão viva.
  - Um `hello` com `protocolVersion: 999` recebe `protocol_incompatible`, e o `host.info` traz `features`.
  - Para o daemon, roda `flightdeckd restore` com o backup, sobe de novo e encontra a sessão.
  - Imprime `SMOKE OPS OK`.
- **`bun run smoke:limits` (trilha B):**
  - Começa vermelho e roda com as travas ativas.
  - Daemon `--runtime fake` com um projeto temporário.
  - Uma mensagem com `[ratelimit:five_hour=0.95@<agora + 3 s>]` gera `quota.updated`. Um card iniciado em seguida fica na fila com motivo `quota` e começa sozinho depois do reinício.
  - Um pedido de permissão de uma sessão de card, com sugestões, é respondido com uma regra do projeto. A regra chega ao runtime e ao `settings.local.json` da raiz.
  - Uma resposta com `setMode bypassPermissions` recebe `invalid_permission_update`.
  - Pelo claude falso da Fase 5, um `PermissionRequest` com `permission_suggestions` é respondido com uma sugestão, e o corpo da resposta do hook traz `updatedPermissions`.
  - Imprime `SMOKE LIMITS OK`.

**Critérios de aceite**

- [ ] Para cada área da tabela acima, a conversa mostra o teste falhando por asserção antes da implementação e passando depois.
- [ ] Trilha B rebaseada sobre o fim da trilha A, e `bun run tdd:audit -- --since fase-6` imprimindo `TDD AUDIT OK` no resultado integrado.
- [ ] `bun run typecheck`, `bun run lint` e `bun run test` saem com código 0, com cobertura de 100%.
- [ ] Os smokes `smoke`, `smoke:multi`, `smoke:history`, `smoke:board`, `smoke:central`, `smoke:workflow`, `smoke:ops` e `smoke:limits` imprimem cada um o seu `SMOKE … OK`.
- [ ] `bun run build:daemon` e `bun run build:desktop` saem com código 0.
- [ ] `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` sai com código 0 no Windows nativo, porque o `tauri.conf.json` muda. Sem `cargo` no host, registre em `docs/DECISIONS.md` e avise.
- [ ] As quatro versões em `0.7.0`.
- [ ] O README cobre:
  - versões e `update` por tipo de host;
  - retenção, backup e restauração, com a `config.json` guardada à parte;
  - cota, fila por cota e uso;
  - "permitir sempre" e regras do projeto;
  - o aviso conhecido do canal.
- [ ] Divergências em `docs/DECISIONS.md`, `git status` limpo e a tag `fase-7` criada pelo orquestrador depois da confirmação com o claude real.
