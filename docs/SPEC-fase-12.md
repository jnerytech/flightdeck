# Flightdeck — Spec da Fase 11 (Checkpoints e configuração do agente)

## Objetivo e escopo

- **Voltar no tempo:** desfazer as mudanças de arquivo até um turno, ou bifurcar a conversa a partir dele, nas sessões gerenciadas e nas do terminal.
- **Configurar o agente pelo app:**
  - servidores MCP do projeto;
  - `CLAUDE.md`;
  - agentes (`.claude/agents`);
  - skills (`.claude/skills`).

Pré-requisito: Fase 8 fechada. A fase pode ser desenvolvida em paralelo às Fases 9 e 10, num worktree próprio, e é rebaseada sobre a fase anterior integrada antes de fechar.

As ideias vêm do opcode (timeline, checkpoints, MCP manager, editor de CLAUDE.md e agentes), do Agent Console (snapshot git por turno) e do agent-deck (MCP e skills por projeto).

**Regra de escrita:** a configuração do usuário fica **só para leitura**: `~/.claude.json`, `~/.claude/CLAUDE.md`, `~/.claude/agents` e `~/.claude/skills`. O Flightdeck escreve só arquivos do projeto, sempre com confirmação. Em `~/.claude`, o próprio Flightdeck continua escrevendo só os hooks da Fase 5. A exceção é a bifurcação que **você** pede: o `forkSession` do SDK grava o transcript novo em `~/.claude/projects`, escrito pelo próprio SDK, como qualquer sessão do Claude Code.

**Fora da Fase 11**

- Editar a configuração global do usuário.
- Registry ou marketplace público de MCP e plugins.
- Desfazer comandos externos: banco, rede, `git push`. O rewind cobre arquivos, e o app diz isso.

## Fatos do Agent SDK 0.3.312 (verificados nos tipos)

- `enableFileCheckpointing: true` nas opções do `query` guarda cópias dos arquivos antes de cada mudança.
- `Query.rewindFiles(userMessageId, {dryRun})` devolve `{canRewind, error?, filesChanged?, insertions?, deletions?, skippedLinks?}`.
- `forkSession(sessionId, {upToMessageId?, title?})` copia o transcript até a mensagem e devolve um `sessionId` novo, que se retoma com `resume`. Funciona sobre qualquer transcript do host, inclusive de sessões do terminal.
- `Query.mcpServerStatus()` e `Query.toggleMcpServer(name, enabled)` existem para a sessão viva.
- **Limite do checkpoint do SDK:** ele não cobre mudanças feitas por `Bash` nem por subagentes. Por isso a fase soma snapshots git.

## Design

### Snapshots git por turno

- **Quando:**
  - sessão do terminal: o hook `UserPromptSubmit` (Fase 5) e o `Stop`;
  - sessão gerenciada: o início e o fim de cada turno.
  - Em ambos os casos, só se o `cwd` está num repositório git.
- **Como:** o daemon grava um snapshot **sem tocar no índice nem nos arquivos do usuário**:
  ```
  GIT_INDEX_FILE=<tmp> git read-tree HEAD
  GIT_INDEX_FILE=<tmp> git add -A          # inclui não rastreados; respeita .gitignore
  tree=$(GIT_INDEX_FILE=<tmp> git write-tree)
  commit=$(git commit-tree $tree -p HEAD -m "flightdeck snapshot <session> <turno>")
  git update-ref refs/flightdeck/snapshots/<claudeSessionId>/<n> $commit
  ```
  Se a árvore for igual à do snapshot anterior, nenhum ref novo é criado.
- **Tabela:**
  ```sql
  CREATE TABLE snapshots (claude_session_id TEXT, n INTEGER, ref TEXT, tree TEXT, kind TEXT, turn_uuid TEXT,
                          prompt TEXT, created_at TEXT, PRIMARY KEY (claude_session_id, n));
  ```
  - `kind` é `before` ou `after`.
  - `turn_uuid` é o uuid da mensagem do usuário, quando o transcript traz.
- **Limites:**
  - snapshots de no máximo 200 MB de mudanças; acima disso, pula e registra o motivo;
  - retenção de 50 por sessão e 30 dias, com limpeza dos refs junto da retenção da Fase 7.
