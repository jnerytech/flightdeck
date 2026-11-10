# Phase 14 decisions: the interface (phase 14)

## Tabs (`abas`)

- **The router became the active tab's:** each tab owns a `Router` with its own history, and `store.router` is a facade over the focused area's active tab. No screen changed: they keep calling `store.router` and `go`.
- **"Open in a new tab" without touching every list:** `Ctrl+click` and the middle button set a one-event flag on the focused tabs (`openNextInNewTab`), and the next navigation opens a tab instead of replacing the current one. The middle button fires no `click`, so the capture listener clicks the item itself.
- **Menu entry:** **Abrir em nova aba** is in the host's menu (sidebar) and in a session row's menu. The other items (board cards, projects, history rows) open in a new tab by `Ctrl+click` or the middle button: the board card's menu has only **Iniciar**, and the project and history rows have no menu.
- **The plus button:** the spec opens a new tab with `Ctrl+T`. Chromium keeps `Ctrl+T`, `Ctrl+W` and `Ctrl+Shift+T` for itself, so the web entry (the demo and the e2e) needs a button: **Nova aba**, at the end of the bar, opens a tab on the palette like `Ctrl+T`.
- **Only tabs in the tablist:** axe (`aria-required-children`) refuses buttons inside a `tablist`, so the move, pin and close buttons are the active tab's and sit right after the tabs, next to **Nova aba**. Any tab closes with the middle button, or with `Ctrl+W` once active.
- **Unread:** a session tab gets **Não lida** when the session goes from running to idle while no area's active tab shows it, and loses it when it is shown.
- **Closed tabs:** the last 20 are kept with their screen only (not their history).

## Split view (`divisao`)

- **Two areas at most,** each with its own `Tabs`. Splitting opens the second area on the screen of the active tab and focuses it; joining appends the second area's tabs to the first.
- **Focus by pointer:** a pointer down inside an area focuses it before the click runs, so navigation from that area stays there.
- **Divider:** a share of the window, kept between 20% and 80%, by the pointer or by the arrows (5% a step).
- **Buttons:** **Dividir a tela** / **Juntar as áreas** and **Dividir na horizontal** / **Dividir na vertical** at the end of the first area's bar, next to `Ctrl+\`.

## Persistence (`persistencia-abas`)

- **What is kept:** each area's tabs (the current route and whether it is pinned), the active tab, the split, the focus and the divider, in `flightdeck.workspace`, on every change.
- **What is not kept:** histories, and the `add-host` route, whose draft can hold a token.
- **Unreadable data** (another version, unknown route names, an empty area) gives a fresh window or drops the bad tab; numbers out of range are clamped.
- **Offline host:** the restored tab uses the existing "Conectando a <host>…" state of the screens that wait for their host; a host removed meanwhile sends the screen to the hub, as before.

## Terminal in the app (`terminal-ui`)

- **Colors:** xterm reads sRGB colors and the theme tokens are oklch, so the terminal has a light and a dark palette written in hex next to the tokens, not read from them.
- **xterm 6.0.0** with `fit`, `web-links`, `search` and `unicode11`, pinned. `unicode11` is a proposed API, so the terminal is built with `allowProposedApi`. xterm loads only when a terminal opens (dynamic import).
- **Tests:** xterm does not render in happy-dom. The screen talks to xterm through a small adapter (`createXtermScreen`) built from injected factories, and the tests drive a fake one; the real factories are only checked to build a terminal.
- **Font size** in Settings, 10 to 24 px, 13 by default; the family is `"Cascadia Mono", Consolas, monospace`.
- **Opening:** the host page's **Terminal** panel (new or live terminals, turning them on or off) and **Novo terminal em <host>** in the palette. The terminal opens in the host's first allowed folder.
- **Copy and paste:** `Ctrl+Shift+C` / `Ctrl+Shift+V`, and the right button opens a small **Copiar** / **Colar** menu over the terminal.
- **Links:** a link in the output goes through the app's `openLink` (only http and https reach the browser), not xterm's default `window.open`, which does nothing in the desktop webview.
- **Refit:** a resize observer fits xterm again when the window, the tab or the split changes the box, and the new size goes to the host through the session's 100 ms debounce.
- **Closing:** the tab's close button, `Ctrl+W` and the screen's own **Fechar terminal** all ask **Desanexar** (the default) or **Encerrar processo**; the screen's close now closes its tab instead of going back.

