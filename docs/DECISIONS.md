# Decisões e divergências da Fase 1

Cada item registra onde a implementação diverge de `docs/SPEC.md` ou completa um ponto que a
spec deixou em aberto. A regra 6 da spec ("escolher a opção mais simples compatível") guiou as
escolhas.

## Versões fixadas

| Peça | Versão |
| --- | --- |
| Bun | 1.4.4 |
| `@anthropic-ai/claude-agent-sdk` | 0.3.312 (exata) |
| zod | 4.6.7 (peer dependency do SDK é `^4`) |
| TypeScript | 7.0.2 |
| Biome | 2.6.3 |
| Tauri | crates `2.x` (resolvido 2.12.5), `@tauri-apps/cli` 2.12.4 |
| React / Vite | 19.3.1 / 8.3.5 |

O `cargo search` mostra 3.0 alpha como versão mais nova do Tauri. Por isso os crates estão
fixados no major `2`, como pede a spec.

## Protocolo

- **`PermissionMode` inclui `auto`.** O tipo `PermissionMode` do SDK instalado é
  `default | acceptEdits | bypassPermissions | plan | dontAsk | auto`, e o protocolo segue os
  tipos do SDK.
- **`hello` também devolve `allowedRoots`.** A tela de nova sessão precisa listar as pastas
  permitidas, e não existe outro comando para isso. A mudança só acrescenta um campo e é
  compatível com `protocolVersion: 1`.
- **`session.send` responde `{ queued: boolean }`.** É o "aceito ou enfileirado" da spec.
- **`session.subscribe` responde `{ session, replayed }`.** O ack sai antes dos eventos de
  replay, no mesmo passo síncrono em que o cliente é registrado. Assim não há buraco nem
  duplicado.
- **`turn.result` tem `isError`**, além de `subtype`, `durationMs`, `costUsd` e `usage`.
- **Ack de erro sem id.** Se o frame não é JSON ou não traz `id`, o ack de erro usa `id: ""`.
- **`message.delta` carrega o último `seq` persistido**, sem incrementá-lo. O envelope exige
  `seq`, mas o delta não é gravado. O cliente não avança o `lastSeq` com deltas.
- **Endpoint `GET /health`** devolve `{ ok: true }`. Qualquer outra rota HTTP responde 404, e
  `/v1/ws` sem upgrade responde 426.

## Daemon

- **Migrações versionadas por `PRAGMA user_version`.** Isso mantém exatamente as três tabelas da
  spec, sem uma tabela extra de controle.
- **Estados no boot.** Além de `running` e `awaiting_permission`, sessões em `starting` também
  viram `error` ("daemon reiniciado"). Pedidos `pending` viram `expired` e geram
  `permission.resolved`.
- **Sessão `idle` depois de reiniciar** não vira erro. O próximo `session.send` reabre o runtime
  com `resume` de forma transparente.
- **`session.resume`** reabre o runtime e vai direto para `idle` (motivo "retomada"). O
  `session.init` chega no próximo envio, porque o CLI só emite o init ao receber uma mensagem.
- **Interrupt descarta a fila** de mensagens pendentes daquela sessão. Quem interrompe quer parar,
  não continuar com o que estava enfileirado.
- **Deny sem mensagem** usa "Negado pelo usuário". O SDK exige `message` no deny.
- **Allow sem `updatedInput`** devolve ao SDK o input original como `updatedInput`.
- **Runtime que termina sem `close`** leva a sessão a `error` com `session.error`
  `runtime_exit`.
- **`message.assistant` pode vir mais de uma vez por turno.** Com `includePartialMessages`, o
  SDK entrega cada bloco num `SDKAssistantMessage` próprio, e cada um vira um evento. Tráfego de
  subagentes (`parent_tool_use_id` preenchido) é ignorado, assim como blocos `thinking`.
- **`tool.result` é resumido** em até 4000 caracteres.
- **Executável do Claude.** Pelo código-fonte, o SDK usa o executável que traz consigo. Dentro de
  um binário `bun build --compile`, esse caminho não existe, então o daemon usa o `claude` do
  `PATH`. O novo campo opcional `claudePath` na config sobrescreve os dois.
- **CLI.** O `main.ts` exporta `parseArgs`, `startDaemon` e `runCli`, todos cobertos por testes.
  O ponto de entrada do processo é o `bin.ts`, que só chama `runCli`. Os scripts `start`, `smoke`
  e `build:daemon` usam o `bin.ts`.
- **Gatilhos do `FakeRuntime`:** `[tool]` pede permissão para `Write`, `[fail]` derruba o runtime,
  e interrupt encerra o turno com `turn.result` `error_during_execution`, como o SDK.
- **Permissão restrita na config.** O arquivo é criado com modo `0600`. No Windows a chamada não
  tem efeito, e as ACLs do perfil do usuário valem.

## Smoke

- O roteiro da spec é seguido. Para o replay provar algo, um segundo cliente envia uma mensagem
  enquanto o primeiro está desconectado. O primeiro reconecta com `sinceSeq` e confere que recebeu
  exatamente os `seq` perdidos, contíguos e sem duplicados.

## App desktop

- **Token no keyring do sistema.** Três comandos Tauri próprios (`token_get`, `token_set`,
  `token_delete`) usam o crate `keyring` 3 (Credential Manager, Keychain, Secret Service). Foram
  escolhidos no lugar do plugin Stronghold, que é bem mais pesado. Nome e URL dos hosts ficam no
  `localStorage`.
- **O app se inscreve em todas as sessões de cada host.** É assim que a barra lateral mantém os
  selos de status atualizados e que chegam notificações de qualquer sessão. Para uso pessoal, o
  volume é pequeno.
- **Notificações só para eventos novos.** O ack do `session.subscribe` informa o `lastSeq` do
  momento da inscrição, e eventos até esse `seq` são replay. Isso evita notificar de novo pedidos
  antigos a cada reconexão.
- **Host com token errado** (fechamento 4401) fica em `unauthorized` e não tenta reconectar.
  Outras quedas seguem o backoff de 1 s a 30 s.
- **Pasta da nova sessão:** escolhe-se uma das `allowedRoots` e, opcionalmente, uma subpasta. O
  daemon valida o caminho final.
- **CSP** do webview libera `connect-src ws: wss:` para alcançar os daemons.
- **`cargo check` precisa de `apps/desktop/dist`.** O `generate_context!` do Tauri lê o
  `frontendDist`, então rode `bun run build:desktop` antes.

## Qualidade

- **Cobertura de 100%.** Foi pedida durante a implementação. O `bunfig.toml` fixa
  `coverageThreshold = { lines = 1.0, functions = 1.0 }`, e o `bun test` sai com código 1 se algum
  arquivo carregado ficar abaixo disso. Como o Bun só mede arquivos que algum teste importa, o
  `scripts/check-coverage.ts` (rodado por `bun run test`) confere que todo arquivo-fonte de
  `packages/*/src`, `apps/*/src` e `scripts/lib` aparece no lcov com 100%.
  - O Bun não mede branches, então "100%" quer dizer linhas e funções.
  - Ficam fora: os pontos de entrada `apps/daemon/src/bin.ts` e `apps/desktop/src/main.tsx`, que
    não têm lógica própria; módulos só de tipos, que não geram código; os CLIs em `scripts/`,
    exercitados pelo smoke e pelos builds; e a casca Rust do Tauri.
- **Testes de UI** usam happy-dom e Testing Library, registrados só dentro de
  `apps/desktop/test/ui.test.tsx`. Os primitivos de rede do Bun (`WebSocket`, `fetch`) são
  preservados, porque a UI conversa com um daemon real em processo. React e Testing Library são
  carregados com `import()` depois de o DOM existir.
- **Saída do `bun test`.** Quando a variável `CLAUDECODE` está definida (sessões do Claude Code),
  o Bun esconde as linhas `(pass)`. Para ver cada teste aprovado, rode
  `env -u CLAUDECODE bun test`.
- **Biome não formata Markdown.** O formatador alterou o preenchimento das tabelas do
  `docs/SPEC.md` antes do primeiro commit. O texto foi restaurado, mas espaços em branco do
  original podem diferir (18466 → 18109 bytes), e não há cópia anterior no git.

# Decisões e divergências da Fase 2

Registra onde a implementação diverge de `docs/SPEC-fase-2.md` ou completa um ponto que a spec
deixou em aberto.

## Versões novas

| Peça | Versão |
| --- | --- |
| `qrcode` / `@types/qrcode` | 1.5.4 / 1.5.6 |
| `@tauri-apps/plugin-deep-link` | 2.6.3 |
| `@tauri-apps/plugin-opener` | 2.7.2 |
| `@tauri-apps/plugin-autostart` | 2.7.0 |
| Crates `tauri-plugin-{deep-link,opener,single-instance,autostart}` | major `2` |

## Serviço

- **Tarefa do Windows por XML.** `schtasks /Create /TN Flightdeck\flightdeckd /XML <arquivo> /F`
  com um XML em UTF-16 com BOM: `LogonTrigger` do próprio usuário, `InteractiveToken`,
  `LeastPrivilege`, `MultipleInstancesPolicy=IgnoreNew`, sem limite de tempo e com
  `RestartOnFailure` (1 min, 999 vezes). A ação é `conhost.exe --headless "<flightdeckd>" start`,
  que esconde o console sem esconder a saída do `pair` (o `--windows-hide-console` do Bun
  esconderia). O XML é gravado na pasta temporária do usuário.
