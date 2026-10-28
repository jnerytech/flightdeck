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