## Claude here in the app (`claude-aqui`)

- **Where:** every `TerminalButton` (session, card, project, checkpoints, terminal session) adds **Abrir Claude aqui (terminal)** or **Continuar no terminal** when the host's terminals are on, and the palette's terminal action prefers the embedded terminal.
- **The outside terminal keeps its labels:** the spec renames it to "Abrir no Windows Terminal". The button also copies a command for remote hosts and other suites assert on its text, so it keeps "Abrir no terminal" / "Copiar comando" and sits next to the new one.
- **Reader:** an ended terminal session or a history one opens in the reader, which has **Continuar no terminal** next to its own **Continuar** when the host's terminals are on.
- **Linking the two views:** the terminal tab finds its launch id through `terminal.list` and shows **Ver como sessão** when an external session of the same host has that launch id; the session shows **Ver terminal** when a live terminal of its host has its launch id.

## e2e (`e2e-abas-terminal`)

- **No tab keys:** Chromium keeps `Ctrl+T`, `Ctrl+W` and `Ctrl+Shift+T`. The journey opens the second tab with a `Ctrl+click` on alfa (the **Nova aba** button opens the palette over the bar) and splits with **Dividir a tela**. It ends its terminal at the end, since the demo keeps its state from one language to the next.
- **Bugs the journey found:** the session decoded the output with Node's `Buffer` (absent in the browser, so every terminal came up detached), and ending a terminal sent SIGTERM, which an interactive shell ignores. The session now decodes with `atob`, and the daemon sends SIGHUP and, 2 s later, SIGKILL to what is still there.
- **Prints:** `demo:shots` takes `abas-divididas` (two tabs, split) and `terminal` (a live terminal after an echo) in both themes and languages.
- **A real shell:** the demo daemons listen on loopback, so their terminals are on with the host's real shell. The journey types an `echo` of a unique marker, detaches, attaches again from the host page and finds the marker in the scrollback.
## Hosts SSH (daemon)

- **Chave do cofre: agent só fora do Windows.** A prova, feita com chaves geradas na hora:
  - o `ssh-agent` do OpenSSH do Windows (9.5) só roda como serviço (aqui `Disabled`), com o pipe fixo `\\.\pipe\openssh-ssh-agent`; `ssh-agent -a <pipe>` responde "unable to start ssh-agent service, error :1058" e ignora o `-a`. Subir o serviço pede admin e é global, não por conexão;
  - o `ssh-agent` do Git for Windows (MSYS) aceita `-a <socket curto>` e `ssh-add -`, e o `ssh-add` do próprio Git lista a chave, mas o `ssh-add` do OpenSSH do Windows não lê esse socket ("invalid format"). Só serviria se o `ssh` também fosse o do Git, o que não dá para garantir;
  - o arquivo temporário só do dono funciona: criado vazio, restrito com `icacls /inheritance:r /grant:r <usuário>:(R,W,D)` e só então escrito, e o `ssh-keygen -y -f` o lê.
  - Por isso: no Windows a `vault-key` vira um arquivo em `<dataDir>/ssh/keys`; nos outros sistemas é um `ssh-agent -D -a <socket>` por conexão (socket curto em `tmpdir`, `ssh-add -` pelo stdin, `SSH_AUTH_SOCK` só para aquele `ssh`). O agent real foi conferido num contêiner Linux: a chave aparece só naquele agent e ele some ao desfazer.
  - A chave é desfeita uma vez só: em 60 s, quando o terminal acaba, ou ao parar o daemon. Em qualquer falha antes do terminal abrir, na hora. A chave chega no `ssh.connect` (`privateKey`, só para `vault-key`, até 64 KB) e nunca é guardada nem vai para o log.
  - Com o agent por conexão `IdentitiesOnly` fica `no` (o agent só tem aquela chave, mas o ssh ainda pode tentar as chaves padrão do usuário); com arquivo é `yes`.
