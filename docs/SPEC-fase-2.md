# Flightdeck — Spec da Fase 2 (Multi-host)

## Objetivo e escopo

A Fase 2 coloca o `flightdeckd` em todas as máquinas (Windows, WSL, Orange Pi, VPS) e faz o app enxergar todas ao mesmo tempo, com os daemons sobrevivendo a reboot e a SSH fechado.

Pré-requisito: Fase 1 fechada pelos seus critérios de aceite (tag `fase-1`).

**Dentro da Fase 2**

- Instalação do daemon como serviço: systemd de usuário no Linux, tarefa agendada no logon no Windows.
- O daemon do Windows supervisiona o daemon de cada distro WSL configurada, mantendo o WSL acordado.
- Acesso remoto pela Tailscale, com filtro de redes de origem além do token.
- Pareamento: o daemon gera uma string de conexão que o app importa.
- Informações e saúde do host: versão do `claude`, sistema, arquitetura, uptime, heartbeat.
- Script de deploy que copia o binário por SSH e reinicia o serviço remoto.
- App com visão agregada: todos os hosts, e uma fila única "Precisa de você" com os pedidos de permissão de todas as máquinas.
- Integração com o Windows: camada `platform`, deep link `flightdeck://`, instância única, bandeja e iniciar com o Windows.

**Fora da Fase 2**

- Histórico de sessões externas, board, workflows (fases 3 a 5).
- Atualização automática do daemon.
- TLS próprio: o tráfego vai cifrado pela Tailscale (WireGuard).
- Hub central: o app continua conectando direto em cada daemon.

## Design

Cada máquina roda o mesmo binário como serviço; o app continua falando direto com cada daemon, agora também pela Tailscale.

### Serviço

Novo subcomando `flightdeckd service install | uninstall | status [--dry-run]`. A geração dos arquivos e argumentos fica em funções puras, e toda ação no sistema (gravar arquivo, rodar `systemctl`/`schtasks`, procurar executável) passa por um contexto injetado: os testes nunca tocam no sistema.

- **Linux (WSL, Pi, VPS):** grava `~/.config/systemd/user/flightdeckd.service` com `ExecStart=<caminho absoluto> start`, `Restart=always` e `RestartSec=5`, depois roda `systemctl --user daemon-reload` e `systemctl --user enable --now flightdeckd`. Se `loginctl show-user $USER -p Linger` não for `yes`, imprime o comando `sudo loginctl enable-linger $USER` em vez de executá-lo.
- **Windows:** registra uma tarefa agendada `Flightdeck\flightdeckd` no logon do usuário, sem privilégio elevado e sem janela visível. Abordagem recomendada: importar um XML (`schtasks /Create /XML`, UTF-16 com BOM) com `LogonTrigger` do próprio usuário, `InteractiveToken` e `LeastPrivilege`, e esconder o console com `conhost.exe --headless`. O `--windows-hide-console` do Bun esconderia também a saída do `pair`. Registrar em `docs/DECISIONS.md` que a criação por usuário sem administrador não foi verificada num sistema real.
- **Comando do daemon:** binário compilado roda direto; a partir do código-fonte, `bun run <bin.ts>`.
- **Caminho do `claude`:** serviço não herda o PATH do shell. O `install` resolve o executável do `claude` (no Windows, preferindo `.exe`; um `.cmd` gera aviso) e grava em `claude.executablePath`; o `ClaudeSdkRuntime` passa esse caminho ao SDK. O campo `claudePath` da Fase 1 continua aceito, com prioridade para o novo.
- **Autenticação:** serviço também não carrega o `.bashrc`, então variáveis como `CLAUDE_CODE_OAUTH_TOKEN` definidas ali não chegam. O README recomenda `claude auth login` em cada host.
- **Instância única:** um lock em `dataDir` (arquivo com o pid do dono, tomado antes do SQLite e da porta) impede dois daemons com o mesmo `dataDir`; o segundo sai com código 3 e a mensagem "já em execução". Lock de processo morto é retomado.
- **`--dry-run`** imprime a unit (Linux) ou o XML e o comando da tarefa (Windows) sem alterar o sistema: não grava arquivo, não executa comando e **não cria a config** (o `loadConfig` da Fase 1 cria o arquivo quando ele não existe; o dry-run não pode chamá-lo nesse modo).

### Supervisão do WSL

O daemon do Windows ganha a seção `wsl` na config:

```json
"wsl": [
  { "distro": "Ubuntu", "command": "~/.local/bin/flightdeckd start", "port": 7421 }
]
```

