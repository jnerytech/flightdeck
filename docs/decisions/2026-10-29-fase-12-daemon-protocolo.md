# Decisões e divergências da Fase 12 (daemon e protocolo) (phase 12)

O que a spec da Fase 12 (checkpoints, bifurcação e configuração do agente) deixou aberto, ou o que mudou na implementação. As áreas de interface (`linha-do-tempo-ui` e `agente-ui`) esperam a base nova da Fase 10.

## Snapshots

- **Como:** um índice temporário (`GIT_INDEX_FILE`) recebe o HEAD e todas as mudanças, com os não rastreados e sem os ignorados. A árvore vira um commit, com identidade própria, para o qual só aponta `refs/flightdeck/snapshots/<sessão>/<n>`. O índice, os arquivos e o `git status` do usuário não mudam.
- **Árvore igual:** o snapshot ganha a linha (o turno continua contado), mas reusa a ref do anterior e não cria commit nem ref.
- **Limites:** fora de um repositório, ou com mais de 200 MB de mudanças (`maxBytes`), o snapshot é pulado com o motivo.
- **Fila:** um snapshot de cada vez, em segundo plano. Uma falha é descartada e não derruba o turno.
- **Quando:**
  - Sessão do terminal: `UserPromptSubmit` dá o `before`, com o prompt, e `Stop` dá o `after`. O hook só enfileira.
  - Sessão gerenciada: o `SessionManager` avisa as bordas do turno. O primeiro `before` espera o `session.init` dar o id da sessão.
- **Tabela:** `snapshots` guarda o `repo` (a raiz do repositório) além do que a spec lista, porque o rewind precisa dele sem a sessão viva.
- **Retenção:** a manutenção diária mantém 50 por sessão e 30 dias, e apaga as refs que nenhuma linha usa mais.

## Rewind

- **Turno:** é o `n` de um snapshot `before`.
- **Pelo SDK:** com a sessão gerenciada viva e o uuid do turno conhecido, vai pelo `rewindFiles` do SDK, com `enableFileCheckpointing` ligado.
  - O Flightdeck manda cada mensagem do usuário com um uuid próprio, e é esse uuid que o `rewindFiles` recebe. Falta conferir com o claude real que o SDK aceita o uuid fornecido; isso fica para o fechamento da fase.
- **Pelo snapshot:** em todos os outros casos. A prévia e a aplicação vêm de `git diff --name-status` e `--numstat` entre a árvore do turno e a atual.
  - Os arquivos do snapshot voltam e os criados depois saem, só dentro do repositório e nunca os ignorados.
- **Segurança:** antes de aplicar, um snapshot `safety` do estado atual. O `rewind.undo` volta a ele. Se ele não puder ser tirado (acima do limite), o rewind recusa e não muda nada.
- **Recusas:** sem `confirm`, e com a sessão no meio de um turno.

## Bifurcar

- **SDK:** o `forkSession` fica atrás do runtime. O `FakeRuntime` imita, com ids `fake-fork-…`.
- **Abrir:** `flightdeck` abre uma sessão gerenciada com `resume` no id novo. `terminal` devolve o comando para abrir.
- **`rewindTurn`:** opcional, volta os arquivos ao turno antes de bifurcar.
- **Escrita no `~/.claude`:** a transcrição nova, gravada pelo próprio SDK em `~/.claude/projects`, é a única desta fase.

## MCP do projeto

- **Origens:**
  - `.mcp.json` do projeto (`project`), a única editável;
  - `mcpServers` do `~/.claude.json` (`user`), só leitura;
  - `projects[<caminho>].mcpServers` do `~/.claude.json` (`user-project`), só leitura.
  - O caminho do projeto é comparado pelo `samePath` de `paths.ts`, sem caixa no Windows e no macOS.
- **Ligar e desligar:** move o nome entre `enabledMcpjsonServers` e `disabledMcpjsonServers` do `.claude/settings.local.json`, preservando o resto.
- **Segredos:** os valores de `env` e `headers` aparecem como `••••••`. Salvar com a máscara é recusado, então o segredo tem de ser digitado de novo.
- **Testar:**
  - Sem `confirm`, só o comando e os argumentos exatos (ou a URL). Abrir a lista não inicia nada.
  - Com `confirm`, sobe o servidor, lista ferramentas e recursos e para. O limite é de 15 s.
  - Um servidor sem recursos dá a lista vazia.
  - Um servidor com URL usa o cliente Streamable HTTP, com os headers reais.