- **Argv em lista e arquivos próprios.** O `ssh` roda como uma lista (nada passa por shell), com o destino depois de `--`, `StrictHostKeyChecking=yes`, `BatchMode=no`, e um `known_hosts` e um config do próprio Flightdeck em `<dataDir>/ssh`, nomeados pelo hash do conteúdo (`kh-…`, `config-…`), então abrir de novo reaproveita e nada é regravado. O `~/.ssh` do usuário nunca é lido nem escrito na conexão (`-F` aponta o config gerado; `GlobalKnownHostsFile` vai para `/dev/null` ou `NUL`).
- **`-J` não repassa os `-o`.** Sondado com o ssh real: o ssh que o `-J` abre para o salto recebe só o `-F`. Por isso o config gerado leva o `StrictHostKeyChecking`, o `known_hosts` e, para um salto com `key-file`, o `IdentityFile`. Um salto só pode usar `agent` ou `key-file`; `vault-key` e senha num salto são recusados.
- **Chave do servidor.**
  - A coluna `host_key` guarda um JSON `{ fingerprint, keys[] }`: o fingerprint SHA256 da chave preferida (ed25519, depois ecdsa, depois rsa) e todas as chaves lidas.
  - O fingerprint só se confirma se for o que a última verificação acabou de mostrar, em até 5 minutos. Trocar uma chave guardada pede esquecer antes, de propósito: ver o fingerprint novo não basta.
  - Toda conexão (e todo `ssh.test`) lê as chaves de novo com `ssh-keyscan` e compara, para mostrar o antigo e o novo. Os erros são `hostkey_unconfirmed` e `hostkey_changed`, com os fingerprints na mensagem.
  - Um destino atrás de um jump não é alcançável pelo `ssh-keyscan` daqui. Se a chave dele já está guardada, a conexão segue e quem confere é o próprio `ssh` (`StrictHostKeyChecking=yes`); se nunca foi guardada, a conexão é recusada: **a primeira conexão de um destino atrás de jump precisa alcançá-lo direto**. É uma limitação conhecida.
  - Trocar o host ou a porta de um destino esquece a chave guardada.
- **Cadastro (`ssh_targets`).** O que o `ssh` leria como opção é recusado na entrada: host (nome, IPv4 ou IPv6), usuário, porta e o caminho da chave não podem começar com `-` nem ter caracteres de controle. `secret_ref` é o caminho da chave (`key-file`) ou o item do cofre (`vault-key`, `password`), nunca um segredo, e o `ssh.save` é estrito: um campo `password` é `bad_request`. As opções são uma lista fixa em camelCase (`serverAliveInterval`, `compression`, `localForward`, `forwardAgent`); `forwardAgent` nasce desligado e ligar pede `confirm`. O jump aponta para um destino existente, sem ciclo, e quem é jump de outro não pode ser removido.
- **Importar do `~/.ssh/config`.** Só leitura. Vale o primeiro valor na ordem do arquivo, como no OpenSSH (um `Host *` no fim dá o padrão a quem não definiu o campo); `Match` é ignorado; `Include` aceita `~`, caminho relativo a `~/.ssh` e glob no último componente, com limite de profundidade e sem laço. Só nomes concretos viram destino. O que o usuário não escolheu não entra, e um `ProxyJump` que não é um destino (ou vários) faz o item ser recusado com o motivo, em vez de ser descartado e a conexão ir direto. Os outros valores do `Host *` (como `ServerAliveInterval`) não viram opções do destino.
- **Askpass.**
  - O `SSH_ASKPASS` aponta para um script do daemon (um `sh`, ou um `.cmd` que repassa `%*`) que chama `flightdeckd askpass`, com a config em `FLIGHTDECK_CONFIG` e um ticket em `FLIGHTDECK_ASKPASS_TICKET`. O ticket nomeia o destino e o tipo, vale 10 minutos e 5 pedidos (o ssh repete o pedido com a senha errada), e nunca é a senha.
  - O helper fala com o WebSocket principal do daemon (`askpass.ask`); o daemon manda `askpass.request` a todo app que fez `askpass.watch`, e a primeira `askpass.answer` vale (`null` recusa). Sem app, ticket ruim, ou 120 s sem resposta, falha na hora. A resposta passa pela memória do daemon e não fica em campo nem em log.
  - Senha usa `SSH_ASKPASS_REQUIRE=force`; chave com frase usa `prefer`. O `ssh.test` roda com `BatchMode=yes`, que não pergunta nada, então não testa senha (diz isso) e não usa askpass.
  - Se o script não pode ser escrito (um `%` ou aspas no caminho do `flightdeckd` no Windows não cabem num `.cmd`), não há askpass: senha é recusada e as chaves seguem pedindo a frase no terminal.
