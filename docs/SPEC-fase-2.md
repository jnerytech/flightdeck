# Flightdeck — Spec da Fase 2 (Multi-host)

## Objetivo e escopo

A Fase 2 coloca o `flightdeckd` em todas as máquinas (Windows, WSL, Orange Pi, VPS) e faz o app enxergar todas ao mesmo tempo, com os daemons sobrevivendo a reboot e a SSH fechado.

Pré-requisito: Fase 1 fechada pelos seus critérios de aceite.

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

Novo subcomando `flightdeckd service install | uninstall | status`. A geração dos arquivos e argumentos fica em funções puras, testáveis sem tocar no sistema.

- **Linux (WSL, Pi, VPS):** grava `~/.config/systemd/user/flightdeckd.service` com `ExecStart=<caminho absoluto> start`, `Restart=always` e `RestartSec=5`, depois roda `systemctl --user daemon-reload` e `systemctl --user enable --now flightdeckd`. Se `loginctl show-user $USER -p Linger` não for `yes`, imprime o comando `sudo loginctl enable-linger $USER` em vez de executá-lo.
- **Windows:** registra uma tarefa agendada `Flightdeck\flightdeckd` no logon do usuário, sem privilégio elevado e sem janela visível. A forma de esconder o console fica registrada em `docs/DECISIONS.md`.
- **Caminho do `claude`:** serviço não herda o PATH do shell. O `install` resolve o executável do `claude` e grava em `claude.executablePath`; o `ClaudeSdkRuntime` passa esse caminho ao SDK.
- **Autenticação:** serviço também não carrega o `.bashrc`, então variáveis como `CLAUDE_CODE_OAUTH_TOKEN` definidas ali não chegam. O README recomenda `claude auth login` em cada host.
- **Instância única:** um lock em `dataDir` impede dois daemons com o mesmo `dataDir`; o segundo sai com código 3 e a mensagem "já em execução".
- `service install --dry-run` imprime a unit (Linux) ou o comando da tarefa (Windows) sem alterar o sistema.

### Supervisão do WSL

O daemon do Windows ganha a seção `wsl` na config:

```json
"wsl": [
  { "distro": "Ubuntu", "command": "~/.local/bin/flightdeckd start", "port": 7421 }
]
```

- Para cada item, sobe `wsl.exe -d <distro> --exec bash -lc "<command>"` como processo filho; isso também mantém a distro acordada.
- Reinicia com backoff de 1 s até 60 s, grava stdout e stderr em `dataDir/logs/wsl-<distro>.log` e encerra o filho quando o daemon do Windows para.
- Saída com código 3 (já em execução dentro do WSL) conta como saudável se a porta responder.
- O daemon do WSL escuta em `127.0.0.1:7421`; o Windows chega nele por `localhost` graças ao repasse de portas do WSL2.

### Rede e segurança

- Novo campo `allowedNetworks` (lista de CIDR), padrão `["127.0.0.0/8", "::1/128"]`. Conexão de origem fora da lista é recusada com HTTP 403 antes do upgrade para WebSocket.
- Para a Tailscale: `bind` no IP da tailnet (ou `0.0.0.0`) e `allowedNetworks` com `100.64.0.0/10` e `fd7a:115c:a1e0::/48`.
- Sem TLS próprio nesta fase; o túnel da Tailscale já cifra o tráfego. O README deixa claro que expor a porta na internet aberta não é suportado.

### Pareamento

- `flightdeckd pair` imprime `flightdeck://<endereço>:<porta>?name=<hostName>&token=<token>` e o mesmo conteúdo em QR no terminal.
- O endereço padrão é o IP da Tailscale (via `tailscale ip -4`, se existir), senão o `bind`.
- `flightdeckd pair --rotate` gera token novo e derruba as conexões que usavam o antigo.

### Protocolo (só adições, `protocolVersion` continua 1)

