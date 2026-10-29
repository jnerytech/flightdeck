# Flightdeck — Spec da Fase 5 (Central de sessões)

## Objetivo e escopo

A Fase 5 junta num lugar só todas as sessões do Claude Code dos seus hosts, inclusive as que você abre no terminal, e deixa o app aprovar permissões e mandar mensagens para elas enquanto rodam, no estilo do Happy, só que no desktop.

Pré-requisito: Fase 4 fechada.

**Dentro da Fase 5**

- Lista única de sessões de todos os hosts, agrupada por projeto: as gerenciadas pelo Flightdeck, as externas ao vivo e as do histórico.
- Hooks do Claude Code instalados por opt-in (`flightdeckd hooks install`), que avisam o daemon quando uma sessão externa começa, trabalha, pede permissão, para e termina.
- Aprovar ou negar pelo app os pedidos de permissão de sessões externas, com o diálogo do terminal continuando ativo em paralelo.
- `flightdeckd claude`: abre o `claude` de verdade no terminal com o canal do Flightdeck, para o app poder mandar mensagens para aquela sessão.
- Acompanhar ao vivo o transcript de uma sessão externa.
- Fixar, arquivar e renomear sessões.

**Fora da Fase 5**

- A extensão do Claude Code para VS Code e o app Claude Desktop: rodam o `claude` em modo SDK, onde o canal de desenvolvimento é ignorado (verificado na prova de conceito). O terminal integrado do VS Code é um terminal comum e está dentro.
- Mandar mensagem para uma sessão aberta com `claude` puro: ela aparece na lista e aceita aprovações pelo app, mas mensagem só com `flightdeckd claude`.
- Terminal anexável (PTY) e espelho da tela do terminal.
- Celular, PWA e notificações push fora do desktop.
- Workflows (Fase 6).

## O que a prova de conceito confirmou

Feita em 2026-10-29 com `claude` 2.1.312, Windows nativo, assinatura Max, com hooks só numa pasta descartável. Vale como restrição de projeto; reconfirme na primeira validação manual se a versão do `claude` mudar.