- **Não verificado num sistema real:** a criação da tarefa por um usuário sem administrador e o
  comportamento do `conhost --headless` no logon. Os testes cobrem só o XML e os argumentos; nenhum
  serviço foi instalado durante o desenvolvimento.
- **Unit do systemd** declara `After=`/`Wants=network-online.target`, além do que a spec pede.
- **`--dry-run` não chama `loadConfig`.** Só mostra o `claude.executablePath` que seria gravado.
  Sem `--dry-run`, o `install` chama `loadConfig` primeiro (cria a config com token, se faltar, e
  valida a existente) e só então grava o caminho, de forma atômica (arquivo temporário +
  `rename`), preservando os outros campos.
- **`service status`** imprime a saída de `systemctl --user is-active flightdeckd` ou de
  `schtasks /Query`; sem saída, "não instalado".
- **Comandos que não existem** (por exemplo `systemctl` fora do Linux) fazem o `install` falhar
  com a mensagem do sistema e código 1.
- **Lock de instância única:** `dataDir/flightdeckd.lock` com o pid. Lock com pid morto ou
  conteúdo ilegível é retomado. Se o daemon falhar depois de pegar o lock (porta ocupada, por
  exemplo), o processo sai e o próximo retoma o lock do pid morto.

## Supervisão do WSL

- Quando o filho sai com código 3 e a porta responde, a próxima conferência é em 60 s (sem
  backoff). Sem a porta, conta como falha comum.
- O supervisor só existe quando a seção `wsl` tem itens, em qualquer sistema; na prática, só a
  config do Windows a preenche.

## Rede, heartbeat e pareamento

- **Filtro de origem** usa o IP que o Bun informa para a conexão (`server.requestIP`). Vale para
  todas as rotas, `/health` incluída.
- **Heartbeat:** o fechamento 4408 acontece no tique seguinte ao segundo ping sem resposta (entre
  30 s e 45 s com o intervalo padrão). Um `pong` com id conhecido zera as pendências e define o
  `lastRttMs` (arredondado em ms) enviado no próximo `ping`.
- **`pair --rotate` e o daemon em execução:** o daemon acompanha o arquivo de config por
  `fs.watchFile` (a cada 2 s). Quando o token muda, todas as conexões autenticadas são fechadas
  com 4401, porque só um token vale por vez.
- **QR** é desenhado em caracteres UTF-8 pelo pacote `qrcode`.
- **Parser do link:** esquema sem diferença de maiúsculas, barra final aceita e, sem `name`, o
  nome vira o endereço.
- **`tailscale ip -4`** que falha, não existe ou não imprime nada leva ao `bind`.

## `host.info`

- `claudePath` é o executável que o runtime vai usar: `claude.executablePath`, senão `claudePath`,
  senão o `claude` do `PATH` apenas no binário compilado. Pelo código-fonte e sem caminho
  configurado, o SDK usa o CLI que traz consigo; aí `claudePath` e `claudeVersion` são `null` e a
  sonda não executa nada.
- A sonda roda `<claude> --version` uma vez por processo (memoizada).

## Deploy

- `ssh`, `target` e `path` de `deploy.hosts.json` são validados. O `path` vai sem aspas para o
  shell remoto, então só aceita caracteres de caminho simples (`~`, letras, dígitos, `._/-`).
- O binário é marcado executável (`chmod +x`) antes da troca. `deploy.hosts.json` está no
  `.gitignore`.

## App desktop

- **Plataforma web:** segredos só em memória (uma página não tem lugar seguro para tokens), deep
  link por `#link=<url codificada>`, e a "bandeja" vira o título da janela (`(N) Flightdeck`). O
  segundo parâmetro de `createWebPlatform` injeta o mapa de segredos; os testes de UI usam isso.
- **Assinaturas:** cada host recebe `sessions.watch`, e o stream completo só é assinado para a
  sessão aberta. Trocar de sessão cancela a assinatura da anterior; ao voltar, o replay começa do
  último `seq` visto.
- **Notificações** comparam o resumo anterior com o novo da mesma sessão: cada `requestId` novo
  gera "esperando você" e a passagem de um estado de turno para `idle` gera "turno concluído". O
  rótulo é `<host> · <sessão>`.
- **Bandeja:** a contagem e a dica são calculadas no frontend (`trayStatus`) e enviadas ao Rust
  pelo comando `tray_set_status`. O item "Precisa de você (N)" e o clique no ícone trazem a janela
  de volta.
- **Lint da camada `platform`:** override do Biome em `apps/desktop/src/**`, exceto
  `src/platform/tauri/**`, com `noRestrictedImports` para `@tauri-apps/**`.
- **Testes de UI** registram o happy-dom uma vez por processo (`registerDom`) e consultam o
  documento atual (`liveScreen`). A nota da Fase 1 sobre o registro só em `ui.test.tsx` não vale
  mais.

## TDD e testes

- **Áreas com app e daemon** (`heartbeat` e o reducer em `resumos`) ficam num arquivo só, em
  `apps/daemon/test/`, e importam o `HostConnection` e o reducer do desktop. Assim o teste do app
  roda contra o servidor real.
- **Esperas nos testes:** `poll` (em `apps/daemon/test/helpers.ts`) devolve `null` no tempo
  esgotado em vez de lançar, para o vermelho ser sempre de asserção.
- **Casos de recusa do link** (esquema, endereço, porta, token) entraram já em `pareamento`, porque
  o parser nasceu ali e precisava de cobertura de 100%; `deep-link` repete os casos do ponto de
  vista do app.
- **Lado nativo do Tauri** (Rust) não tem teste automatizado: os testes de `platform` conferem
  que o frontend chama os comandos e plugins certos, e o `cargo check` confere que o lado nativo
  compila.

# Decisões e divergências da Fase 3

Registra onde a implementação diverge de `docs/SPEC-fase-3.md` ou completa um ponto que a spec
deixou em aberto.

## Versões novas

| Peça | Versão |
| --- | --- |
| `@tauri-apps/plugin-global-shortcut` | 2.4.1 (exata) |
| Crate `tauri-plugin-global-shortcut` | major `2` (resolvido 2.4.1) |

## Trava de home

- **O que ela faz:** `scripts/test/home-guard.ts` aponta `HOME`, `USERPROFILE`, `HOMEDRIVE` e
  `HOMEPATH` para uma pasta temporária com um `.claude/projects` vazio. O preload, o `smoke`, o
  `smoke:multi` e o `smoke:history` instalam a trava. Eles abortam se `os.homedir()` ou o
  `expandHome("~/.claude")` do daemon não caírem nessa pasta, e conferem de novo no fim
  (`afterAll` e antes do OK).
- **Divergência:** a spec pede que a suíte reprove "se algo tocar o `~/.claude` real". Não há
  como detectar uma leitura: interceptar `node:fs` no preload não alcança os imports nomeados dos
  módulos (testado no Bun 1.4.4). A garantia vem do redirecionamento somado ao aborto. Todo
  caminho que o indexador lê sai de `history.roots`, e o `~` dessas raízes é resolvido pela
  variável de ambiente atual.
- **`expandHome` não mudou:** no Bun 1.4.4, `os.homedir()` já lê `USERPROFILE`/`HOME` no
  momento da chamada, e não na partida do processo. Testado: mudar a variável muda o resultado
  na hora. Por isso não houve ciclo TDD para "a resolução de `~` lê a variável atual": esse
  teste nunca ficaria vermelho.

## Formato dos transcripts

- **Linha de usuário só com `tool_result`** vira registro `tool_result` com texto vazio. Ela fica
  fora da busca e do título e não conta como mensagem.
- **Ids sem `uuid`:** resumos usam `summary:<leafUuid>`. Linhas cruas sem `uuid` usam
  `raw:<sha1 da linha>`, um id estável entre leituras.
- **Tipo conhecido mal formado** (por exemplo, `assistant` sem `message`) é guardado cru.
- **Linhas cruas** ficam guardadas inteiras, sem o corte de 8 KB, que vale para mensagens.
- **Título:** o resumo mais recente; sem resumo, a primeira mensagem do usuário cortada em 120
  pontos de código.

## Indexador

- **Tabela FTS fora das migrações.** As três tabelas da spec são a migração 2. A
  `history_fts` (FTS5 com conteúdo externo em `history_messages`) é criada no boot só quando há
  FTS5, porque no caminho `LIKE` a tabela virtual não pode existir. Só mensagens entram na FTS:
  linhas cruas e resultados de ferramenta ficam de fora. Apagar uma sessão (truncamento) usa o
  comando `delete` do FTS5. Trocar de SQLite com FTS5 para um sem (ou o contrário) pede
  `history reindex`.
- **Detecção do FTS5** por `pragma_compile_options` (`ENABLE_FTS5`), sem `try/catch`. A
  disponibilidade é injetável (`fts5`), e os testes rodam os dois caminhos.
- **Exclusão:** compara o `cwd` normalizado, com barras normais e sem barra final, ignorando a
  caixa no Windows e no macOS (sem realpath, porque os `cwd` antigos podem não existir mais). O
  arquivo excluído fica em `history_files` com `claude_session_id` nulo. Assim as próximas
  varreduras o pulam sem ler. O teste de caixa e barras só roda no Windows (`test.if`).
- **Sessão sem `cwd` conhecido** fica com `cwd` vazio até uma linha trazê-lo.
- **Origem:** é calculada a cada indexação e atualizada no início de cada varredura. Assim, um
  transcript indexado antes do `session.init` da sessão gerenciada passa a `flightdeck` na
  varredura seguinte.
