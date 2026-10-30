# Flightdeck — Spec da Fase 1

Oct 28, 2026 · @José Ângelo da Silva Nery

## Visão e objetivo

Flightdeck é uma central de comando pessoal para o Claude Code: um app Windows que abre, conversa, aprova e acompanha sessões do Claude Code rodando em várias máquinas (Windows nativo, WSL, Orange Pi, VPS). A longo prazo vira um orquestrador de agentes, misturando o controle remoto do Happy com o board do Vibe Kanban.

**Objetivo da Fase 1:** provar o núcleo técnico num único host. Um daemon (`flightdeckd`) hospeda sessões do Claude Code pelo Agent SDK oficial, persiste os eventos e expõe um protocolo WebSocket; um app desktop conecta nele, mostra o chat em streaming e aprova ou nega ferramentas. Sem board, sem multi-host orquestrado, sem PTY.

Princípios que valem desde já:

- **O agente é sempre o binário oficial `claude`**, dirigido pelo `@anthropic-ai/claude-agent-sdk`. Nada de chamar a API da Anthropic direto nem extrair tokens OAuth.
- **A sessão vive no daemon, não no terminal nem no app.** Fechar o app ou cair a rede não mata a sessão; o app reconecta e faz replay.
- **Uso pessoal, assinatura do próprio host.** O daemon nunca repassa `ANTHROPIC_API_KEY` ao processo do Claude, para o consumo sair da assinatura Max.
- **Um contrato, dois lados.** Daemon e app compartilham os mesmos tipos e schemas do protocolo, num pacote único.

## Escopo

A Fase 1 entrega um host funcionando de ponta a ponta; tudo que é orquestração fica para depois.

**Dentro da Fase 1**

- Daemon `flightdeckd` em Bun + TypeScript, compilável como binário único para Windows x64, Linux x64 e Linux ARM64.
- Criar sessão num diretório de projeto permitido, mandar mensagens, receber o stream, interromper o turno, encerrar.
- Ponte de permissões: cada pedido de ferramenta vira um evento, o app responde allow ou deny.
- Persistência em SQLite com número de sequência por sessão e replay a partir de um `sinceSeq`.
- Retomar uma sessão encerrada ou de um daemon reiniciado via `resume` com o session id do Claude.
- Autenticação por token e bind em 127.0.0.1 por padrão.
- App desktop Tauri 2 + React que conecta em N hosts configurados, lista sessões, mostra o chat e os cards de aprovação.
- Runtime falso (`FakeRuntime`) para testar tudo sem gastar cota.

**Fora da Fase 1**

- Board, tarefas e worktrees.
- Importar ou indexar os JSONL de `~/.claude/projects`.
- Terminal interativo (PTY) e sessões abertas fora do daemon.
- Supervisão do WSL a partir do Windows, serviço do systemd, instalador.
- Celular, voz, notificações push fora do desktop.
- Outros agentes além do Claude Code.

## Stack e estrutura

TypeScript de ponta a ponta, num monorepo com workspaces do Bun; o único Rust é a casca do Tauri.

| Camada | Escolha |
| --- | --- |
| Runtime e build do daemon | Bun (`bun build --compile` com `--target`) |
| Agente | `@anthropic-ai/claude-agent-sdk` (oficial), versão fixada |
| Servidor | `Bun.serve` com WebSocket nativo |
| Banco | `bun:sqlite` |
| Validação e contrato | `zod` |
| Desktop | Tauri 2 + React + Vite + TypeScript |
| Testes | `bun test` |
| Lint e formatação | Biome |