- **Hooks:** valem em sessões interativas e em `-p`. `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `Notification`, `Stop` e `SessionEnd` funcionam com `type: "http"`; o `SessionStart` do tipo `http` **não** disparou, só o do tipo `command`. O ambiente do hook tem `CLAUDE_CODE_MESSAGING_SOCKET` e `CLAUDE_CODE_MESSAGING_TOKEN`.
- **Permissão:** o hook `PermissionRequest` pode segurar a resposta. Enquanto ele segura, o diálogo do terminal aparece normalmente e chega um `Notification` com `notification_type: "permission_prompt"`. A resposta `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}` libera a ferramenta e fecha o diálogo ("Allowed by PermissionRequest hook"). O payload traz `tool_name`, `tool_input` e `permission_suggestions`, mas não `tool_use_id`.
- **Daemon fora do ar:** com a porta fechada, a sessão segue em segundos; com o servidor morto no meio da espera, segue em cerca de 4 s. O Claude nunca trava por causa do Flightdeck.
- **Timeout do hook:** estourado, a chamada segue o comportamento normal da sessão (em `-p`, negada).
- **Canal:** um servidor MCP com a capability `experimental["claude/channel"]`, carregado com `claude --dangerously-load-development-channels server:<nome>`, empurra mensagens para uma sessão interativa aberta (`notifications/claude/channel`); o Claude agiu em cerca de 5 s com a sessão ociosa. A primeira abertura mostra um aviso de canal de desenvolvimento que precisa ser aceito.
- **Fora do terminal:** na extensão do VS Code o mesmo canal subiu como MCP, mas nenhuma mensagem chegou.

## Design

O daemon de cada host passa a saber, além das próprias sessões, quais sessões externas existem naquele host e em que estado estão. O app junta tudo.

### Hooks

`flightdeckd hooks install` grava no `~/.claude/settings.json` do usuário do host as entradas do Flightdeck; `flightdeckd hooks uninstall` remove só essas; `flightdeckd hooks status` diz se estão instaladas e se a versão confere. É a única escrita do Flightdeck em `~/.claude`, sempre por comando explícito do usuário, e muda o princípio da Fase 3 ("o Flightdeck só lê `~/.claude`"), o que vai para `docs/DECISIONS.md`.

- **Mescla, nunca sobrescreve:** mantém todas as outras chaves e hooks; grava antes uma cópia `settings.json.flightdeck-backup`; reinstalar é idempotente. As entradas do Flightdeck são reconhecidas pela URL do receptor e pelo comando `flightdeckd hook`.
- **Eventos instalados:**
  - `SessionStart`: `type: "command"`, rodando `flightdeckd hook session-start`, que lê o JSON da entrada, acrescenta `FLIGHTDECK_LAUNCH_ID` (se houver) e envia ao receptor. Falhou o envio, sai com código 0 sem saída.
  - `UserPromptSubmit`, `Notification`, `PermissionRequest`, `PostToolUse`, `PostToolUseFailure`, `PermissionDenied`, `Stop` e `SessionEnd`: `type: "http"` para o receptor, com o cabeçalho de token.
  - Timeouts: 5 s para todos, exceto `PermissionRequest`, com `hooks.permissionTimeoutS` (padrão 600).
- **WSL:** o daemon do WSL instala no `~/.claude` do WSL; cada daemon cuida do próprio host.

### Receptor de hooks

- Listener HTTP separado, sempre em `127.0.0.1:hooks.port` (padrão 7421), independente do `bind` do protocolo, porque os hooks rodam na mesma máquina.
- Token próprio (`hooks.token`, gerado no install), aceito só nas rotas de hook. Token errado: 401 e nada muda.
- Hooks de sessões gerenciadas pelo próprio daemon são ignorados (resposta vazia na hora): o `ClaudeSdkRuntime` usa `settingSources: ["user", ...]`, então essas sessões também disparam os hooks do usuário. A sessão gerenciada é reconhecida pelo `claudeSessionId` e por `FLIGHTDECK_MANAGED=1` no ambiente que o runtime passa ao `claude`.
- Resposta vazia (2xx sem corpo) sempre que o Flightdeck não decide nada, para o Claude seguir como se o hook não existisse.

### Sessões externas

O daemon mantém um registro das sessões externas vivas, alimentado pelos hooks e completado pelo índice de histórico da Fase 3 (mesmo `claudeSessionId`).

| Evento do hook | Estado |
| --- | --- |
| `SessionStart` | `idle` (registra `cwd`, `transcript_path`, `source`, launch id) |
| `UserPromptSubmit` | `running` |
| `PermissionRequest` ou `Notification` com `permission_prompt` | `awaiting_permission` |
| `PostToolUse`, `PostToolUseFailure` ou `PermissionDenied` | `running` |
| `Stop` | `idle` |
| `SessionEnd` | `ended` |

- Sessão sem nenhum evento e sem mudança no transcript há `hooks.staleAfterS` (padrão 900) passa a `ended` com motivo `stale`.
- Daemon reiniciado: as sessões externas que não chegaram a `ended` voltam como `unknown` até o próximo evento.
- Cada sessão externa diz se é **controlável**: tem um canal conectado (ver `flightdeckd claude`).

### Permissões de sessões externas

1. `PermissionRequest` chega. Sem nenhum app conectado ao daemon, a resposta é vazia na hora (o diálogo do terminal decide, e scripts `claude -p` não ficam esperando).
2. Com app conectado, o daemon segura a resposta e publica o pedido na fila "Precisa de você", com ferramenta, entrada resumida e sessão.
3. `permission.respond` com o `requestId` do pedido responde `allow` ou `deny`; o daemon devolve o JSON do hook e fecha a requisição.
4. O pedido sai da fila quando:
   - é respondido;
   - a conexão do hook cai (timeout ou Claude encerrado);
   - chega qualquer evento posterior da mesma sessão, porque você respondeu no terminal.
5. Nunca se aprova nada sem resposta explícita do app: não existe "allow" automático.

`requestId` de pedidos externos e de sessões gerenciadas não colidem; `permission.respond` serve aos dois.

### `flightdeckd claude` e o canal

`flightdeckd claude [argumentos do claude]` é o jeito de abrir uma sessão controlável. Sugestão de alias no README: `fd`.

- Resolve o `claude` real com `whichOnPath` (ou `claude.executablePath`) e o executa no mesmo terminal, com stdio herdado e o código de saída repassado.
- Acrescenta `--dangerously-load-development-channels server:flightdeck` e um `--mcp-config` que registra o servidor `flightdeck` como `flightdeckd channel`. Não toca no `.mcp.json` do projeto.
- Define `FLIGHTDECK_LAUNCH_ID` (ULID) no ambiente. O `SessionStart` repassa esse id e o `flightdeckd channel` o usa para se ligar à sessão certa.
- Sem `claude` no PATH, ou com o daemon do host fora do ar, avisa com uma linha clara. Sem daemon, abre o `claude` assim mesmo.

`flightdeckd channel` é um servidor MCP stdio de canal **só de ida**:

- capability `experimental["claude/channel"]`, sem ferramentas e sem relay de permissão, porque as aprovações vão pelo hook;
- `instructions` dizendo que as mensagens vêm do usuário pelo app Flightdeck e devem ser tratadas como o próximo prompt dele;
- conecta no receptor local com o token de hooks, se identifica pelo launch id e recebe as mensagens destinadas àquela sessão;
- cada mensagem vira `notifications/claude/channel` com `content` = texto e `meta` = `{ from: "flightdeck" }`.

A prova de conceito registrou o servidor por `.mcp.json`, não por `--mcp-config`. A confirmação com o `claude` real é manual e fica fora desta fase (o agente não roda o Claude real): é feita depois da tag, com o binário compilado. Por isso o wrapper monta os argumentos numa única função testável. Se a confirmação falhar, a correção entra como `fix(wrapper)` com teste próprio.

### Agrupamento por projeto

Cada sessão (gerenciada, externa ou do histórico) ganha um `projectKey`:

1. O `remote.origin.url` do repositório que contém o `cwd`, normalizado: SSH e HTTPS do mesmo repositório dão a mesma chave, sem `.git` final e em minúsculas.
2. Sem remoto: `host:<hostId>:<raiz do repositório>`.
3. Sem repositório: `host:<hostId>:<cwd>`.

Worktrees em `.flightdeck/worktrees/<slug>` caem no repositório principal. A chave é calculada pelo daemon (com `whichOnPath("git")`), guardada em cache por `cwd` e devolvida junto da sessão. O mesmo repositório no Windows e no WSL cai no mesmo grupo.

### Ao vivo

- `history.watch` passa a valer para o leitor: com observação do sistema de arquivos ativa, `history.changed` sai em até 2 s depois de o transcript crescer.
- O leitor de uma sessão viva busca as mensagens novas com `history.get` a partir do último cursor, sem recarregar a página.

### Dados

```sql
CREATE TABLE external_sessions (claude_session_id TEXT PRIMARY KEY, cwd TEXT, transcript_path TEXT, status TEXT,
                                status_reason TEXT, launch_id TEXT, channel_connected INTEGER, project_key TEXT,
                                started_at TEXT, last_event_at TEXT, ended_at TEXT);