- **`history.scanIntervalMs`** (opcional, mínimo 10 ms) troca o intervalo de 10 s da varredura
  de reserva. Existe para o `smoke:history` não esperar 10 s.
- **Observação de arquivos:** `fs.watch` recursivo em cada raiz, com uma janela de 50 ms para
  juntar rajadas. Uma raiz inexistente só é registrada no log, e a varredura periódica continua.
  Falhas de varredura também vão para o log, sem derrubar o daemon.
- **`history reindex`** pega o mesmo lock do daemon. Com um daemon rodando no `dataDir`, sai com
  código 3 e pede para pará-lo.

## Protocolo

- **`history.changed` não é um `SessionEvent`.** É um frame de topo do `ServerMessage`, porque
  não pertence a nenhuma sessão gerenciada e não tem `seq`. O app ainda não chama
  `history.watch`; o `HostConnection` ignora qualquer frame que não seja ack, evento ou ping.
- **Cursores** são deslocamentos em texto, opacos para o cliente. `history.get` devolve também
  `session`, e o `prevCursor` além do `nextCursor`. Páginas anteriores podem se sobrepor à atual,
  e o leitor descarta os repetidos pelo `uuid`.
- **`history.get`** devolve só mensagens, resumos e notas de sistema. Resultados de ferramenta
  e linhas cruas não fazem parte do transcript legível.
- **`history.list`** esconde sessões sem nenhuma mensagem. O filtro de período pega as sessões
  que tocam o intervalo (`last_ts >= from` e `first_ts <= to`). O de pasta pega a pasta e o que
  está abaixo dela.
- **Acertos de `history.search`** trazem, além de `snippet`, `ts` e `cwd`: `claudeSessionId`,
  `uuid`, `title`, `role` e `cursor`, a página de `history.get` que começa no acerto. O trecho
  marca cada ocorrência com `«` e `»`, e é montado em JS nos dois caminhos.
- **Casamento:** com FTS5, cada termo vira um prefixo entre aspas (sem sintaxe FTS vinda do
  usuário), com a remoção de acentos do tokenizador `unicode61`. Com `LIKE`, cada termo é uma
  substring, sem diferença de caixa só para ASCII. Nos dois, todos os termos precisam estar na
  mensagem.
- **`history.resume`:**
  - O nome padrão é o título do transcript.
  - O `cwd` precisa estar dentro de `allowedRoots` (`forbidden_cwd` se não estiver).
  - A recusa sem `force` usa `invalid_state`.
  - A sessão nasce em `idle` (motivo "retomada do histórico"), como `session.resume`. O
    `session.init` chega na primeira mensagem.

## App desktop

- **Busca global:** espera até 5 s por host. Hosts fora do ar entram direto como "sem
  resposta", e uma busca nova descarta as respostas atrasadas da anterior.
- **Histórico por host:** mostra as 200 sessões mais recentes, e os filtros estreitam a lista. O
  período usa dias inteiros em UTC (`T00:00:00.000Z` a `T23:59:59.999Z`), porque os horários dos
  transcripts estão em UTC.
- **Leitor:** páginas de 50 mensagens. A próxima carrega quando a rolagem chega a 80 px do fim;
  as anteriores, pelo botão "Carregar anteriores". Ele abre no acerto com `scrollIntoView` e o
  marca com `aria-current`.
- **Confirmação de "possivelmente em uso"** é um cartão dentro do app, e não um `window.confirm`.
- **Atalho global:**
  - Só `Shift` não conta como modificador, porque roubaria a digitação.
  - Os apelidos (`Control`, `Option`, `Cmd`, `Meta`, `Win`) são normalizados para os nomes que
    o plugin entende, na ordem `Ctrl+Alt+Shift+Super`.
  - Na plataforma web o atalho fica indisponível, porque uma página não ouve teclas fora de
    foco.
  - Ao trocar, o atalho antigo é desregistrado antes. O novo só é salvo se o sistema aceitar.
  - Recarregar o webview em desenvolvimento pode mostrar o aviso de conflito, porque o lado
    nativo continua com o atalho registrado.
- **Comando `focus_main`:** o helper Rust que traz a janela de volta virou `bring_to_front`, e o
  nome `focus_main` ficou para o comando que a `platform` chama quando o atalho é apertado.
- **Copiar** usa a Clipboard API do webview, sem plugin. A plataforma web falha com "área de
  transferência indisponível" quando a API não existe.

## TDD e testes

- **Escopos fora da tabela:** `platform` (atalho, janela e cópia nas duas implementações, com o
  lado Rust) e `historico-host` (a lista por host da seção App desktop da spec) tiveram os próprios
  ciclos `test` → `feat`.
- **O daemon dos testes de UI** (`apps/desktop/test/fixtures.ts`) agora tem índice de histórico
  sobre uma pasta temporária (`historyRoot`), e os testes chamam `history.scan()` depois de
  escrever os transcripts.
- **Ramos de erro do app** (`historyGet`), encontrados pela cobertura, seguiram a regra 7: o ramo
  foi removido, o teste ficou vermelho e só então o ramo voltou.

# Decisões e divergências da Fase 4

O que a spec da Fase 4 deixou aberto ou o que mudou na implementação. Inclui os pontos da revisão
de consistência da spec recebida durante a fase.

## Trava de CLIs e ambiente dos filhos

- **Sentinelas de `gh` e `az`** (`scripts/test/cli-guard.ts`): mesma ideia da trava do claude. O
  preload instala as sentinelas antes da do claude, porque testes antigos contam com a do claude
  em primeiro lugar no PATH. Os falsos dos testes (`scripts/test/fake-cli.ts`) são um script `sh`
  e um `.cmd` que repassam para `fake-cli-main.ts`. Esse script grava os argumentos e responde por
  regras trocáveis em tempo de execução, e é assim que o merge é simulado.
- **`Bun.spawn` sem `env` passa o ambiente da partida do processo**, e não o `process.env` atual.
  Por isso, até esta fase, o daemon de cada smoke subia sem as travas de PATH e HOME. Era
  inofensivo enquanto nada chamava `claude` nem lia `~`. O `smoke:board` revelou o problema ao
  alcançar o `gh` de verdade, que recusou o remoto local, então nada saiu da máquina. Correções:
  - `runCommand` (git, `gh`, `az`, script de preparação) e o `[commit]` do FakeRuntime passam
    `env: process.env`, num ciclo próprio (`comandos`, e `fake-runtime` com teste da
    identidade do commit).
  - Os quatro smokes passam o ambiente explicitamente ao daemon.
  - Com isso, o git dos testes deixou de ler o `~/.gitconfig` real e usa a identidade de
    `GIT_AUTHOR_*` definida pelos testes.
- **Push só para remotos locais:** os testes e o smoke conferem `git remote get-url origin`
  (uma pasta `git init --bare`) antes de qualquer push.

## Worktree e preparação

- **`.git/info/exclude` recebe `.flightdeck/worktrees/`**, e não `.flightdeck/` inteiro. A Fase 5
  guarda workflows versionados em `.flightdeck/workflows`. Isso veio da revisão da spec e teve um
  ciclo `test(worktree)` → `fix(worktree)`.
- **Slug:** acentos removidos, minúsculas, não alfanuméricos viram `-` e o máximo é 40
  caracteres. Fica `card` quando não sobra nada, e um título repetido ganha `-2`, `-3`.
- **Shell do script de preparação:** `cmd.exe /d /s /c` (ou `%ComSpec%`) no Windows e `sh -c`
  nos demais. O aviso guarda o código de saída e os últimos 2000 caracteres de stderr, ou de
  stdout se stderr estiver vazio.
- **Falha ao criar a worktree** (por exemplo, base inexistente) tem o mesmo destino da falha de
  preparação: Esperando você com a mensagem do git, sem sessão.
- **`cards.notice`** (coluna fora da spec) guarda o último aviso do card: falha de preparação,
  worktree mantida na conclusão, erro do CLI ao consultar o PR.

## Colunas, fila e execuções

- **"idle após um turno" segue o `turn.result`**, e não o status `idle`: `session.resume` e
  `history.resume` vão a `idle` sem turno. Um turno com sucesso leva a Em revisão; com erro, a
  Esperando você. O status sozinho (`idle`, `ended`) não move o card.
- **`card.stop`:**
  - Num card rodando, interrompe o turno. O `turn.result` interrompido (`error_during_execution`)
    leva a Esperando você.
  - Num card na fila, encerra a execução enfileirada e o card volta ao Backlog, travado até o
    próximo início.
- **`card.move` para Concluído é só movimento manual**, com trava e sem limpeza. A conclusão
  manual com limpeza é o `card.complete`.
- **`card_runs` ganhou `id` próprio** e `session_id` anulável, no lugar da chave
  `(card_id, session_id)`. Uma execução na fila ou em preparação ainda não tem sessão, e uma que
  falhou antes dela nunca terá. Isso substituiu um marcador `''` que quebrava a chave na segunda
  execução.
- **Nova execução de um card** fecha a sessão da execução anterior. A mais recente é a ativa.
- **`maxParallelRuns`:**
  - É chave da config (padrão 2).
  - O app edita pelo comando `board.settings`, que não está na tabela da spec, e o daemon grava
    de volta no `config.json`. `project.list` devolve o valor atual.
  - Sessões fora de cards não contam.
  - `card.message` num card ocioso vai direto à sessão, sem passar pela fila.
  - Uma vaga é liberada quando a sessão fica `idle`, `error` ou `ended`, ou quando a preparação
    falha.