| Item | Tipo | Conteúdo |
| --- | --- | --- |
| `host.info` | comando | `hostName`, `os`, `arch`, `daemonVersion`, `claudeVersion`, `claudePath`, `uptimeSec`, `activeSessions`, `apiKeySanitized` |
| `sessions.watch` | comando | passa a receber `session.summary` de todas as sessões do host |
| `session.summary` | evento | `sessionId`, `name`, `cwd`, `status`, `pendingPermissions`, `updatedAt` |
| `ping` / `pong` | controle | daemon envia `ping` a cada 15 s; dois sem `pong` encerram a conexão |

### Deploy

`bun run deploy <alias>` lê `deploy.hosts.json` (fora do git), por exemplo `{ "pi": { "ssh": "ubuntu@orange", "target": "linux-arm64", "path": "~/.local/bin/flightdeckd" } }`. Compila o alvo, copia com `scp` para `<path>.new`, troca o arquivo e reinicia com `systemctl --user restart flightdeckd` via `ssh`, e termina conferindo `systemctl --user is-active flightdeckd`.

## App desktop

O app passa a tratar os hosts como uma frota: tudo que pede atenção aparece num só lugar, não importa a máquina.

- **Adicionar host:** colar a string `flightdeck://…` ou preencher endereço, porta e token manualmente; o app testa com `hello` e `host.info` antes de salvar.
- **Página do host:** dados do `host.info`, latência do último `ping`, botão de reconectar, renomear e remover.
- **Barra lateral:** cada host com indicador online, offline ou reconectando; sessões atualizadas por `session.summary`, sem precisar abrir cada uma.
- **Fila "Precisa de você":** no topo da barra lateral, todos os pedidos de permissão abertos em todos os hosts, do mais antigo ao mais novo; clicar leva à sessão no ponto do pedido.
- **Aviso de chave de API:** se um host reportar `apiKeySanitized: false`, o host ganha um selo de alerta, porque o consumo ali pode estar indo para crédito de API.
- **Notificações:** a notificação do Windows passa a incluir o nome do host.

### Integração com o Windows

O app passa a se comportar como app nativo, usando plugins oficiais do Tauri 2; tudo que depende deles fica atrás da camada `platform`.

- **Camada `platform`:** se a Fase 1 não a criou, é a primeira tarefa do app. Interface com `notify`, `secrets`, `openExternal`, `onDeepLink` e `setTrayStatus`, com duas implementações: Tauri e web. A web serve aos testes de UI e ao PWA da Fase 5. Componentes React nunca importam `@tauri-apps/*` direto, e uma regra de lint (`noRestrictedImports` do Biome) barra isso fora da pasta `platform/tauri`.
- **Deep link `flightdeck://`:** o esquema é registrado na instalação. Abrir `flightdeck://<endereço>:<porta>?name=…&token=…` foca o app e abre "Adicionar host" já preenchido, e o app pede confirmação antes de salvar, porque o link pode vir de qualquer lugar.
- **Instância única:** uma segunda execução não abre outra janela; foca a existente e repassa o deep link para ela.
- **Bandeja:** ícone com menu (Abrir, Precisa de você (N), Sair) e dica com a contagem de pendências de todos os hosts. Fechar a janela manda o app para a bandeja; dá para desligar isso nas configurações.
- **Iniciar com o Windows:** opção nas configurações via plugin de auto-start, desligada por padrão.

## Disciplina TDD

A partir desta fase, toda funcionalidade nasce de um teste que falha, e o histórico do git precisa provar isso.

**Antes de começar:** criar a tag `fase-1` no último commit da Fase 1. A auditoria conta a partir dela.

1. Para cada área da tabela de testes, e para qualquer comportamento novo fora dela, escreva primeiro o teste e rode só esse arquivo com `bun test <arquivo>`. Mostre a falha, e ela precisa ser pelo motivo certo: uma asserção, não erro de import, sintaxe ou tipo.
2. Commit só com o teste: `test(<área>): <comportamento>`, com a área em kebab-case (por exemplo `unit-systemd`, `supervisor-wsl`).
3. Escreva a implementação mínima, rode o mesmo arquivo e mostre o verde. Commit `feat(<área>): ...`.
4. Refatoração só com a suíte inteira verde, em commit `refactor(<área>): ...`.
5. Bug achado depois: primeiro o teste que reproduz, depois a correção em `fix(<área>): ...`.
6. Os smokes também começam vermelhos: o script é escrito e roda falhando antes da implementação que ele cobre.
7. Proibido: implementação antes do teste da área, enfraquecer ou apagar asserção para passar, e `.only`, `.skip` ou `test.todo` no código commitado.