- **Desempenho:** roda em segundo plano, sem atrasar a resposta do hook. O hook só enfileira.

### Voltar arquivos

- **"Voltar arquivos até aqui"** num turno da linha do tempo da sessão. Primeiro mostra a prévia: arquivos que mudam, inserções e remoções.
  - Na sessão gerenciada viva com checkpoint do SDK, usa `rewindFiles` com `dryRun` e depois o real. Se o SDK não puder (`canRewind: false`), usa o snapshot.
  - Nos outros casos, usa o snapshot `before` do turno. Os arquivos do snapshot são restaurados no working tree, e os arquivos criados depois dele são removidos. Tudo isso só no escopo do repositório, nunca em ignorados.
- **Antes de aplicar:** um snapshot de segurança do estado atual (`kind: safety`) permite "Desfazer volta".
- **Confirmação:** sempre pedida. Sessão viva rodando um turno não pode voltar; pare a sessão primeiro.

### Bifurcar

- **"Bifurcar daqui":** cria, com `forkSession(id, {upToMessageId})`, uma conversa nova até aquele turno.
  - Sessão gerenciada: abre a bifurcação como nova sessão gerenciada, com `resume`.
  - Sessão do terminal: oferece "Abrir no terminal" (Fase 8) com `flightdeckd claude --resume <novo id>`, ou "Abrir no Flightdeck".
- **Arquivos:** junto, a opção "voltar também os arquivos" aplica a volta acima antes de abrir a bifurcação.

### MCP do projeto

- **Leitura:** o app mostra os servidores que valem para o projeto, com a origem de cada um:
  - `.mcp.json` do projeto, editável;
  - `~/.claude.json`, na parte do usuário e na do projeto, só leitura;
  - `enabledMcpjsonServers` e `disabledMcpjsonServers` do `.claude/settings.local.json`, editáveis.
- **Escrita:**
  - adicionar, editar e remover no `.mcp.json`. Esse arquivo é **versionado**, e o app avisa;
  - ligar e desligar pela lista do `settings.local.json`.
  - As duas mesclam e preservam o resto do arquivo.
- **Segredos:** valores de `env` e `headers` aparecem mascarados. Editar exige digitar o valor de novo.
- **"Testar":** sobe o servidor com o cliente do `@modelcontextprotocol/sdk` (stdio ou http), lista ferramentas e recursos, e derruba. Timeout de 15 s. Não envolve o Claude.
  - Um servidor stdio roda um comando que veio do repositório. Por isso, antes de testar, o app mostra o **comando e os argumentos exatos** e pede confirmação, como a confiança de workflows da Fase 6.
  - Nenhum servidor é iniciado só porque a lista foi aberta.
- **Sessão gerenciada viva:** mostra o status por `mcpServerStatus()` e liga ou desliga na hora por `toggleMcpServer`.

### CLAUDE.md, agentes e skills

- **CLAUDE.md:**
  - lista os do projeto: raiz, `.claude/CLAUDE.md`, `CLAUDE.local.md` e os de subpastas;
  - o do usuário aparece só para leitura.
  - Editor markdown com prévia. Salvar compara o hash, como na Fase 10.
- **Agentes:**
  - `.claude/agents/*.md` do projeto, editáveis; os do usuário, só leitura.
  - Formulário para o frontmatter (`name`, `description`, `tools`, `model`), mais o corpo.
  - O frontmatter é validado antes de salvar.
- **Skills:**
  - `.claude/skills/<nome>/SKILL.md` do projeto, editáveis; as do usuário, só leitura.
  - Criar uma skill gera a pasta e o `SKILL.md` com o frontmatter (`name`, `description`).
- **Mudanças em arquivos versionados:** aparecem na aba Mudanças (Fase 10) como qualquer outra mudança.

### Protocolo (só adições)