```text
flightdeck/
├─ package.json            # workspaces + scripts da raiz
├─ biome.json
├─ tsconfig.base.json
├─ packages/
│  └─ protocol/            # schemas zod + tipos de comandos e eventos
├─ apps/
│  ├─ daemon/              # flightdeckd
│  │  ├─ src/
│  │  │  ├─ main.ts        # CLI: start, --config, --runtime fake|claude
│  │  │  ├─ config.ts
│  │  │  ├─ server.ts      # Bun.serve + WebSocket + auth
│  │  │  ├─ sessions/      # SessionManager, estado, fila de mensagens
│  │  │  ├─ runtime/       # AgentRuntime, ClaudeSdkRuntime, FakeRuntime
│  │  │  ├─ permissions/   # PermissionBroker
│  │  │  └─ store/         # EventStore sobre SQLite + migrações
│  │  └─ test/
│  └─ desktop/             # Tauri 2 + React
│     ├─ src/
│     └─ src-tauri/
├─ scripts/
│  └─ smoke.ts             # ponta a ponta com FakeRuntime
└─ docs/
   └─ SPEC.md              # este documento
```

Scripts obrigatórios na raiz: `typecheck`, `lint`, `test`, `smoke`, `build:daemon` (os três alvos) e `build:desktop` (frontend Vite).

## Daemon flightdeckd

O daemon é dono das sessões: ele cria os processos do Claude via SDK, guarda cada evento com número de sequência e repassa tudo aos clientes conectados.

### AgentRuntime

Toda conversa com o Claude passa por uma interface, para o resto do código não depender do SDK:

```ts
interface AgentRuntime {
  start(opts: StartOptions): AgentRun; // cwd, resume?, permissionMode, model?
}
interface AgentRun {
  events: AsyncIterable<RuntimeEvent>; // já normalizados para o protocolo
  send(text: string): void; // próxima mensagem do usuário
  interrupt(): Promise<void>;
  close(): Promise<void>;
}
// canUseTool é injetado pelo SessionManager e resolvido pelo PermissionBroker
```

- **ClaudeSdkRuntime**: usa `query()` do `@anthropic-ai/claude-agent-sdk` com `prompt` como `AsyncIterable` de mensagens de usuário (modo streaming), para a sessão continuar viva entre turnos. Passa `cwd`, `resume`, `permissionMode`, `canUseTool`, `includePartialMessages: true` e `env` sanitizado. Para ter o mesmo comportamento do CLI, carrega as configurações do disco (`settingSources: ['user','project','local']`) e usa o system prompt preset do Claude Code. Os nomes exatos vêm dos tipos da versão instalada do SDK; se divergirem desta spec, os tipos mandam e a divergência vai para `docs/DECISIONS.md`.
- **FakeRuntime**: roteiro determinístico, sem rede. Responde texto em partes, pede permissão para uma ferramenta quando a mensagem contém `[tool]`, emite `result` com usage fictício e respeita `interrupt`.
- **Ambiente**: o filho nunca recebe `ANTHROPIC_API_KEY` nem `ANTHROPIC_AUTH_TOKEN`, a menos que a config tenha `allowApiKey: true`. `CLAUDE_CODE_OAUTH_TOKEN` é mantido.

### Sessões

1. `starting` → o runtime subiu e ainda não chegou o evento de init com o session id do Claude.
2. `running` → turno em andamento.
3. `awaiting_permission` → existe pelo menos um pedido de ferramenta aberto.
4. `idle` → turno terminou com `result`; aceita nova mensagem.
5. `ended` → fechada pelo usuário; pode ser retomada com `resume`.
6. `error` → o runtime falhou; guarda a mensagem e permite `resume`.

Mensagens enviadas durante `running` entram numa fila e são entregues no próximo turno. Cada mudança de estado gera um evento `session.status`.

### PermissionBroker

- O `canUseTool` cria um registro `pending` com id próprio, emite `permission.requested` e devolve uma promise.
- `permission.respond` resolve a promise com allow (opcionalmente com `updatedInput`) ou deny com mensagem.
- Se o turno for interrompido ou o sinal de abort disparar, o pedido vira `cancelled`.
- Pedidos abertos quando o daemon reinicia viram `expired` no boot.
- Sem timeout automático na Fase 1: o pedido espera até alguém responder.

### Persistência e replay

- Todo evento de sessão ganha `seq` crescente por sessão, é gravado no SQLite e só depois enviado aos clientes inscritos.
- `session.subscribe` com `sinceSeq` devolve os eventos perdidos em ordem e depois segue ao vivo, sem buracos nem duplicados.
- No boot, sessões que estavam `running` ou `awaiting_permission` viram `error` com o motivo "daemon reiniciado" e ficam retomáveis.