- **Reinício do daemon:** o board volta a acompanhar as sessões das execuções não encerradas e
  sobe as execuções que estavam na fila.

## PR

- **`board.prPollIntervalMs`** na config (padrão 60 s), no mesmo molde de
  `history.scanIntervalMs`. O daemon do smoke é outro processo, então injetar o intervalo nos
  testes não bastaria.
- **GitHub:**
  - `url` usa `gh pr view <branch> --json url`, e um PR já aberto para a branch é
    reaproveitado.
  - A descrição vai em `--body`.
  - Os checks vêm de `statusCheckRollup`, e o pior vence: falha, depois pendente, depois
    passando. Sem checks, `null`.
- **Azure DevOps:**
  - `url` usa `az repos pr list --source-branch --status active`.
  - A URL do PR é `<repository.webUrl>/pullrequest/<id>`.
  - Os checks vêm das políticas (`az repos pr policy list`): `approved` e `notApplicable`
    passam, `rejected` e `broken` falham, o resto fica pendente.
- **Erro do CLI ao consultar** vira aviso no card, e o estado do PR não muda.

## Protocolo

- **`card.updated`** é um frame de topo, como `history.changed`, e não um `SessionEvent`. O
  `HostConnection` o encaminha e reenvia `board.watch` a cada reconexão.
- **`card.complete` e `card.discard`** aceitam `confirm` opcional no schema. O daemon recusa
  (`invalid_state`) qualquer coisa que não seja `confirm: true`.
- **Card descartado** sai do banco. O último `card.updated` traz o card com `discarded: true`.
- **`board.get`** devolve o projeto e as cinco colunas, cada uma com seus cards por posição.
- **Tipos:** os do board (projeto, card, diff) vivem no protocolo, e o daemon os reexporta.

## Diff

- **Ordem dos arquivos:** commits desde a base (`git diff <base>...HEAD`, então avanços da base
  ficam de fora), alterações rastreadas não commitadas (`git diff HEAD`) e arquivos não
  rastreados (`git ls-files --others --exclude-standard`).
- **Não rastreados** aparecem como adicionados e não commitados. Arquivo binário (com byte nulo)
  vem sem linhas.

## FakeRuntime

- **`[commit]`** na mensagem grava `fake-<n>.txt` no cwd da sessão e faz `git add` e
  `git commit`, com o git do PATH atual. É o gatilho do `smoke:board`, já que o daemon do smoke
  é outro processo e não recebe opções.

## App desktop

- **Telas:** Projetos (▦ ao lado do host), Board e Detalhe do card. A conversa é o mesmo
  `SessionView` das fases anteriores: abrir o detalhe seleciona a sessão da execução ativa.
- **Arrastar e soltar** usa eventos nativos. O card arrastado fica numa ref, e não no
  `DataTransfer`, que alguns webviews deixam vazio. Usar estado deixava a soltura ler um valor
  velho. Soltar sobre um card põe o arrastado antes dele (média das posições vizinhas).
- **Confirmações** de Concluir e Descartar são diálogos do app, e não `window.confirm`.
- **O aviso de Descartar** aparece quando o diff tem arquivo não commitado, ou tem arquivos e o
  card não tem PR.
- **Host no card:** o board é por projeto, e um projeto mora num host. Não há visão que junte
  projetos de vários hosts, então o card não mostra o host.
- **`src-tauri` não mudou** nesta fase, então não houve `cargo check` novo.

## TDD e testes

- **Escopos fora da tabela:**
  - `fake-runtime` (o gatilho `[commit]` e o ambiente do git).
  - `comandos` (ambiente atual nos filhos do daemon).
- **Smoke:** o `smoke:board` foi commitado vermelho dentro de `test(protocolo-board)`. Ele
  falhava no passo "cadastrar projeto" com saída controlada.
- **Tempo dos testes:** os testes do board que somam esperas de git real e CLIs falsos (cada um
  é um processo Bun) usam `setDefaultTimeout(20_000)`. O padrão de 5 s estourava com a suíte
  inteira.
- **Ramos revelados pela cobertura** (falha do git em `must`, watcher que lança, remoção de host
  com cards) seguiram a regra 7: o ramo saiu, o teste ficou vermelho e só então o ramo voltou.

# Decisões e divergências da Fase 5

O que a spec da Fase 5 (Central de sessões) deixou aberto, ou o que mudou na implementação.

## Princípio de `~/.claude`

- **A Fase 3 dizia que o Flightdeck só lê `~/.claude`.** A partir desta fase, `hooks install` e `hooks uninstall` escrevem no `~/.claude/settings.json`, sempre por comando explícito do usuário (CLI, ou botão com confirmação no app). Os transcripts continuam só lidos.
- **`uninstall`:**
  - Remove só as entradas do Flightdeck: as reconhecidas pela URL do receptor (`http://127.0.0.1:<porta>/hooks/`) ou pelo comando `hook session-start`.
  - Grupos, eventos e a chave `hooks` que ficarem vazios saem.
  - Se o `install` criou o arquivo, o `uninstall` deixa `{}`.
- **`status`:** "desatualizado" quer dizer que as entradas existem, mas diferem do que o `install` escreveria agora (eventos, comando, URL, token ou timeouts).

## Receptor e token

- **O receptor só escuta quando existe `hooks.token`:** no boot, se o token já estiver na config, ou quando o `hooks.install` chega pelo protocolo.
  - Este gera o token uma vez, sobe o receptor e grava os hooks com a porta real em que ele escuta.
  - Um daemon sem hooks não abre porta extra, e os testes e smokes que sobem daemons continuam só na porta 0.
- **O `hooks install` do CLI:**
  - Recusa `hooks.port` 0, porque o receptor não teria endereço fixo.
  - Com o daemon rodando, os hooks passam a valer depois de reiniciá-lo.
  - O token não é rotacionado em reinstalações, e com isso reinstalar continua idempotente.
- **URL do receptor:** o daemon a publica em `<dataDir>/receptor.json`. O `flightdeckd claude` a lê e confere em `/health`, com limite de 1 s.
- **`idleTimeout: 0`** no `Bun.serve` do receptor: o padrão do Bun (10 s) fecharia um `PermissionRequest` segurado.
- **O comando do `SessionStart`** leva a URL e o token nos argumentos (`hook session-start --url … --token …`), e não lê a config na hora do hook. Os caminhos só ganham aspas quando têm espaços.
- **Shell dos hooks no Windows:** a confirmação com o `claude` 2.1.312 mostrou que o Claude Code roda hooks de comando pelo Git Bash (`CLAUDE_CODE_GIT_BASH_PATH`, ou o `bash` do PATH). O bash come as barras invertidas, e o `SessionStart` nunca chegava ao daemon: o launch id e o `source` ficavam nulos e a sessão do `flightdeckd claude` nunca ficava controlável. Agora:
  - no Windows, o executável e os argumentos do comando são gravados com barras normais (`D:/...`), que o Windows também aceita;
  - uma entrada antiga com barras invertidas dá `outdated`, e o `install` a substitui;
  - o `uninstall` reconhece os dois formatos.
- **Sessões gerenciadas são ignoradas** pelo `claudeSessionId` conhecido ou pelo `managed: true` que o comando do `SessionStart` acrescenta quando vê `FLIGHTDECK_MANAGED=1`. O `ClaudeSdkRuntime` passa essa variável ao `claude`.

## Sessões externas

- **`external_sessions` tem a coluna `source`** (`startup`, `resume`, `clear` ou `compact`), fora da spec.
- **`Notification` sem `permission_prompt`** não muda o estado; só atualiza a última atividade.
- **Evento de uma sessão sem `SessionStart` visto** (daemon iniciado no meio da sessão) cria o registro.
- **`stale`:** a varredura roda a cada 60 s. Transcript ilegível conta como parado.
- **Depois de reiniciar:** as sessões não encerradas viram `unknown`, e nenhum canal fica conectado.
- **`projectKey`:** sem remoto, a chave usa o `hostName` do daemon no lugar do `hostId`, que só o app conhece.

## Permissões externas

- **"App conectado"** é uma conexão com `external.watch` ativo: quem não vê a fila não poderia responder, e um `claude -p` esperaria à toa.
- **O `external.watch`** manda, depois do ack, as sessões vivas e os pedidos ainda abertos, como o `sessions.watch`. Assim, um app que reconecta não perde a fila.
- **O `Notification` com `permission_prompt`** chega enquanto o hook segura e nunca fecha o pedido. Qualquer outro evento posterior da sessão o fecha com resposta vazia (`answered_elsewhere`).
- **Outros fechamentos:**
  - Conexão do hook caída: `dropped`.
  - Daemon parando: todos os segurados recebem resposta vazia.
- **`requestId` externo** começa com `ext-`. O `permission.respond` tenta os externos primeiro e manda o resto para as sessões gerenciadas.
- **Entrada resumida:** textos com mais de 200 caracteres são cortados.

## Canal e `flightdeckd claude`

- **Argumentos do canal:** o `flightdeckd channel` recebe `--launch`, `--url` e `--token` nos argumentos do `--mcp-config`, e não por variáveis de ambiente, porque não dá para garantir o que o `claude` repassa ao servidor MCP.
- **Ligação com o daemon:** o canal se conecta ao receptor por WebSocket (`/channel?launch=<id>`, com o token de hooks).
  - É só de ida: um cliente que manda algo é desconectado com 1008.
  - A conexão define o `controllable`.