- Para cada item, sobe `wsl.exe -d <distro> --exec bash -lc "<command>"` como processo filho; isso também mantém a distro acordada. O comando é injetável para os testes usarem um processo falso.
- Reinicia com backoff de 1 s até 60 s, grava stdout e stderr em `dataDir/logs/wsl-<distro>.log` e encerra o filho quando o daemon do Windows para.
- Saída com código 3 (já em execução dentro do WSL) conta como saudável se a porta responder: zera o backoff e confere de novo mais tarde.
- O daemon do WSL escuta em `127.0.0.1:7421`; o Windows chega nele por `localhost` graças ao repasse de portas do WSL2.

### Rede e segurança

- Novo campo `allowedNetworks` (lista de CIDR), padrão `["127.0.0.0/8", "::1/128"]`. Conexão de origem fora da lista é recusada com HTTP 403 antes do upgrade para WebSocket, em qualquer rota. IPv4 mapeado em IPv6 (`::ffff:127.0.0.1`) conta como IPv4. CIDR inválido na config é erro de validação.
- Para a Tailscale: `bind` no IP da tailnet (ou `0.0.0.0`) e `allowedNetworks` com `100.64.0.0/10` e `fd7a:115c:a1e0::/48`.
- Sem TLS próprio nesta fase; o túnel da Tailscale já cifra o tráfego. O README deixa claro que expor a porta na internet aberta não é suportado.

### Pareamento

- `flightdeckd pair` imprime `flightdeck://<endereço>:<porta>?name=<hostName>&token=<token>` e o mesmo conteúdo em QR no terminal. Formatação e leitura do link ficam em `packages/protocol`, usadas pelo daemon e pelo app.
- O endereço padrão é o IP da Tailscale (via `tailscale ip -4`, se existir e funcionar), senão o `bind` (`0.0.0.0` vira `127.0.0.1`).
- `flightdeckd pair --rotate` gera token novo (regravando a config de forma atômica, sem perder outros campos) e derruba as conexões que usavam o antigo: o daemon em execução acompanha o arquivo de config e, quando o token muda, fecha com 4401 quem autenticou com o anterior. Config inválida durante a execução é ignorada.

### Protocolo (só adições, `protocolVersion` continua 1)

| Item | Tipo | Conteúdo |
| --- | --- | --- |
| `host.info` | comando | `hostName`, `os`, `arch`, `daemonVersion`, `claudeVersion`, `claudePath`, `uptimeSec`, `activeSessions`, `apiKeySanitized` |
| `sessions.watch` | comando | passa a receber `session.summary` de todas as sessões do host: primeiro o estado atual, depois cada mudança |
| `session.summary` | evento | `sessionId`, `name`, `cwd`, `status`, `pendingPermissions` (lista de `{ requestId, toolName, createdAt }`, a contagem é o tamanho), `updatedAt` |
| `ping` / `pong` | controle | daemon envia `{ type: "ping", id, lastRttMs? }` a cada 15 s; o cliente responde `{ type: "pong", id }`, sem ack; dois pings sem `pong` encerram a conexão com 4408 |

- `session.summary` é efêmero (não é gravado, carrega o último `seq` persistido) e é emitido a cada mudança de status e de pendências.
- `claudeVersion` vem de `<claude> --version` por uma sonda injetável, só com o runtime `claude`; com o `fake` é `null`. `apiKeySanitized` é `false` só quando a chave chega de fato ao processo do Claude.
- `lastRttMs` é medido pelo daemon (do `ping` ao `pong` com o mesmo id), porque o app não consegue medir um ping que não iniciou. `pong` antes do `hello` fecha com 4401.

### Deploy

`bun run deploy <alias>` lê `deploy.hosts.json` (fora do git), por exemplo `{ "pi": { "ssh": "ubuntu@orange", "target": "linux-arm64", "path": "~/.local/bin/flightdeckd" } }`. Compila o alvo, copia com `scp` para `<path>.new`, troca o arquivo e reinicia com `systemctl --user restart flightdeckd` via `ssh`, e termina conferindo `systemctl --user is-active flightdeckd`. O plano de comandos é uma função pura; a execução para no primeiro passo que falhar.

## App desktop

O app passa a tratar os hosts como uma frota: tudo que pede atenção aparece num só lugar, não importa a máquina.