CREATE TABLE session_meta      (claude_session_id TEXT PRIMARY KEY, name TEXT, pinned INTEGER, archived INTEGER);
```

`session_meta` vale para sessões gerenciadas e externas (a chave é o `claudeSessionId`).

### Protocolo (só adições)

| Item | Tipo | Conteúdo |
| --- | --- | --- |
| `external.list` | comando | sessões externas com estado, `controllable`, `projectKey` e meta |
| `external.watch` | comando | passa a receber `external.updated` |
| `external.updated` | frame de topo | sessão externa completa após cada mudança (como `history.changed`, fora do `SessionEvent`) |
| `external.message` | comando | `claudeSessionId`, `text` → entregue ao canal; sessão não controlável é recusada com erro claro |
| `external.permission` | frame de topo | pedido externo aberto ou fechado (`requestId`, sessão, ferramenta, entrada resumida, `state`) |
| `permission.respond` | comando | passa a aceitar `requestId` de pedido externo |
| `session.meta.set` | comando | `claudeSessionId`, `name?`, `pinned?`, `archived?` |
| `hooks.status` / `hooks.install` / `hooks.uninstall` | comando | os mesmos do CLI; install e uninstall exigem `confirm: true` |

As listas de sessões (`session.list`, `history.list`, `external.list`) passam a devolver `projectKey`.

## App desktop

A tela **Sessões** vira a principal do app; os hosts continuam na barra lateral, como filtro e para a gestão de cada um.

- **Lista única:** todas as sessões de todos os hosts online, agrupadas por projeto (nome do repositório) e ordenadas pela última atividade. Cada linha mostra título ou nome, host, origem (Flightdeck, terminal, histórico), estado (rodando, precisa de você, ociosa, encerrada), o selo "controlável" e a hora da última atividade.
- **Filtros:** texto, host, origem, estado, fixadas e arquivadas (arquivadas ficam fora por padrão). Fixadas aparecem no topo do grupo.
- **Abrir uma sessão:**
  - gerenciada: a conversa da Fase 1;
  - externa viva: o leitor ao vivo, os pedidos de permissão dela inline e, se for controlável, a caixa de mensagem;
  - encerrada ou do histórico: o leitor, com Retomar (Fase 3).
- **Precisa de você:** inclui os pedidos de permissão das sessões externas, com Aprovar e Negar, e notificação do sistema como nos pedidos das sessões gerenciadas.
- **Menu da sessão:** renomear, fixar, arquivar e "Copiar comando" (`flightdeckd claude --resume <id>`).
- **Host:** na tela de cada host, o estado dos hooks e os botões Instalar e Remover, com confirmação que explica o que será escrito no `~/.claude/settings.json`.

## Disciplina TDD

Segue [`docs/TDD.md`](TDD.md): ciclo por área, travas e regras de evidência. A auditoria `bun run tdd:audit -- --since fase-4` confere a ordem dos commits e a ausência de testes desligados.

**Trava desta fase: `claude` falso por teste.** Os testes de `flightdeckd claude` e o smoke instalam um `claude` falso no PATH do processo filho, à frente do sentinela, e conferem que o sentinela continua sem execuções. O falso registra os argumentos, executa o servidor do `--mcp-config` e simula os hooks a partir de roteiros escritos à mão. Nenhum teste lê ou grava o `~/.claude` real: `hooks install` roda contra o HOME temporário da trava de home. Payloads de hook nos fixtures são escritos à mão no formato da prova de conceito.

## Testes e critérios

Os testes simulam o Claude Code pelos hooks (requisições HTTP e o comando `flightdeckd hook`) e pelo `claude` falso; o canal é exercitado com o cliente MCP do SDK em processo.

**Áreas de teste (cada uma entra no TDD e na auditoria)**

| Área | O que precisa passar |
| --- | --- |
| `hooks-install` | mescla no `settings.json` existente sem perder chaves nem hooks de terceiros, grava o backup, reinstalar não duplica, `uninstall` remove só as entradas do Flightdeck, `status` reporta instalado/ausente/desatualizado |
| `hooks-receptor` | escuta só em `127.0.0.1`; token errado dá 401; cada evento da tabela muda o estado da sessão externa; hooks de sessão gerenciada são ignorados |
| `hook-comando` | `flightdeckd hook session-start` repassa a entrada e o launch id; com o receptor fora do ar sai com código 0 em menos de 2 s |
| `permissao-externa` | sem app conectado responde vazio na hora; com app, segura e publica na fila; `permission.respond` devolve o JSON de allow e de deny; conexão caída ou evento posterior da sessão tira o pedido da fila |
| `sessoes-externas` | transições da tabela de estados, `stale` após o limite, `unknown` depois de reiniciar, `controllable` segue o canal |
| `wrapper` | `flightdeckd claude` acha o `claude` com `whichOnPath`, repassa argumentos e código de saída, acrescenta o canal, o `--mcp-config` e o launch id, e avisa sem `claude` no PATH |
| `canal` | declara `claude/channel` e nenhuma ferramenta; se liga à sessão pelo launch id; mensagem do daemon vira `notifications/claude/channel`; conexão sem token é recusada |
| `mensagem-externa` | `external.message` chega ao canal certo; sessão sem canal é recusada com erro claro |
| `projeto-chave` | SSH e HTTPS do mesmo remoto dão a mesma chave; worktree cai no repositório principal; sem remoto e sem repositório usam o fallback |
| `ao-vivo` | linha nova no transcript gera `history.changed` em até 2 s; o leitor acrescenta as mensagens sem recarregar |
| `sessao-meta` | nome, fixada e arquivada persistem e voltam nas três listas |
| `central-ui` | a lista junta sessões gerenciadas, externas e do histórico de dois hosts no mesmo grupo de projeto; filtros; fixadas no topo; arquivadas escondidas; pedido externo aparece em Precisa de você e é respondido; a caixa de mensagem só aparece para sessão controlável |
| `hooks-ui` | a tela do host mostra o estado dos hooks; Instalar e Remover pedem confirmação |

**Smoke (`bun run smoke:central`)**

Começa vermelho e roda com as travas ativas. Sobe um daemon `--runtime fake` com HOME temporário e roda `hooks install` nele. Conecta como app pelo protocolo e abre uma sessão por `flightdeckd claude` com o `claude` falso, que:

1. dispara `SessionStart` e `UserPromptSubmit`;
2. escreve o transcript;
3. pede permissão para um `Write`.

Daí em diante o smoke:

- confere a sessão externa em `external.list`, controlável e no grupo do projeto, e aprova o pedido pelo `permission.respond`;
- manda uma mensagem por `external.message` e confere que o falso a recebeu pelo canal;
- confere `history.changed` com a linha nova;
- encerra com `SessionEnd`.

No fim, roda `hooks uninstall` e confere o `settings.json` igual ao original. Imprime `SMOKE CENTRAL OK`.

**Critérios de aceite**

- [ ] Para cada área da tabela acima, a conversa mostra o teste falhando por asserção antes da implementação e passando depois.
- [ ] `bun run tdd:audit -- --since fase-4` imprime `TDD AUDIT OK`.
- [ ] `bun run typecheck`, `bun run lint` e `bun run test` saem com código 0, com cobertura de 100%.
- [ ] `bun run smoke`, `smoke:multi`, `smoke:history`, `smoke:board` e `smoke:central` imprimem `SMOKE OK`, `SMOKE MULTI OK`, `SMOKE HISTORY OK`, `SMOKE BOARD OK` e `SMOKE CENTRAL OK`.
- [ ] `bun run build:daemon` e `bun run build:desktop` saem com código 0, e `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` também, no Windows nativo, se a casca Rust tiver mudado.
- [ ] README explica:
  - o que aparece na lista e de onde vem;
  - `hooks install`, `uninstall` e `status`, e o que eles escrevem;
  - `flightdeckd claude` e o alias `fd`;
  - o que funciona com `claude` puro e com `flightdeckd claude`;
  - que o canal é research preview;
  - por que a extensão do VS Code fica de fora.
- [ ] Divergências registradas em `docs/DECISIONS.md`.
- [ ] `git status` limpo e a tag `fase-5` criada.