- **Config do wrapper:** vem de `FLIGHTDECK_CONFIG` ou do caminho padrão, porque os argumentos de `flightdeckd claude` são todos do `claude`.
- **Ordem dos argumentos:** `--mcp-config <arquivo temporário>` e `--dangerously-load-development-channels server:flightdeck` vêm antes dos do usuário. A opção seguinte encerra o variádico `--mcp-config`.
  - O arquivo fica em `<dataDir>/channels/<launch>.json` e é apagado quando o `claude` sai.
  - Confirmação manual pendente, junto com o registro por `--mcp-config` no lugar do `.mcp.json` da prova de conceito.
- **Sem daemon:** o `claude` abre sem os argumentos do canal (só com o launch id).
- **Com `-p` ou `--print`:** o `claude` abre normal, sem canal e sem aviso. O modo print ignora o canal de desenvolvimento, e a sessão ficaria "controlável" sem poder receber mensagem.
- **Confirmado com o `claude` real (2.1.312, Windows):**
  - `--mcp-config` antes dos argumentos do usuário sobe o `flightdeckd channel` com `--launch`, `--url` e `--token`, e o canal conecta;
  - cabeçalho `Authorization` nos hooks http aceito;
  - allow e deny com `message` (a mensagem chega exata);
  - resposta 200 vazia entendida como "sem decisão".

## Ao vivo

- **Tempo do `history.changed`:** com a observação de arquivos ativa, sai 250 ms depois do evento (`watchDebounceMs`). A varredura completa de 10 s continua como reserva.
- **Injeção nos testes:** timers, watcher e debounce do indexador são injetáveis, e os testes nunca esperam o relógio.
- **O leitor de uma sessão viva** relê a partir da última página carregada para a frente e mescla por `uuid`, sem recarregar o que está na tela.

## App desktop

- **A tela Sessões** abre pelo botão "Sessões" da barra lateral e é também o que aparece quando nada mais está aberto.
  - Ela carrega as listas sem barulho: um host antigo, sem histórico ou sem central, só contribui com menos.
  - A meta das sessões fica num mapa único no app, alimentado pelas três listas e pelo `session.meta.set`.
- **O filtro de host** usa o nome do host.
- **"Copiar comando"** copia `flightdeckd claude --resume <id>`, e não `claude --resume` (Fase 3), para a sessão retomada já vir controlável.

## TDD e testes

- **`claude` falso por teste** (`apps/daemon/test/fake-claude*.ts`): lê o `settings.json` do HOME temporário e roda os hooks de comando como o Claude Code, pelo Git Bash no Windows e por `sh -c` nos demais (`hook-shell.ts`). Antes ele usava `cmd /d /s /c`, que escondeu o defeito das barras invertidas. Também faz os POSTs http com os cabeçalhos instalados, escreve o transcript, sobe o servidor do `--mcp-config` e registra o que chega pelo canal.
- **Achado do caminho:** o Bun, sem `windowsVerbatimArguments`, quebra comandos com aspas no `cmd /s /c`. O `shellCommand` do script de preparação da Fase 4 tem esse limite para scripts com aspas. Ficou anotado e não foi corrigido.
- **`fix(pr)`:** a consulta de estado do PR roda no repositório do projeto, e não dentro da worktree. No Windows, o cwd do `gh` travava a pasta enquanto Concluir ou Descartar a removia, e isso aparecia como falha intermitente da suíte.
- **Smoke:** o `smoke:central` foi commitado vermelho em `test(sessao-meta)`, falhando no passo "renomear a sessão". Além dos passos da spec, ele renomeia a sessão externa.
- **Ramos revelados pela cobertura** seguiram a regra 7: ação de hooks desconhecida, transcript ilegível no `stale`, cancelar a inscrição, getter do receptor, canal só de ida.

# Decisões e divergências da Fase 6

O que a spec da Fase 6 (Workflows) deixou aberto, ou o que mudou na implementação.

## Arquivo e validação

- **YAML:** é lido com o `Bun.YAML` do runtime, sem dependência nova.
- **Identidade:** o nome de um workflow é o nome do arquivo, sem `.yaml`. O campo `name` é opcional e só informativo.
- **Ações dentro de `loop.do` e de `parallel`:** só `agent` ou `check`. Gate, loop, parallel e pr aninhados são erro de validação.
- **`continue`:** precisa apontar para uma etapa `agent` de topo declarada antes. Isso vale também dentro de loop e parallel.
- **Referências:**
  - Precisam apontar para etapas declaradas antes.
  - `outputs` só vale para um `parallel`, e `output` para as demais etapas.
  - `loop.lastCheck.output` e `loop.lastCheck.exitCode` só valem dentro do `do` de um loop.
  - Uma referência sem valor em tempo de execução lança erro, embora a validação já a impeça.
- **O comando de um `check` nunca é interpolado:** ele precisa estar literalmente no arquivo confiado.
- **8 KB:**
  - Medido como 8192 caracteres da string, o mesmo limite na interpolação e na saída do check.
  - A interpolação guarda o começo do valor.
  - A saída do check guarda o fim de stdout seguido de stderr.
- **Separadores:**
  - A saída de um `agent` junta os blocos de texto do turno com uma linha em branco.
  - `outputs` junta as saídas dos itens com `\n\n---\n\n`.
- **Mensagens de validação:** em português, no formato `steps.<n> (<id>): <problema>` ou `<caminho>: <problema>`.

## Confiança e o executor de check

- **O conteúdo que rodou fica guardado:** `workflow_runs.definition` (coluna além da spec) guarda o YAML confiado da execução. Uma execução retomada usa esse conteúdo, e não o da base atual.
- **`workflow.trust`:** recusa um `hash` diferente do atual na base e workflows com erros de validação.
- **`workflow.validate`:** recebe `projectId` e `name` e valida a versão da base. Não valida texto avulso.
- **Antes de cada check:** o motor confere que o hash do conteúdo guardado é o da execução, que esse hash continua confiado no projeto e que o comando está entre os `check` dele. Senão, a etapa falha com "comando fora do workflow confiado" e o executor não é chamado.
- **`CheckRunner`:**
  - É uma opção do `Board` (`checks`). O padrão é o executor real de shell (`shellCheckRunner`), o mesmo shell do script de preparação.
  - Os testes do motor que precisam ver o que chega ao executor injetam um executor que só grava a chamada.
- **Trava de check, a interpretação adotada para "o preload reprova a suíte se o executor real de shell for chamado":**
  - O preload define `FLIGHTDECK_CHECK_GUARD`, que aponta para uma pasta com uma lista de pastas permitidas.
  - Com essa variável definida, o executor real só entrega ao shell um comando cujo executável, resolvido no PATH atual com `whichOnPath`, esteja numa pasta permitida.
  - Qualquer outro comando é registrado e recusado com código 99, sem chegar ao shell, e o preload reprova a suíte se houver registro.
  - Os comandos falsos (`installFakeCheck`, em `scripts/test/check-guard.ts`) são os falsos de CLI da Fase 4 (sh e `.cmd`), com a pasta acrescentada à lista.
  - O `smoke:workflow` instala a mesma trava e passa o ambiente explicitamente ao daemon, onde o executor real roda.
  - Os outros smokes também a instalam e a conferem antes do OK, embora os seus daemons não rodem workflows.
- **Falsos de CLI por número da chamada:** as regras dos falsos ganharam `call` (a n-ésima chamada), para um check falhar uma vez e passar na seguinte sem corrida contra o FakeRuntime.

## Motor

- **Ids:**
  - Uma execução de workflow tem o mesmo id da execução do card (`card_runs`).
  - Nela, `card_runs.session_id` fica nulo, porque cada etapa tem a sua sessão.
  - O `Card` ganhou `workflowRunId`, com `null` como padrão no schema, para não quebrar quem não o envia.
- **`step_id` e tentativa:**
  - Etapa de topo: o próprio id, tentativa 1.
  - Loop: `<id>.check` e `<id>.do`, com a iteração como tentativa.
  - Parallel: `<id>.<índice>`.
  - O `gate.respond` usa esses mesmos ids.
- **`step_runs`:** ganhou `note` (a nota do gate), `message` (a pergunta do gate) e `usage` (o que os turnos da etapa gastaram), colunas além da spec.
- **Status da execução:**
  - `queued` e `running`.
  - `waiting`: gate aberto.
  - `paused`: orçamento ou `max` do loop.
  - `failed`: uma etapa ou a preparação falhou.
  - `rejected` e `completed`.
  - Os quatro últimos são finais. Não existe comando para retomar uma execução pausada: inicia-se o card de novo.
- **Loop:**
  - O `check` roda primeiro. Passou, o loop acaba sem rodar o `do`.
  - O `do` roda no máximo `max` vezes, e o check, no máximo `max + 1`.
  - Com o check ainda falhando, a execução pausa com "loop <id>: o check ainda falha depois de <max> repetições".
  - A saída do loop é a do check que passou.
- **Falhas:**
  - Um `check` fora de loop que sai com código diferente de 0 falha a execução, assim como um check dentro do `do`.
  - Um turno com erro, um erro da sessão ou Parar (que interrompe as etapas em andamento) também falham a execução.
  - Em qualquer desses casos, o card vai a Esperando você.
- **Colunas:**
  - O evento novo `workflow` (`running`, `waiting`, `done`) move o card, e os status de sessão das etapas seguem as regras da Fase 4.
  - O `turn.result` de uma etapa não leva o card a Em revisão. Isso só acontece quando a execução termina (ou, antes disso, pela etapa `pr`).