### Configuração

Arquivo `~/.flightdeck/config.json`, validado com zod; criado com valores padrão na primeira execução:

| Campo | Padrão | Uso |
| --- | --- | --- |
| `hostName` | nome da máquina | rótulo no app |
| `bind` | `127.0.0.1` | interface de escuta |
| `port` | `7420` | porta HTTP/WebSocket |
| `token` | gerado (32 bytes, base64url) | autenticação dos clientes |
| `dataDir` | `~/.flightdeck/data` | SQLite e logs |
| `allowedRoots` | `[]` | diretórios onde sessões podem ser abertas |
| `runtime` | `claude` | `claude` ou `fake` |
| `defaultPermissionMode` | `default` | modo inicial das sessões |
| `allowApiKey` | `false` | repassar chave de API ao Claude |

### Segurança

- Bind fora de loopback só com `bind` explícito na config; o acesso remoto da Fase 2 vai pela Tailscale.
- Token exigido no primeiro frame do WebSocket, comparado em tempo constante; falhou, fecha com código 4401.
- `cwd` resolvido com realpath e recusado se estiver fora de `allowedRoots`.
- Nenhum comando do protocolo executa shell arbitrário; só o Claude executa ferramentas, e sob o controle de permissões.
- O token nunca aparece em log; o arquivo de config é criado com permissão restrita onde o sistema suportar.

## Protocolo WebSocket

Um único endpoint `ws://<bind>:<port>/v1/ws`, mensagens JSON validadas com zod nos dois lados; todos os schemas moram em `packages/protocol`.

**Envelopes**

```ts
// cliente → daemon
{ id: string; type: CommandType; payload: unknown }
// daemon → cliente, resposta a um comando
{ type: "ack"; id: string; ok: true; data?: unknown }
{ type: "ack"; id: string; ok: false; error: { code: string; message: string } }
// daemon → cliente, evento de sessão
{ type: "event"; sessionId: string; seq: number; ts: string; event: SessionEvent }
```

O primeiro frame do cliente precisa ser `hello`; qualquer outro antes dele fecha a conexão com 4401.

**Comandos**

| Comando | Payload | Resposta |
| --- | --- | --- |
| `hello` | `{ token, client }` | `{ hostName, daemonVersion, protocolVersion }` |
| `session.list` | `{}` | resumo de todas as sessões |
| `session.create` | `{ cwd, prompt, name?, permissionMode?, model? }` | `{ sessionId }` |
| `session.send` | `{ sessionId, text }` | aceito ou enfileirado |
| `session.interrupt` | `{ sessionId }` | ok |
| `session.close` | `{ sessionId }` | ok |
| `session.resume` | `{ sessionId }` | ok (reabre com o `claudeSessionId` guardado) |
| `session.subscribe` | `{ sessionId, sinceSeq? }` | replay, depois eventos ao vivo |
| `session.unsubscribe` | `{ sessionId }` | ok |
| `permission.respond` | `{ requestId, decision: "allow" \| "deny", message?, updatedInput? }` | ok |

**Eventos de sessão**

| Evento | Conteúdo |
| --- | --- |
| `session.created` | `cwd`, `name`, `permissionMode` |
| `session.status` | `status`, `reason?` |
| `session.init` | `claudeSessionId`, `model`, ferramentas disponíveis |
| `message.user` | texto enviado |
| `message.assistant` | blocos de texto e `tool_use` (id, nome, input) |
| `message.delta` | trecho de texto parcial do turno corrente |
| `tool.result` | `toolUseId`, conteúdo resumido, `isError` |
| `permission.requested` | `requestId`, `toolName`, `input` |
| `permission.resolved` | `requestId`, `decision` ou `cancelled` / `expired` |
| `turn.result` | `subtype`, duração, custo e usage informados pelo SDK |
| `session.error` | `code`, `message` |

`message.delta` é efêmero: vai ao vivo e não entra no replay. O `message.assistant` completo do mesmo turno é o que fica persistido. `protocolVersion` começa em `1`; mudança incompatível sobe a versão.