- **Adicionar host:** colar a string `flightdeck://…` ou preencher endereço, porta e token manualmente; o app testa com `hello` e `host.info` antes de salvar e mostra o motivo quando falha (token recusado, host fora do ar).
- **Página do host:** dados do `host.info` ("informações indisponíveis" em daemon sem esse comando), latência do último `ping`, botão de reconectar, renomear e remover.
- **Barra lateral:** cada host com indicador online, offline ou reconectando; sessões atualizadas por `session.summary`, sem precisar abrir cada uma. O stream completo de eventos só é assinado para a sessão aberta.
- **Fila "Precisa de você":** no topo da barra lateral, todos os pedidos de permissão abertos em todos os hosts, do mais antigo ao mais novo; clicar leva à sessão no ponto do pedido; responder pela fila vai ao host certo.
- **Aviso de chave de API:** se um host reportar `apiKeySanitized: false`, o host ganha um selo de alerta, porque o consumo ali pode estar indo para crédito de API.
- **Notificações:** saem da comparação entre resumos (pedido novo, fim de turno), nunca do estado inicial, e incluem o nome do host.

### Integração com o Windows

O app passa a se comportar como app nativo, usando plugins oficiais do Tauri 2; tudo que depende deles fica atrás da camada `platform`.

- **Camada `platform`:** a Fase 1 criou só um adaptador de tokens e notificações; nesta fase ela vira `src/platform/{types,tauri,web}` com `storage`, `secrets`, `notify`, `isFocused`, `openExternal`, `onDeepLink`, `setTrayStatus`, auto-start e fechar para a bandeja. A implementação web serve aos testes de UI e ao PWA da Fase 5. Componentes React nunca importam `@tauri-apps/*` direto, e uma regra de lint (`noRestrictedImports` do Biome, padrão `@tauri-apps/**`) barra isso fora de `src/platform/tauri`.
- **Deep link `flightdeck://`:** o esquema é registrado na instalação (e em tempo de execução para builds de desenvolvimento). Abrir `flightdeck://<endereço>:<porta>?name=…&token=…` foca o app e abre "Adicionar host" já preenchido, com aviso de que o link veio de fora; nada é salvo sem o clique explícito de confirmação. Link inválido vira mensagem de erro.
- **Instância única:** uma segunda execução não abre outra janela; foca a existente e repassa o deep link para ela.
- **Bandeja:** ícone com menu (Abrir, Precisa de você (N), Sair) e dica com a contagem de pendências de todos os hosts. Fechar a janela manda o app para a bandeja; dá para desligar isso nas configurações.
- **Iniciar com o Windows:** opção nas configurações via plugin de auto-start, desligada por padrão.

## Disciplina TDD

Segue [`docs/TDD.md`](TDD.md): ciclo por área, travas e regras de evidência. A auditoria conta a partir da tag `fase-1`.

**Primeira entrega da fase: a auditoria, também em TDD.** `scripts/tdd-audit.ts`, exposto como `bun run tdd:audit -- --since <tag>`:

- Lê `git log --reverse` de `<tag>..HEAD` e interpreta os commits no formato conventional commits.
- Para cada escopo com commit `feat` ou `fix`, exige um commit `test` do mesmo escopo antes dele. `feat`/`fix` sem escopo é violação.
- Tipos `docs`, `chore`, `build`, `ci` e `refactor` não exigem teste.
- Procura `.only(`, `.skip(` e `test.todo(` nos arquivos de teste (as próprias fixtures do teste da auditoria montam essas marcas por concatenação).
- Tag inexistente sai com 2; sem violações, imprime `TDD AUDIT OK` e sai com 0; com violações, lista commit, escopo e motivo, e sai com 1.

## Testes, critérios e /goal

Como na Fase 1, tudo é provado com o `FakeRuntime` e com as travas de `docs/TDD.md` ativas; nada aqui instala serviço de verdade nem acessa outra máquina.

**Áreas de teste (cada uma entra no TDD e na auditoria)**