- **Vagas (`maxParallelRuns`):**
  - A execução segura a vaga do card desde a preparação até terminar.
  - Com um gate aberto, a vaga é liberada. Aprovado o gate, a execução pega uma vaga de novo, esperando na frente dos cards na fila.
  - Um `parallel` usa a vaga do card mais as vagas livres do host no início da etapa, sem esperar por elas, e as devolve no fim. Sem vagas livres, os itens rodam um depois do outro.
- **Card com execução em andamento** (na fila, rodando ou num gate): não pode ser iniciado de novo.
- **Conclusão (manual ou merge):** fecha as sessões das etapas. O descarte apaga as execuções do card.
- **Quando o board encerra a execução do card**, a execução do workflow também acaba, como `failed`:
  - Parar com o card na fila: "card parado antes de começar".
  - Concluir ou Descartar no meio: "execução encerrada com o card".
  - As etapas abertas (um gate incluído) fecham como `failed`, e a execução que segurava a vaga a devolve.
  - Limitação conhecida: as vagas extras de um `parallel` em andamento nessa hora só voltam com o reinício do daemon.
- **Etapa `pr`:**
  - Fora da tabela de áreas, com escopo próprio (`engine-pr`). Usa o `createPr` do board.
  - A URL do PR é a saída da etapa.
  - Sem provedor no projeto, a execução falha.
- **Reinício do daemon:**
  - O board retoma as execuções `running`, que voltam a segurar a vaga, e as `waiting`, que não seguram vaga.
  - Etapas concluídas devolvem o que gravaram, e um check concluído também.
  - Um agent cortado retoma a mesma sessão (`session.resume` se estiver `error` ou `ended`) e reenvia o prompt depois do aviso.
  - Um check cortado roda de novo.
  - Um gate aprovado durante a espera pela vaga pega a vaga ao retomar.
- **`run.updated`:** é emitido a cada transição (etapa criada ou encerrada, status, uso, resposta de gate). Um watcher que lança não afeta a execução.

## Orçamento

- **Quando é conferido:** antes de cada turno de agent. Um turno em andamento nunca é cortado, e o estouro pausa a execução antes do turno seguinte.
- **Minutos:** a soma da duração dos turnos de todas as sessões, medida com o relógio injetável do board (`clock`). A espera num gate não conta.
- **Custo:**
  - O `usage` da execução guarda o último total visto de cada sessão. Cada turno soma `max(0, total − último)`.
  - Um total menor que o último não subtrai nada.
- **Mensagens de pausa:** "orçamento estourado: 2 de 2 turnos", "… 12.3 de 12 minutos", "… US$ 1.75 de US$ 1.50".
- **Uso por etapa:** cada etapa `agent` guarda a sua parte (turnos, minutos e a diferença de custo que os seus turnos somaram), e a linha do tempo a mostra ao lado da duração.
- **FakeRuntime:** guarda o custo cumulativo por Claude session id (`[cost:x]`). Uma sessão retomada com `resume` no mesmo runtime começa do total anterior, como o SDK.

## Protocolo

- **`workflow.list`:** `{ projectId }` → `{ workflows }`.
- **`gate.respond`:** devolve a execução.
- **`run.watch`:** responde o ack, manda as execuções ainda em andamento e depois cada mudança. O app reenvia o `run.watch` a cada reconexão.
- **`card.get`** (fora da tabela): o card pelo id, para o `get_card` do MCP sem ter que varrer os boards.

## MCP

- **Servidor:**
  - `flightdeckd mcp` usa o `McpServer` do SDK que já estava no daemon, com os schemas em zod.
  - O transporte é injetável (`mcpTransport`), como o do `channel` da Fase 5: stdio de verdade, em memória nos testes.
  - Fechar o cliente encerra o comando com 0. Sem daemon, ou com token recusado, ele sai com 1 e diz por quê.
- **Endereço do daemon:** vem da config. `bind` `0.0.0.0` ou `::` vira `127.0.0.1`, e um IPv6 vai entre colchetes.
- **Respostas:** cada ferramenta responde o resultado do comando do protocolo, como JSON em texto. Por exemplo, `list_projects` inclui `maxParallelRuns`. Um erro do daemon volta como erro da ferramenta (`isError`), com `<código>: <mensagem>`.

## App desktop

- **Telas:**
  - **Workflows de &lt;projeto&gt;**: aberta pelo botão na tela Projetos.
  - **Confiar**: abre o diálogo do app (não `window.confirm`), que lista os comandos `check`.
- **Detalhe do card:**
  - O seletor de workflow mostra só os confiados e válidos, e os campos de input aparecem conforme o escolhido.
  - O card simples continua sendo "Nenhum".
- **Linha do tempo:**
  - Agent e check abrem por clique.
  - Um gate aberto aparece inline, com nota, Aprovar e Recusar.
- **Precisa de você:**
  - Um gate entra com Aprovar e Recusar, que respondem sem nota.
  - Clicar no item abre o card (`card.get` dá o projeto).
- **Execuções de um host removido:** ficam no estado do app, mas não aparecem, porque o "Precisa de você" e as telas filtram pelos hosts presentes.
- **`src-tauri` não mudou** nesta fase, então não houve `cargo check` novo.

## TDD e testes

- **Escopos fora da tabela:**
  - `fake-runtime`: o gatilho `[cost:x]`.
  - `engine-pr`: a etapa `pr`.
  - `protocolo-workflow`: os comandos e o frame `run.updated` no servidor. O `smoke:workflow` foi commitado vermelho nesse `test(protocolo-workflow)`, falhando com saída controlada no passo "listar e confiar no workflow".
- **Rebase sobre `fase-5`:**
  - Saíram o `test(pr)` e o `fix(pr)` da Fase 6. Eles repetiam o `de35260` e o `4cedc83` da Fase 5: consultar o PR na raiz do repositório, porque um CLI com cwd na worktree a trava no Windows e a remoção falha. Esse travamento aparecia como falha intermitente do `protocolo-board`.
  - A migração da Fase 6 ficou depois da da Fase 5 (índice 4).
  - Os falsos de CLI juntam o `cwds()` da Fase 5 e o `call` da Fase 6.
- **Ramos revelados pela cobertura** seguiram a regra 7: o ramo saiu, o teste ficou vermelho e só então o ramo voltou.
  - Mensagem de tipo e valor inválidos na validação.
  - O watcher de execução que lança.
- **Correções de teste antes do `feat`:**
  - Restaurar falsos em ordem inversa.
  - Esperar a remoção da worktree depois do merge.
  - No paralelo, mandar as saídas a um gate, e não a um agent que repetiria `[tool]`.

# Decisões e divergências da Fase 7, trilha A

O que a spec da Fase 7 (operação do host) deixou aberto, ou o que mudou na implementação.

## Versões

- **`Cargo.toml` fica em `0.1.0`:** a versão do crate Rust não está entre as quatro da spec (protocolo, daemon, desktop e `tauri.conf.json`). O `tauri.conf.json` lê a versão do `package.json` do desktop (`"version": "../package.json"`), e o `cargo check` passa.
- **Versão de referência do `update`:** é a do binário que roda o comando (`DAEMON_VERSION`), não a do binário instalado. O README diz para rodar o `update` com o binário instalado e, na primeira vez, com o próprio binário novo.

## Protocolo

- **Ordem no `hello`:** o token é conferido antes da versão. Token errado continua fechando a conexão como `unauthorized`. Versão fora do intervalo recebe o ack `protocol_incompatible`, e a conexão fica aberta sem autenticar: outro `hello` pode vir, e qualquer outro comando a fecha como `unauthorized` (o `smoke:ops` confere).
- **`features` ausente:** daemons anteriores à Fase 7 não mandam o campo. O app trata ausência como legado: mostra o que já existia (hooks da central, Projetos) e esconde o que nasceu na Fase 7 (Manutenção). Com o campo presente, só aparece o que está nele.
- **Host incompatível no app:** o status `incompatible` não tenta reconectar sozinho. O botão Reconectar da página do host tenta de novo.
- **Opções do servidor para testes:** `protocolRange` e `features` em `startServer` existem para os testes simularem daemons de outros intervalos e recursos.

## Retenção

- **Sem migração:** a última limpeza fica em `<dataDir>/maintenance.json`. A única migração da fase continua sendo a da trilha B.
- **Etapas de workflow:** a regra "sessões de cards fora de Concluído" também protege as sessões das etapas de workflow desses cards (`step_runs` → `workflow_runs` → card).
- **Conversa removida no app:** detectada no cliente, sem campo novo no protocolo. Um `session.subscribe` desde o começo que replica 0 eventos de uma sessão com `lastSeq` > 0 marca a sessão. A mensagem aparece na `SessionView`, que o detalhe do card usa.
- **Boot com `eventsDays: 0`:** a limpeza do boot apaga de novo a conversa de um banco restaurado. O `smoke:ops` confere o conteúdo restaurado no arquivo, antes de subir o daemon, e depois só que a sessão existe.

## Backup

- **Nome em UTC:** `flightdeck-AAAAMMDD-HHmmss.db` usa UTC, para os nomes seguirem a ordem do tempo em qualquer fuso.
- **`--out`:** um backup com destino explícito não entra na rotação de `keep`.
- **Backup do boot:** só é feito se o último tiver 24 h ou mais, para reinícios seguidos não gerarem cópias.

## Atualização