## Modelo de dados

Três tabelas no SQLite do daemon, com migrações versionadas aplicadas no boot; o log de eventos é a fonte da verdade e o resto é estado derivado.

```sql
CREATE TABLE sessions (
  id                TEXT PRIMARY KEY,      -- ulid do Flightdeck
  claude_session_id TEXT,                  -- vem do evento de init; usado no resume
  name              TEXT,
  cwd               TEXT NOT NULL,
  status            TEXT NOT NULL,
  permission_mode   TEXT NOT NULL,
  model             TEXT,
  last_seq          INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE TABLE events (
  session_id TEXT NOT NULL REFERENCES sessions(id),
  seq        INTEGER NOT NULL,
  ts         TEXT NOT NULL,
  type       TEXT NOT NULL,
  payload    TEXT NOT NULL,                -- JSON validado pelo schema do evento
  PRIMARY KEY (session_id, seq)
);

CREATE TABLE permission_requests (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES sessions(id),
  tool_name   TEXT NOT NULL,
  input       TEXT NOT NULL,
  status      TEXT NOT NULL,              -- pending | allowed | denied | cancelled | expired
  message     TEXT,
  created_at  TEXT NOT NULL,
  resolved_at TEXT
);
```

- O `seq` é atribuído e gravado na mesma transação que atualiza `sessions.last_seq`.
- O SQLite roda em modo WAL.
- Datas em ISO 8601 UTC.

## App desktop

O app é um cliente fino: toda regra mora no daemon, e a UI só renderiza eventos e envia comandos usando os tipos de `packages/protocol`.

**Hosts**

- Lista de hosts guardada localmente: nome, URL do WebSocket e token. O token fica no armazenamento seguro do Tauri, não em texto puro.
- Cada host tem conexão própria com reconexão exponencial (1 s até 30 s) e indicador online/offline.
- Ao reconectar, o app reenvia `session.subscribe` com o último `seq` que viu, para não perder nem duplicar eventos.

**Telas**

1. **Barra lateral:** hosts e, dentro de cada um, as sessões com nome, pasta e um selo de status (rodando, esperando você, ociosa, encerrada, erro).
2. **Nova sessão:** host, pasta (dentre os `allowedRoots`), nome opcional, modo de permissão e o primeiro prompt.
3. **Sessão:** histórico em streaming com Markdown e código; chamadas de ferramenta recolhidas, com nome, input resumido e resultado expansível; caixa de mensagem; botões de interromper e encerrar.
4. **Card de aprovação:** aparece inline no ponto da conversa, com ferramenta, input formatado e diff quando a ferramenta for de edição; botões Permitir e Negar, e motivo opcional ao negar.

**Comportamento**

- Notificação do Windows quando uma sessão pede permissão ou termina um turno e a janela não está em foco (plugin de notificação do Tauri).
- Tema claro e escuro seguindo o sistema.
- Nada de chamar o Claude direto do app: tudo passa pelo daemon.

## Testes e smoke

Tudo que prova a Fase 1 roda com o `FakeRuntime`, sem rede e sem gastar cota; o Claude real só entra num smoke manual opcional.

**Testes obrigatórios (`bun test`)**

| Área | O que precisa passar |
| --- | --- |
| Protocolo | todo comando e evento válido passa no schema; payload inválido é recusado com `ack ok:false` |
| Autenticação | frame antes do `hello` e token errado fecham com 4401; token certo responde `hostName` e versões |
| Ciclo de vida | `create` → `running` → deltas → `message.assistant` → `turn.result` → `idle`; `send` em `idle` inicia novo turno |
| Fila | mensagem enviada durante `running` é entregue no turno seguinte, na ordem |
| Permissão | `[tool]` gera `permission.requested`; allow segue o turno; deny encerra a chamada com a mensagem; interrupt marca `cancelled` |
| Replay | cliente que cai e volta com `sinceSeq` recebe exatamente os eventos que perdeu, sem buraco nem duplicado |
| Reinício | sessão `running` vira `error` no boot; pedido `pending` vira `expired`; `session.resume` reabre |
| Pastas | `cwd` fora de `allowedRoots` (inclusive via symlink ou `..`) é recusado |
| Ambiente | o env entregue ao runtime não contém `ANTHROPIC_API_KEY` com `allowApiKey: false` |