| Área | O que precisa passar |
| --- | --- |
| `tdd-audit` | escopo com `feat` sem `test` anterior é violação; `test` antes de `feat` passa; `.only`, `.skip` e `test.todo` são detectados |
| `unit-systemd` | o texto gerado bate com o texto esperado escrito no teste e contém caminho absoluto, `Restart=always` e `RestartSec=5`; caminho relativo é recusado |
| `tarefa-windows` | o XML e os argumentos gerados batem com o texto esperado e não pedem privilégio elevado |
| `linger` | sem linger, o `install` devolve a instrução com `sudo loginctl enable-linger` e não executa nada com sudo |
| `servico` | `install`, `uninstall` e `status` nos dois sistemas pelo contexto falso; `--dry-run` não executa, não grava e não cria a config; `claude.executablePath` é gravado (preferindo `.exe` no Windows) e usado pelo daemon |
| `instancia-unica` | segundo daemon com o mesmo `dataDir` sai com código 3; lock de processo morto é retomado |
| `supervisor-wsl` | com um comando falso que morre, reinicia com backoff crescente e para ao encerrar o pai; código 3 com porta viva conta como saudável |
| `redes` | origem fora de `allowedNetworks` recebe 403; dentro, segue para o `hello`; CIDR IPv4, IPv6 e IPv4 mapeado |
| `heartbeat` | cliente que para de responder `pong` é desconectado após dois pings; o app responde e expõe a latência |
| `resumos` | `sessions.watch` recebe `session.summary` a cada mudança de estado e de pendências |
| `host-info` | `host.info` traz os campos da tabela; sonda de versão injetada; `null` com runtime `fake` |
| `pareamento` | a string gerada é lida de volta pelo parser do app; `--rotate` invalida o token antigo no daemon em execução |
| `deploy` | o plano compila, copia para `.new`, troca, reinicia e confere `is-active`; falha em um passo interrompe |
| `platform` | a UI roda inteira com a implementação web falsa; a implementação Tauri chama os comandos e plugins certos; o lint falha se um componente importar `@tauri-apps/*` |
| `adicionar-host` | link colado preenche o formulário; o host só é salvo depois de `hello` e `host.info` responderem |
| `deep-link` | link válido vira formulário preenchido e espera confirmação; esquema errado, token ausente ou porta inválida são recusados |
| `fila-pendencias` | barra lateral vem dos resumos; fila única de todos os hosts em ordem; resposta pela fila vai ao host certo; notificações com nome do host |
| `pagina-host` | dados do `host.info`, latência, selo de chave de API, renomear, reconectar e remover |
| `badge-bandeja` | função pura que transforma resumos e pedidos de todos os hosts em contagem e texto da dica |
| `configuracoes` | fechar para a bandeja ligado por padrão e persistido; iniciar com o Windows desligado por padrão |

**Smoke multi-host (`bun run smoke:multi`)**

Sobe dois daemons `--runtime fake` em portas e `dataDir` diferentes, conecta um cliente nos dois, abre uma sessão em cada, provoca um pedido de permissão no segundo, confere que ele aparece via `session.summary`, aprova e espera os dois `turn.result`. Começa vermelho (falha controlada no passo do `sessions.watch`), roda com a trava do `claude` e imprime `SMOKE MULTI OK`.

**Critérios de aceite**

- [ ] Para cada área da tabela acima, a conversa mostra o teste falhando por asserção antes da implementação e passando depois.
- [ ] `bun run tdd:audit -- --since fase-1` imprime `TDD AUDIT OK`.
- [ ] `bun run typecheck`, `bun run lint` e `bun test` saem com código 0, com cobertura de 100%.
- [ ] `bun run smoke` imprime `SMOKE OK` e `bun run smoke:multi` imprime `SMOKE MULTI OK`.
- [ ] `bun run build:daemon`, `bun run build:desktop` e `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` saem com código 0 (o último no Windows nativo).
- [ ] `flightdeckd service install --dry-run` sai com código 0 e imprime a unit do systemd (no Linux) ou o XML e o comando da tarefa (no Windows); numa chamada separada, o estado mostra que nada mudou.
- [ ] README cobre instalação como serviço, Tailscale, pareamento, deploy e a integração com o Windows.
- [ ] Divergências registradas em `docs/DECISIONS.md`, `git status` limpo e a tag `fase-2` criada.

**Condição do /goal**

```text
/goal A Fase 2 de docs/SPEC-fase-2.md está implementada seguindo docs/TDD.md e, nesta conversa, você mostrou a saída real de: (1) para cada área da tabela de testes, começando por tdd-audit, o bun --config=bunfig.area.toml test do arquivo da área falhando por asserção antes da implementação e passando depois; (2) bun run tdd:audit -- --since fase-1 imprimindo TDD AUDIT OK; (3) bun run typecheck, bun run lint e bun test saindo com código 0; (4) bun run smoke imprimindo SMOKE OK e bun run smoke:multi imprimindo SMOKE MULTI OK; (5) bun run build:daemon, bun run build:desktop e cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml saindo com código 0, este último no Windows nativo; (6) flightdeckd service install --dry-run saindo com código 0 e imprimindo a unit ou a tarefa, e, numa chamada separada, o estado do sistema sem alteração; (7) git status sem alterações pendentes e git tag listando fase-2. Todas as rodadas de bun test e dos smokes rodaram com a trava do claude de scripts/test/preload.ts ativa, e nenhum serviço real foi instalado.
```