- **Terminal.** `OpenRequest` ganhou `env`, `internal` (o cwd é a pasta do próprio daemon, fora de `allowedRoots`) e `onExit`. São só para o código do daemon: nenhum deles está no protocolo.
- **Qual `ssh`.** `ssh.path` na config manda; senão, no Windows o do sistema (`System32\OpenSSH\ssh.exe`, o que aceita `-F` e `NUL`) quando existe, e nos outros o do PATH. Os caminhos que o `ssh` lê vão com barras e entre aspas se tiverem espaço.
- **Teste de conexão.** `ssh.test` roda `ssh -o BatchMode=yes -o ConnectTimeout=10 … exit 0`, sem terminal, e traduz o stderr (autenticação recusada, conexão recusada, host não encontrado, tempo esgotado, chave diferente da guardada); o que não reconhece vai como a última linha, até 200 caracteres.

## TDD e testes (SSH)

- **Fakes e PTY:** nenhum teste abre um `ssh` de verdade; o `ssh-keyscan`, o ssh e o agent são injetados ou falsos. O `smoke:ssh` põe ferramentas falsas à frente do PATH do daemon (um programa do bun, com um wrapper `.cmd` ou `sh`) e usa um `~/.ssh/config` de fixture sob a trava de HOME.
- **Vermelho do `smoke:ssh`:** numa cópia da base `56d23a1`, `SMOKE SSH FAIL no passo "importar o ssh config"` (o comando não existe) e código 1. Passa no Windows (arquivo temporário, `askpass.cmd` chamado pelo ssh falso) e no contêiner Linux (agent por conexão falso).
- **Regra 7:** os ramos que a cobertura apontou foram removidos para o teste ficar vermelho antes de voltar: aspas no `unquote` do import, o `-i` de uma chave entregue como arquivo, a limpeza da entrega quando os arquivos do ssh não podem ser escritos, e o id padrão do socket do agent.
- **Ainda sem conferência real:** o `ssh` do sistema pedindo a senha por um `askpass.cmd` no Windows (o ssh falso o chamou, o de verdade só na conferência com o usuário) e um destino real atrás de jump.

## Phase 15 decisions: the app

- **The registry is the first online host that announces `ssh`.** The spec keeps the destinos in the daemon of the local host. Hosts announce `ssh` in `host.info` (new feature flag, `ssh-destinos` area), and the Conexões screen, the palette and the sidebar use the first online one. Several hosts that keep destinos are not merged.
- **Connect checks the server key in the app before `ssh.connect`.** `ssh.hostkey.check` says `pinned` (connect), `unknown` (show the fingerprint, confirm with `ssh.hostkey.confirm`, then connect) or `changed` (blocked, old and new shown; the way out is Forget server key in the form).
- **`via_host` runs the ssh.** The daemon that runs ssh builds the command from its own destinos, so Conectar keeps a copy of the destino (and of the destinos it jumps through, jump first) on the via host: the copy it already has by name is updated, never doubled, and its `via_host` is empty there. The server-key check and the terminal then run on the via host, and the terminal tab belongs to it. A via host that is not connected, or does not announce `ssh`, is an error shown on the screen, and nothing is copied or run.
- **The form offers `agent`, `key-file` and `password`.** `vault-key` comes with the vault (phase 16) on top. A `password` destino keeps no reference: the prompt is answered when ssh asks.
- **The app answers `askpass.request` with a dialog** (masked field, "Senha" or "Frase" by kind). The hosts that announce `ssh` are watched (`askpass.watch`) at each connection. Requests are answered one at a time; Cancel and Esc answer `null`, so ssh fails at once. The secret lives only in the dialog's field and in the `askpass.answer` command: it is not in the store, the storage or any log (a test looks for it in each). With the vault on top, a request that carries a `secretRef` can be answered from it without asking.
- **The badge and the red border are on the terminal tab,** named "SSH · name" with the tags. They come from `store.sshTerminals`, which is in memory only: after a restart a restored terminal tab has no badge.
- **The terminal screen is opened at 80x24.** The terminal screen resizes it once attached.
- **The palette reads the destinos when it opens** (`loadPalette`), and choosing one opens Conexões with the destino to connect to (`Route.connections.connect`), so the key check and its dialogs are the same as from the button.
- **Prod tags** are `prod`, `produção` and `producao`, in any case (`lib/ssh.ts`).
- **"Claude aqui" over SSH** and pairing a destino that has `flightdeckd` as a host are not part of this branch.
- **The version is 0.15.0** (`test(versao)` cycle); at integration it resolves to the highest number.