- **`.old` em todos os sistemas:** a spec pede rename para `.old` no Windows e cópia para um temporário com rename por cima nos outros. Aqui todos fazem as duas coisas: o atual vira `.old`, o novo é copiado para `.new` e renomeado por cima. Assim o Linux também tem para onde voltar.
- **Parar o daemon do serviço:** numa tarefa real, o orquestrador confirmou que `schtasks /End` encerra o `conhost.exe` e deixa o `flightdeckd` vivo, com o lock e o `/health`. Por isso o `update` e o `service uninstall` seguem a mesma sequência (`stopServiceDaemon`):
  1. `daemon.shutdown` pelo WebSocket, com o token da config. Ele funciona em qualquer sistema.
  2. Depois, `schtasks /End` ou `systemctl --user stop`.
  3. Espera até 10 s pelo lock do `dataDir`.
  4. Com o lock ainda ocupado, mata o PID do lock só se o executável desse processo for o do serviço. A comparação é feita com os links resolvidos, porque um gerenciador de pacotes pode instalar o executável atrás de uma junção. O caminho vem do PowerShell no Windows e de `/proc/<pid>/exe` nos outros sistemas.
  5. Se não for o executável do serviço, o `update` recusa sem trocar nada. O `uninstall` remove o serviço e avisa que o daemon continua rodando.
- **`daemon.shutdown`:** é só uma adição ao protocolo, sem item em `features`, porque o app não o usa. Um daemon antigo responde `bad_request`, e a sequência segue para o `stop` do serviço e o lock. O daemon responde ao comando e depois fecha como no SIGTERM, saindo com 0 para o `RestartOnFailure` da tarefa não religá-lo.
- **Caminho e config do serviço:** lidos de volta do sistema, pelo `ExecStart` de `systemctl --user cat flightdeckd` e pelo `<Arguments>` de `schtasks /Query /XML` (depois de `--headless`). O comando é tudo o que vem antes de `start`, como `bun run bin.ts` na árvore de código; a config é o argumento depois de `--config`. Pelo pipe, o `schtasks` escreve na página de código ANSI. Um caminho com acentos pode não bater, e o serviço é reinstalado sem necessidade, o que não causa dano.
- **Config do serviço no `update`:** a reinstalação no caminho estável mantém o `--config` que o serviço tinha. Sem `--config` no CLI, a config do serviço define a porta do `/health`, o lock e o token do `daemon.shutdown`. Nesse caso, a config padrão nem é lida.
- **Hooks:** reinstalados quando o `hooks.status` para o caminho estável dá `outdated`, isto é, há hooks do Flightdeck que diferem dos que seriam escritos. Ausentes continuam ausentes.
- **Volta automática:** se o daemon novo não responde, o `.old` volta para o lugar, se existir. Se o serviço tinha sido reinstalado, ele volta ao comando e à config originais, lidos do XML ou da unit, e sobe de novo. O primeiro `update`, sem binário anterior, fica assim como estava antes.
- **`/health`:** o endereço vem do `bind` e da `port` da config (`0.0.0.0` e `::` viram `127.0.0.1`), como no `flightdeckd mcp`.

## Serviço (defeito da Fase 2)

- **`--config` no serviço:** com `service install --config <arquivo>`, a tarefa e a unit rodam `start --config <caminho absoluto>`, com as mesmas regras de aspas de antes. Sem `--config`, continuam com `start` e a config padrão. Antes, o `--config` só servia para gravar o `claude.executablePath`.
- **`service status`:** mostra também a config que o serviço usa, ou "padrão".
- **`service stop` e `service start`:**
  - o `stop` usa a mesma `stopServiceDaemon` do `update` e do `uninstall`, e deixa a tarefa ou a unit instalada;
  - o `start` roda `schtasks /Run` ou `systemctl --user start` e espera o `/health` da config do serviço, por até 30 s;
  - os dois saem com 1 sem serviço instalado, com um daemon que não parou ou sem resposta no `/health`;
  - a restauração no README é `service stop`, `restore` e `service start`.
- **`bun run deploy`:** continua trocando o `path` do `deploy.hosts.json`. O README pede para apontá-lo para `~/.flightdeck/bin/flightdeckd` depois do primeiro `update`.

## Travas novas

- **Serviço real:** `osServiceContext` executa por um `exec` vigiado. Com `FLIGHTDECK_SERVICE_GUARD` definido, `systemctl`, `schtasks` e `loginctl` (com caminho ou `.exe`) não rodam: a linha vai para o arquivo da variável, e o resultado é o código 99. O preload define a variável para a suíte, e o `afterAll` reprova se o arquivo existir. O `smoke:ops` faz o mesmo.
- **Binário real:** o preload e o `smoke:ops` tiram um retrato de `~/.flightdeck/bin/flightdeckd(.exe)` e dos seus `.old` e `.new` no home real, antes da trava de home, e reprovam se algo mudar.
- **Escopos:** a trava do serviço tem o próprio escopo (`trava-servico`). A do binário veio no ciclo do `update`, que é quem mexe no binário.

## TDD e testes

- **Ramos revelados pela cobertura (regra 7):**
  - `db` com ação desconhecida;
  - o `healthy` do CLI do `update`, que confere `GET /health` no endereço da config;
  - o ramo MB do `formatBytes`;
  - o ramo `/proc/<pid>/exe` do `processPath`, que não roda no Windows (testado com `readlink` injetado).
- **Correções de teste antes do `feat` ou `fix` (regra 8):**
  - o ack do daemon falso do `versoes-ui` não devolve valor, como pede o tipo do websocket do Bun;
  - no `manutencao-ui`, a espera pela limpeza real aguarda a mensagem da simulação sumir, porque "seriam apagados: …" também contém "apagados: …";
  - os testes de `install --dry-run` passam `--config`, então a unit e a tarefa esperadas passaram a levá-lo;
  - o exemplo de `daemon.shutdown` no teste do protocolo;
  - nos testes do CLI do `update`, o daemon falso recebe primeiro a tentativa de `daemon.shutdown` em `/v1/ws` e depois o `/health`;
  - o caminho do próprio processo é comparado com os links resolvidos (o bun do Scoop roda atrás da junção `current`).
- **Escopo `desligar`:** o `daemon.shutdown` ganhou o próprio ciclo (`test` e `feat`). As correções do `--config` e do `uninstall` são `fix(servico)`, e as do `update` são `fix(update)`.
- **`central-ui`:** o teste de ordem esperava a sessão gerenciada ficar ociosa antes de seguir. Sob a carga da suíte inteira, a ordem às vezes falhava, e isso foi corrigido num `test(central-ui)`.
- **`smoke:ops` sem vermelho de recurso:** o script foi escrito depois das áreas que ele cobre. As primeiras execuções falharam com saída controlada, mas por expectativas do próprio script: um comando numa conexão incompatível fecha como `unauthorized` em vez de receber ack, e a limpeza do boot apaga de novo o banco restaurado. Nenhuma falha veio de recurso faltando. O script foi commitado verde no `test(smoke-ops)`.

# Decisões e divergências da Fase 7, trilha B (limites e regras)

O que a spec da Fase 7 deixou aberto para a trilha B, ou o que mudou na implementação.

## Cota

- **Evento interno:** o `rate_limit_event` vira um evento `quota` do runtime, que o session manager entrega à `Quota` do host (`onQuota`). Ele nunca vira `SessionEvent`: não é gravado, não é reenviado e o app não o recebe numa assinatura de sessão.
- **Leitura defensiva:**
  - O daemon lê `rate_limit_info.unifiedWindows` quando existe; sem ele, a janela do topo (`rateLimitType`, `utilization`, `resetsAt`).
  - Uma janela com `status` desconhecido (fora de `allowed`, `allowed_warning` e `rejected`) é ignorada.
  - `utilization` fica como fração; ausente, vira `null`. `resetsAt` chega em segundos e é guardado em milissegundos; ausente, a leitura vale até a próxima.
- **Onde fica:** a leitura vive só em memória, no daemon, e volta com o próximo turno depois de um reinício.
  - A única migração da trilha é a `usage_daily`.
  - `quota.get` e `quota.watch` não têm histórico.
- **Vencimento:** um timer injetável (relógio e agendador) é armado para o próximo `resetsAt`. Quando dispara, remove a janela e avisa quem faz `quota.watch`. Uma leitura que já chega vencida é descartada.
  - O atraso do timer é limitado a 2³¹ − 1 ms (cerca de 24,8 dias). Acima disso o timer dispararia na hora, num laço; ao disparar antes, ele é armado de novo.
  - A leitura também é filtrada pelo relógio ao ser lida, então um timer atrasado (host que dormiu) nunca mostra nem bloqueia por uma janela vencida.
- **O app:** pede `quota.get` ao conectar, além do `quota.watch`, porque o `quota.watch` não manda o estado atual.

## Fila por cota

- **O que bloqueia:** uma janela válida com `utilization ≥ pauseAt` ou `status: rejected`. Com `pauseAt: null`, nada bloqueia, nem o `rejected`.
- **`until`:** é o maior `resetsAt` das janelas que bloqueiam; se alguma não tem `resetsAt`, fica `null`.
- **Card:**
  - Ganhou `queueReason` (`slot` ou `quota`) e `quotaUntil`, ambos com `null` como padrão no schema.
  - O motivo é calculado na leitura do card, e cada mudança de cota manda um `card.updated` para os cards na fila.
- **Fila:** a cota só segura a escolha de novos cards. Execuções em andamento e a volta de um gate aprovado seguem, porque esperam a cota no próximo turno.
- **Workflow:**
  - Antes de cada turno de agente (logo depois do orçamento), se a cota bloqueia, a execução continua `running` com `statusReason: "aguardando cota"`, e a execução expõe `quotaUntil` (só em memória).
  - Se o card for concluído ou descartado durante a espera, a execução para ali, sem seguir.
  - A linha do tempo do card mostra "aguardando cota até HH:MM".