| Item | Tipo | Conteúdo |
| --- | --- | --- |
| `snapshots.list` | comando | `claudeSessionId`; snapshots com turno e prompt |
| `rewind.preview` / `rewind.apply` / `rewind.undo` | comando | `claudeSessionId`, `turn`; `apply` com `confirm` |
| `session.fork` | comando | `claudeSessionId`, `upToMessageId`, `rewindFiles?`, `open` (`flightdeck` ou `terminal`) |
| `mcp.list` / `mcp.test` / `mcp.save` / `mcp.remove` / `mcp.toggle` | comando | `projectId`; `save`, `remove` e `toggle` com `confirm` |
| `agentcfg.list` / `agentcfg.read` / `agentcfg.write` | comando | `projectId`, `kind` (`claudemd`, `agent` ou `skill`), `path`; `write` com `expectedHash` e `confirm` |

### App

- **Linha do tempo da sessão:**
  - cada turno com o prompt, a hora e os arquivos que mudaram;
  - ações "Voltar arquivos até aqui" e "Bifurcar daqui", com prévia e confirmação.
- **Projeto → Agente:** abas MCP, CLAUDE.md, Agentes e Skills, com a origem e o "só leitura" de cada item.

## Migrações com trilhas em paralelo

Várias fases criam tabelas ao mesmo tempo. A regra:

- cada uma acrescenta as próprias migrações no fim do array;
- no rebase sobre a fase integrada anterior, renumera as suas para depois das que já entraram;
- nenhum teste fixa o índice de uma migração.

## Disciplina TDD

Segue [`docs/TDD.md`](TDD.md).

**Travas:**
- Os snapshots só em repositórios temporários.
- O `forkSession` e o `rewindFiles` atrás da interface do runtime, com o `FakeRuntime` imitando o resultado.
- Os servidores MCP de teste são scripts locais. Nada de rede.
- A trava de home garante que nada é escrito no `~/.claude` nem no `~/.claude.json`, e reprova a suíte se um teste tentar.

## Testes e critérios

| Área | O que precisa passar |
| --- | --- |
| `snapshots` | snapshot sem mudar índice nem arquivos do usuário (conferido por `git status` e hash); inclui não rastreados e respeita ignorados; árvore igual não cria ref; limites e retenção; hook só enfileira |
| `rewind` | prévia e aplicação pelo SDK falso e pelo snapshot; arquivos criados depois são removidos; snapshot de segurança e desfazer; recusa com turno em andamento e sem confirmação |
| `bifurcar` | `forkSession` com `upToMessageId`; abre gerenciada com `resume` ou oferece terminal; opção de voltar arquivos junto |
| `mcp-projeto` | origens e só leitura certos; mescla preservando o resto; segredos mascarados; `test` exige `confirm` com o comando exato, lista ferramentas de um servidor stdio local e respeita o timeout; abrir a lista não inicia servidor; `toggle` na sessão viva pelo runtime falso |
| `config-agente` | CLAUDE.md, agentes e skills do projeto listados e editáveis; os do usuário só leitura; frontmatter validado; conflito por hash; nada escrito fora do projeto |
| `linha-do-tempo-ui` | turnos com arquivos; prévia, confirmação e desfazer; bifurcar com as duas opções |
| `agente-ui` | abas MCP, CLAUDE.md, Agentes e Skills; avisos de versionado e de só leitura; testar servidor |

**Smoke (`bun run smoke:checkpoints`)**

- Daemon `--runtime fake` e um repositório temporário.
- Uma sessão do terminal pelo claude falso faz dois turnos que editam e criam arquivos. Os snapshots são criados e o `git status` do usuário não muda por causa deles.
- `rewind.apply` para antes do segundo turno restaura os arquivos e remove o criado; `rewind.undo` volta.
- `session.fork` gera um id novo.
- `mcp.test` de um servidor stdio local lista as ferramentas dele.
- Imprime `SMOKE CHECKPOINTS OK`.

**Critérios de aceite**

- [ ] O vermelho por asserção de cada área mostrado antes da implementação.
- [ ] `tdd:audit` OK desde o commit-base.
- [ ] typecheck, lint e test com cobertura de 100%.
- [ ] Todos os smokes, inclusive o `smoke:checkpoints`.
- [ ] Os builds e o `cargo check` passam.
- [ ] CI verde.
- [ ] Versões em `0.11.0`.
- [ ] README atualizado, com os limites do rewind ditos com clareza.
- [ ] `docs/DECISIONS.md` atualizado e git limpo.
- [ ] Tag `fase-11` criada pelo orquestrador, depois da confirmação com o claude real: rewind e fork numa sessão de verdade.