- **Sessão viva:** o `toggle` com `sessionId` grava o `settings.local.json` e liga ou desliga na hora pelo runtime. Se a sessão não estiver viva, responde `invalid_state`, e a escolha gravada fica para as próximas sessões.
- **Status pelo `mcpServerStatus()`:** fica para o `agente-ui`, porque a tabela de testes da spec só pede o `toggle`.

## CLAUDE.md, agentes e skills

- **Caminhos:** são relativos ao projeto, ou ao `~/.claude` para os do usuário, com `origin` explícito em vez de um prefixo `~/`.
  - Cada tipo aceita só o seu padrão: `CLAUDE.md` em qualquer pasta ou o `CLAUDE.local.md` da raiz, `.claude/agents/<nome>.md` e `.claude/skills/<nome>/SKILL.md`.
- **Descoberta dos CLAUDE.md:** uma caminhada pela pasta do projeto, pulando `.git` e `node_modules`, até 8 níveis, sem seguir links, mais o `CLAUDE.local.md` da raiz.
  - Não usa `git ls-files`, que esconderia o `CLAUDE.local.md`, normalmente ignorado.
- **Hash:** sha256 dos bytes do arquivo. `expectedHash: null` cria um arquivo que ainda não existe e gera as pastas.
- **Conflito:** hash velho, ou criar por cima de um arquivo que existe, responde `invalid_state` e não muda nada.
  - A Fase 11 ainda não tinha um código próprio para isso. Quando ela entrar, os dois convergem.
- **Frontmatter:** lido com o `Bun.YAML`. `name` e `description` são obrigatórios. Num agente, `tools` é texto ou lista de textos, e `model` é texto. Não há lista de modelos.
  - YAML que não é um mapa (vazio, lista) fica sem `name` e é recusado.
- **Nada fora do projeto:** são recusados `..`, caminho absoluto, caminho de outro tipo, e pasta que resolve para fora.
  - A conferência usa o ancestral existente mais próximo do arquivo (por `lstat`, então um link quebrado também conta), resolvido com `realpath`.
- **Usuário:** o `~/.claude` é só lido. Os testes injetam `claudeDir` e nunca leem o real.

## TDD e testes

- **Ramos revelados pela cobertura (regra 7):**
  - o transporte HTTP do Testar;
  - o servidor sem recursos;
  - a sessão que não está viva;
  - salvar, ligar e remover pelo protocolo;
  - o daemon sem a config de MCP;
  - os servidores do `~/.claude.json` no Testar;
  - o `not_found` de ligar um servidor que não existe.
  - O ramo "YAML que não é mapa" do frontmatter não ficou vermelho ao sair, porque a validação já recusava. Ele era código morto e saiu.
- **Correções de teste antes do `feat` (regra 8):**
  - o limite de 300 ms só para o servidor que não responde;
  - a leitura da mensagem do erro no teste do timeout;
  - a retenção do teste de manutenção ganhou o `usageDays` da Fase 8;
  - o teste de uso não fixa mais o índice da migração.
- **`fix(desligar)`:** o teste `update > peças reais` falhava às vezes no Windows. O `daemon.shutdown` começava a fechar num `setTimeout(0)`, que no Windows pode levar um tique de cerca de 15 ms. Passou a fechar num microtask logo depois do ack, com o teste vermelho antes.
- **`smoke:checkpoints`:**
  - O claude falso ganhou os passos `write` e `wait-file`. Cada turno espera o smoke ver o snapshot `before`, porque o hook só enfileira.
  - O smoke foi escrito depois das áreas. O vermelho foi mostrado tirando a fiação dos snapshots do Central: `SMOKE CHECKPOINTS FAIL no passo "primeiro turno": timeout: snapshot antes do primeiro turno (0 snapshots)`, com exit 1.

## Rebase sobre a Fase 9

- **Migração:** a dos snapshots foi renumerada para depois das três da Fase 8 (uso, orçamentos e amostras da cota).
- **`test(uso)`:** igual à mudança que a Fase 8 já tinha feito, então saiu vazio e foi pulado.
- **`server.ts`:** imports dos dois lados.