**Smoke (`bun run smoke`)**

`scripts/smoke.ts` sobe o daemon com `--runtime fake` numa porta livre e dados temporários, conecta um cliente WebSocket real e executa: `hello`, cria sessão, recebe resposta, envia `[tool]`, aprova, recebe `turn.result`, derruba a conexão, reconecta com `sinceSeq` e confere o replay. No fim imprime exatamente `SMOKE OK` e sai com código 0; qualquer falha imprime o passo e sai com código 1.

**Smoke real (opcional, manual)**

`bun run smoke:real` faz o mesmo roteiro com `--runtime claude` numa pasta descartável, com um prompt curto que pede para criar um arquivo, forçando um pedido de permissão. Não faz parte dos critérios de aceite.

## Critérios de aceite

A Fase 1 está pronta quando cada item abaixo for demonstrado pela saída do comando na própria conversa do agente; nada conta por declaração.

- [ ] `bun install` e depois `bun run typecheck` saem com código 0.
- [ ] `bun run lint` sai com código 0.
- [ ] `bun test` sai com código 0 e a saída mostra testes passando em todas as áreas da tabela de testes.
- [ ] `bun run smoke` imprime `SMOKE OK`.
- [ ] `bun run build:daemon` gera `dist/flightdeckd-windows-x64.exe`, `dist/flightdeckd-linux-x64` e `dist/flightdeckd-linux-arm64`, mostrados por um `ls -la dist/`.
- [ ] `bun run build:desktop` sai com código 0.
- [ ] `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` sai com código 0 (rodando no Windows nativo).
- [ ] `README.md` explica instalar, configurar `allowedRoots`, subir o daemon e conectar o app.
- [ ] `docs/DECISIONS.md` registra toda divergência em relação a esta spec.
- [ ] Tudo commitado e `git status` limpo.

## Regras para o agente e roadmap

O agente implementa só a Fase 1, em passos pequenos e verificáveis, sem gastar cota e sem tocar em credenciais.

1. Ordem de construção: `packages/protocol` → `store` → `FakeRuntime` → sessões e permissões → servidor → smoke → `ClaudeSdkRuntime` → app desktop.
2. Ao fim de cada etapa, rodar `typecheck` e `test` e mostrar a saída; commit com conventional commits.
3. Testes e smoke só com `FakeRuntime`. Não rodar `smoke:real` nem qualquer chamada ao Claude real.
4. Antes de escrever o `ClaudeSdkRuntime`, ler os tipos exportados pela versão instalada do SDK e seguir esses tipos.
5. Nunca ler, copiar ou logar credenciais (`~/.claude/.credentials.json`, tokens, chaves) e nunca chamar a API da Anthropic diretamente.
6. Dúvida que bloqueie: escolher a opção mais simples compatível com esta spec, registrar em `docs/DECISIONS.md` e seguir.
7. Nada da lista "Fora da Fase 1" entra no código, nem como esboço.