- **HH:MM:** o daemon manda o instante em ISO, e o app formata com uma função injetável (o fuso da máquina quando ausente).

## Uso

- **Custo do turno:** o session manager chama o `UsageLedger` antes de gravar cada `turn.result`. O custo do turno é `max(0, total − total anterior)`, e o total anterior vem do último `turn.result` gravado daquela sessão nos `events`. Isso vale através de reinícios e de `resume`, sem tabela extra.
- **Tokens:** `input_tokens` e `output_tokens` do `turn.result` são tratados como do turno. Os tipos do SDK não dizem se são cumulativos.
- **Dia e projeto:**
  - O dia é `AAAA-MM-DD` por uma função injetada (`localDay` usa o fuso da máquina).
  - O projeto é a `projectKey` da Fase 5, por um `ProjectKeys` próprio do daemon.
- **`usage.summary`:** devolve as linhas dos últimos `days` dias, de 1 a 90 (padrão 7). A ordem é do dia mais novo para o mais antigo e, dentro do dia, por projeto.

## "Permitir sempre"

- **Validação compartilhada:** um único validador (`permission-updates.ts`) serve às sessões gerenciadas e às do terminal.
  - Recusa destinos fora de `session` e `localSettings`.
  - Recusa `setMode` para `bypassPermissions` ou `auto`.
  - Aceita só sugestões do próprio pedido, com igualdade campo a campo e as chaves em qualquer ordem, ou uma regra do projeto (`addRules`, `allow`, `localSettings`).
  - Numa regra do projeto, cada regra precisa ser da ferramenta do pedido, e o `ruleContent`, quando existe, não pode ser vazio, ter quebra de linha nem passar de 500 caracteres.
- **Sugestões:** as que o daemon não entende são descartadas uma a uma, para que um tipo novo do SDK não derrube o pedido.
- **Item recusado:** um item ruim recusa a resposta inteira, nada é aplicado e o pedido continua aberto.
- **FakeRuntime:**
  - `[tool]` (Write) sugere `addDirectories` e `setMode acceptEdits` de sessão.
  - `[bash]` (Bash `npm test --silent`) sugere a regra `npm test:*` em `localSettings` e o comando exato em `session`.
  - O `tool.result` repete os `updatedPermissions` recebidos, e é assim que o smoke vê a regra chegar ao runtime.

## Regras do projeto

- **Qual sessão é de card:** a de uma execução do card (`card_runs`) ou de uma etapa de workflow (`step_runs`). Regras aceitas em outras sessões não vão para a raiz.
- **Formato:** `Ferramenta(conteúdo)`, ou só `Ferramenta` sem conteúdo, em `permissions.allow`.
  - O merge não duplica e preserva as outras chaves e a ordem.
  - Se o arquivo da raiz não é um objeto JSON válido, ele não é reescrito, e o card recebe o aviso "regra não gravada no .claude/settings.local.json: …".
- **Worktree nova:**
  - O `.git/info/exclude` recebe `.claude/settings.local.json` (junto com `.flightdeck/worktrees/`) antes do `git worktree add`, e o arquivo da raiz é copiado para a worktree.
  - A linha do exclude também é garantida a cada execução do card e logo antes de gravar uma regra na raiz. Assim valem as worktrees criadas antes desta fase.
  - Se o repositório versiona o arquivo, a cópia é pulada: a worktree já tem o que está commitado, e sobrescrever mostraria uma alteração no diff.
- **`rules.remove`:** sem `confirm: true` dá `invalid_state`; uma regra que não existe dá `not_found`.
- **Mais de um projeto no mesmo repositório:** não acontece, porque o caminho de um projeto é único.

## App

- **Barras:** só as de 5 horas e de 7 dias, na ordem; outras janelas que o daemon conheça não aparecem.
  - Sem leitura, a barra mostra "sem leitura".
  - O texto da idade é "lida agora", "lida há N min" ou "lida há N h".
- **Notificação:** uma por host, janela e `resetsAt`. A janela seguinte, com outro reinício, pode notificar de novo.
- **Painel de uso:** fica na tela do host.
- **Seção Regras:** fica na edição do projeto, na tela Projetos.
- **"Sempre neste projeto":** o campo leva a regra inteira (`Bash(npm test:*)`). O texto é convertido em `addRules` para `localSettings`, e a validação é do daemon.
- **Pedidos do terminal:** os botões novos também aparecem na tela da sessão externa. Na fila "Precisa de você" continuam só Permitir e Negar.

## Rebase sobre a trilha A

- **`features`:**
  - O `host.info` anuncia `quota` quando o daemon tem a cota do host e `rules` quando tem projetos (o board).
  - O teste de compatibilidade da trilha A passou a esperar `rules` na lista de um daemon com board.
- **No app:** são recursos nascidos na Fase 7, então um host sem o anúncio, inclusive um da Fase 6 sem `features`, não os mostra e não pede nada que gere banner de erro.
  - As barras de cota e o painel de uso dependem de `quota`.
  - Os botões "permitir nesta sessão" e "sempre neste projeto" (gerenciada, card e terminal) e a seção Regras dependem de `rules`.
  - O `quota.get` da conexão continua silencioso quando o host não o conhece.
- **README:** o aviso conhecido do canal ficou só com o texto da trilha A, que tinha o mesmo bullet.
- **Migração:** a trilha A não acrescentou nenhuma, e a `usage_daily` é o índice 5.
- **`test(central-ui)`:** o commit saiu no rebase, porque a trilha A fez a mesma correção do setup.
- **Versões:** a trilha B não mexe em versões, `tauri.conf.json` nem `src-tauri`.

## TDD e testes

- **Escopos:** só os oito da tabela. O gatilho `[ratelimit:…]` do FakeRuntime entrou em `cota`, e `[bash]` e as sugestões entraram em `permitir-sempre`.
- **Smoke:** o `smoke:limits` foi commitado vermelho dentro de `test(regras-projeto)`, falhando no passo "responder com regra do projeto" (o arquivo da raiz).
- **Ramos revelados pela cobertura** seguiram a regra 7: o ramo saiu, o teste ficou vermelho e só então o ramo voltou.
  - A ligação `onQuota` no `startDaemon`.
  - O formato padrão de hora.
- **Teste de tempo:** a espera do `engine-parallel` subiu para 15 s; sob carga, duas worktrees com git real passavam de 5 s.
- **Falha intermitente da Fase 5 observada:** `central-ui` ("junta gerenciada, externa e do histórico…") falhou uma vez na suíte inteira com a ordem de dois itens trocada e passou 3 de 3 sozinho. Parece empate de horário, e não foi mexido nesta trilha.

# Área "plataforma" (CI em Linux e Windows)

A primeira execução da CI no GitHub falhou nas duas pernas. Estas são as causas e o que mudou.

- **TEMP 8.3 no runner Windows:** o `TEMP` vem como `C:\Users\RUNNER~1\...`. O daemon resolve caminhos com `realpathSync.native`, que expande o nome curto; o `realpathSync` em JS não expande.
  - Os testes, as fixtures e os smokes passaram a criar pastas temporárias com `realTempDir` (`scripts/test/temp-dir.ts`), que usa a versão nativa.
  - No produto, o `resolveAllowedCwd` já normalizava os dois lados. O `update` passou a comparar com `realpathSync.native` o executável do serviço com o do processo e o do serviço com o caminho estável.
  - O teste de `~` da config confere a expansão exata, em vez de exigir que o caminho não tenha nenhum `~`.
  - Um `~` fora do começo do caminho nunca é tratado como home.
- **Home no Linux:** o `os.homedir()` do Bun, no Linux, guarda o `HOME` do início do processo. O Node e o Bun no Windows releem o ambiente a cada chamada.
  - `userHome()` lê `HOME` (no Windows, `USERPROFILE`) a cada chamada, com `os.homedir()` só como último recurso. O `expandHome`, a config padrão e o contexto do serviço usam essa função.
  - A trava de home confere o que o daemon usa.
- **happy-dom e os testes do daemon:** no Linux, o Bun roda os arquivos do desktop antes dos do daemon, no mesmo processo.
  - O happy-dom troca `AbortController`, `AbortSignal`, `Blob`, `URL` e os streams.
  - Os testes do daemon que vinham depois passavam objetos do happy-dom ao `fetch` e ao `spawn` do Bun, e falhavam assim:
    - `waitHealthy` sempre falso;
    - `hook session-start` sem entregar.
  - O `dom.ts` passou a manter as versões do Bun desses objetos.
- **Relógio:** num container, o relógio do sistema voltou no meio de um turno do `FakeRuntime`. O `durationMs` saiu negativo e reprovou no schema. A duração agora usa `performance.now()`.
- **`isServiceController`:** separa o comando por `/` e `\` em qualquer sistema. No Linux, o `basename` posix mantinha `C:\...\schtasks.exe` inteiro.
- **Cobertura nas duas pernas:** os ramos específicos de sistema recebem a dependência por parâmetro, para rodar nos dois sistemas.
  - O ramo do PowerShell no `processPath` recebe o executor.
  - O ramo de `/proc` recebe o `readlink`.
- **Reprodução local:**
  - Windows: a suíte com `TEMP`/`TMP` num caminho 8.3 (`%TEMP%\FL117F~1`);
  - Linux: o mesmo job num container `oven/bun:1.4.4`, a partir de um clone limpo.
- **CI:** a perna ubuntu voltou a bloquear (sem `continue-on-error`).