**Primeira entrega da fase: a auditoria, também em TDD.** `scripts/tdd-audit.ts`, exposto como `bun run tdd:audit -- --since <tag>`:

- Lê `git log --reverse` de `<tag>..HEAD` e interpreta os commits no formato conventional commits.
- Para cada escopo com commit `feat` ou `fix`, exige um commit `test` do mesmo escopo antes dele.
- Tipos `docs`, `chore`, `build`, `ci` e `refactor` não exigem teste.
- Procura `.only(`, `.skip(` e `test.todo(` nos arquivos de teste.
- Sem violações, imprime `TDD AUDIT OK` e sai com 0; com violações, lista commit, escopo e motivo, e sai com 1.

## Testes, critérios e /goal

Como na Fase 1, tudo é provado com o `FakeRuntime`; nada aqui instala serviço de verdade nem acessa outra máquina.

**Áreas de teste (cada uma entra no TDD e na auditoria)**

| Área | O que precisa passar |
| --- | --- |
| `tdd-audit` | escopo com `feat` sem `test` anterior é violação; `test` antes de `feat` passa; `.only`, `.skip` e `test.todo` são detectados |
| `unit-systemd` | o texto gerado bate com o snapshot e contém caminho absoluto, `Restart=always` e `RestartSec=5` |
| `tarefa-windows` | os argumentos gerados batem com o snapshot e não pedem privilégio elevado |
| `linger` | sem linger, o `install` devolve a instrução com `sudo loginctl enable-linger` e não executa nada com sudo |
| `instancia-unica` | segundo daemon com o mesmo `dataDir` sai com código 3 |
| `supervisor-wsl` | com um comando falso que morre, reinicia com backoff crescente e para ao encerrar o pai |
| `redes` | origem fora de `allowedNetworks` recebe 403; dentro, segue para o `hello` |
| `pareamento` | a string gerada é lida de volta pelo parser do app; `--rotate` invalida o token antigo |
| `resumos` | `sessions.watch` recebe `session.summary` a cada mudança de estado |
| `heartbeat` | cliente que para de responder `pong` é desconectado após dois pings |
| `platform` | a UI roda inteira com a implementação web falsa; o lint falha se um componente importar `@tauri-apps/*` |
| `deep-link` | link válido vira formulário preenchido; esquema errado, token ausente ou porta inválida são recusados |
| `badge-bandeja` | função pura que transforma resumos e pedidos de todos os hosts em contagem e texto da dica |

**Smoke multi-host (`bun run smoke:multi`)**

Sobe dois daemons `--runtime fake` em portas e `dataDir` diferentes, conecta um cliente nos dois, abre uma sessão em cada, provoca um pedido de permissão no segundo, confere que ele aparece via `session.summary`, aprova e espera os dois `turn.result`. Imprime `SMOKE MULTI OK` e sai com 0.

**Critérios de aceite**

- [ ] Para cada área da tabela acima, a conversa mostra o teste falhando antes da implementação e passando depois.
- [ ] `bun run tdd:audit -- --since fase-1` imprime `TDD AUDIT OK`.
- [ ] `bun run typecheck`, `bun run lint` e `bun test` saem com código 0.
- [ ] `bun run smoke` imprime `SMOKE OK` e `bun run smoke:multi` imprime `SMOKE MULTI OK`.
- [ ] `bun run build:daemon`, `bun run build:desktop` e `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` saem com código 0 (o último no Windows nativo).
- [ ] `flightdeckd service install --dry-run` imprime a unit do systemd (no Linux) ou o comando da tarefa (no Windows) sem alterar o sistema.
- [ ] README cobre instalação como serviço, Tailscale, pareamento, deploy e a integração com o Windows.
- [ ] Divergências registradas em `docs/DECISIONS.md`, `git status` limpo e a tag `fase-2` criada.