| Fase | Entrega | Spec |
| --- | --- | --- |
| 1 | Núcleo num host: daemon, sessões pelo Agent SDK, permissões, replay e app desktop | este arquivo |
| 2 | Multi-host: vários daemons, WSL, serviço e pareamento | [SPEC-fase-2.md](SPEC-fase-2.md) |
| 3 | Histórico: índice dos transcripts, busca global e retomada | [SPEC-fase-3.md](SPEC-fase-3.md) |
| 4 | Board: projetos, cards em worktrees, colunas automáticas e PR | [SPEC-fase-4.md](SPEC-fase-4.md) |
| 5 | Central de sessões: lista única, hooks, aprovações e mensagens para sessões do terminal | [SPEC-fase-5.md](SPEC-fase-5.md) |
| 6 | Workflows: etapas encadeadas, gates, orçamento e MCP local | [SPEC-fase-6.md](SPEC-fase-6.md) |
| 7 | Operação: versões e atualização, retenção e backup, cota do plano por host, "permitir sempre" | [SPEC-fase-7.md](SPEC-fase-7.md) |
| 8 | Custos e uso diário: custo por mensagem e por projeto, orçamentos, histórico da cota, bandeja com aprovação, abrir no terminal, paleta Ctrl+K | [SPEC-fase-8.md](SPEC-fase-8.md) |
| 9 | Distribuição: release assinada, atualizador do app e atualização do daemon pelo app | [SPEC-fase-9.md](SPEC-fase-9.md) |
| 10 | Interface: shadcn/ui com grid e layout padronizados, tema claro e escuro, inglês e português, aprovação legível, navegação com voltar, estados e avisos, modo demonstração com prints na CI | [SPEC-fase-10.md](SPEC-fase-10.md) |
| 11 | Revisão: comentários inline para o agente, reverter e editar, comentários do PR, merge local, .worktreeinclude, sessão↔arquivos, statusline | [SPEC-fase-11.md](SPEC-fase-11.md) |
| 12 | Checkpoints e configuração do agente: snapshots por turno, voltar arquivos, bifurcar, MCP, CLAUDE.md, agentes e skills do projeto | [SPEC-fase-12.md](SPEC-fase-12.md) |
| 13 | Automação: issues do GitHub e Azure Boards, automações por horário e evento, arena, risco e aprovação automática por IA | [SPEC-fase-13.md](SPEC-fase-13.md) |
| 14 | Espaço de trabalho: abas e tela dividida, terminal embutido em qualquer host, "Claude aqui" controlável | [SPEC-fase-14.md](SPEC-fase-14.md) |
| 15 | Hosts SSH: destinos com importação do ~/.ssh/config, terminal SSH por aba, fingerprint confirmado, askpass | [SPEC-fase-15.md](SPEC-fase-15.md) |
| 16 | Cofre de segredos no cofre do sistema, entrega só no uso, backup cifrado com age | [SPEC-fase-16.md](SPEC-fase-16.md) |
| 17 | O Claude usa o segredo sem vê-lo: ações declaradas, máscara na saída, MCP e mod | [SPEC-fase-17.md](SPEC-fase-17.md) |
| 18 | Snippets de comando e de prompt, por projeto, host ou globais | [SPEC-fase-18.md](SPEC-fase-18.md) |
| 19 | Regras de uso por segredo: solicitante, janela, limites, teto seguro e auditoria | [SPEC-fase-19.md](SPEC-fase-19.md) |
| 20 | Personas de engenharia: biblioteca com pacote inicial, sessão nova ou aberta, subagentes, workflows, arena e board | [SPEC-fase-20.md](SPEC-fase-20.md) |
| 21 | Times e comunicação entre sessões: mensagens em qualquer host, regras e limites, aviso de ocioso, coordenadora com executoras e pausa por cota | [SPEC-fase-21.md](SPEC-fase-21.md) |
| 22 | PR: vigiar e consertar (Azure DevOps primeiro) e rastro PR ↔ sessões ↔ item de trabalho | [SPEC-fase-22.md](SPEC-fase-22.md) |
| 23 | Telemetria OpenTelemetry das sessões do terminal: tempo, espera de permissão e erros | [SPEC-fase-23.md](SPEC-fase-23.md) |
| 24 | Ambiente de execução por card: portas, run e preview | [SPEC-fase-24.md](SPEC-fase-24.md) |
| 25 | Rastro e replay da sessão com árvore de subagentes | [SPEC-fase-25.md](SPEC-fase-25.md) |
| 26 | Memória, contexto e plugins do Claude Code | [SPEC-fase-26.md](SPEC-fase-26.md) |
| 27 | Sessões em segundo plano do Claude Code (`--bg`, `claude agents`) na central | [SPEC-fase-27.md](SPEC-fase-27.md) |

Cada fase fecha pelos próprios critérios de aceite e é integrada na ordem do roadmap; duas fases independentes podem ser desenvolvidas em paralelo em worktrees separados, com a posterior rebaseada sobre a tag da anterior antes de fechar. O produto é desktop, sem celular.
