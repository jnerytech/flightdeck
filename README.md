# Flightdeck

Central de comando pessoal para o Claude Code. O daemon `flightdeckd` hospeda sessões do Claude
Code pelo Agent SDK oficial, guarda cada evento em SQLite e expõe um protocolo WebSocket. O app
desktop (Tauri 2 + React) conecta em um ou mais daemons, mostra o chat em streaming e aprova ou
nega ferramentas.

Fases entregues: **Fase 1** ([`docs/SPEC.md`](docs/SPEC.md)) e **Fase 2, multi-host**
([`docs/SPEC-fase-2.md`](docs/SPEC-fase-2.md)). As divergências em relação à spec
estão em [`docs/DECISIONS.md`](docs/DECISIONS.md).

```text
packages/protocol   schemas zod + tipos de comandos e eventos (compartilhado)
apps/daemon         flightdeckd (Bun + TypeScript)
apps/desktop        app Tauri 2 + React
scripts/            smoke, build dos binários e verificação de cobertura
```

## Instalar

Pré-requisitos:

- [Bun](https://bun.sh) 1.4 ou mais novo.
- O Claude Code (`claude`) instalado e logado na máquina que roda o daemon. O daemon usa a
  assinatura do próprio host e nunca repassa `ANTHROPIC_API_KEY` ao Claude, a não ser que
  `allowApiKey` esteja ligado.
- Só para o app desktop: Rust estável e os
  [pré-requisitos do Tauri 2](https://v2.tauri.app/start/prerequisites/). No Windows isso inclui
  o MSVC Build Tools e o WebView2.

```sh
bun install
```

## Configurar o daemon

Na primeira execução o daemon cria `~/.flightdeck/config.json` com valores padrão e um token
aleatório. Nos sistemas que suportam, o arquivo fica legível só pelo dono.

```json
{
  "hostName": "meu-pc",
  "bind": "127.0.0.1",
  "port": 7420,
  "token": "<gerado>",
  "dataDir": "~/.flightdeck/data",
  "allowedRoots": ["C:/Users/eu/projetos", "~/code"],
  "runtime": "claude",
  "defaultPermissionMode": "default",
  "allowApiKey": false
}
```

- **`allowedRoots`** é obrigatório na prática: sessões só podem ser abertas em pastas dentro
  dessas raízes. O caminho é resolvido com realpath, então `..` e symlinks que saem das raízes
  são recusados. Com a lista vazia, nenhuma sessão pode ser criada, e o daemon avisa no boot.
- `bind` fica em `127.0.0.1`. Para escutar em outra interface, mude o `bind` explicitamente.
- `token` é o que o app usa para conectar. Ele nunca aparece nos logs.
- `claudePath` (opcional) aponta para o executável `claude`. Nos binários compilados, o daemon
  usa o `claude` do `PATH`.

## Subir o daemon

Pelo código-fonte:

```sh
bun run --filter @flightdeck/daemon start
# ou, com opções:
bun apps/daemon/src/bin.ts start --config ~/.flightdeck/config.json --runtime claude
```

`--runtime fake` sobe o daemon com um runtime determinístico, sem rede e sem gastar cota. Serve
para testar o app.

Binário único:

```sh
bun run build:daemon   # gera dist/flightdeckd-windows-x64.exe, -linux-x64 e -linux-arm64
./dist/flightdeckd-linux-x64 --config ~/.flightdeck/config.json
```

O daemon imprime `flightdeckd <versão> listening on ws://127.0.0.1:7420/v1/ws (runtime=claude)`.

## Conectar o app desktop

```sh
cd apps/desktop
bun run tauri dev      # desenvolvimento
bun run tauri build    # instalável
```

No app, clique em **Adicionar host** e cole o link de pareamento (veja [Pareamento](#pareamento))
ou informe nome, endereço (`127.0.0.1`, ou o `bind` configurado), porta (`7420`) e token (o valor
de `token` no `config.json` do daemon). **Testar e adicionar** faz `hello` e `host.info` antes de
salvar e mostra o motivo quando falha (token recusado, host fora do ar).

O token fica no cofre de credenciais do sistema operacional (Windows Credential Manager, Keychain,
Secret Service), não em texto puro. Depois, use **+** ao lado do host para criar uma sessão: pasta
dentro dos `allowedRoots`, nome, modo de permissão e primeiro prompt. Pedidos de ferramenta
aparecem como cards inline, com **Permitir** e **Negar**. O app reconecta sozinho (de 1 s a 30 s)
e retoma cada sessão do último evento visto.

## Instalar como serviço

O daemon sobrevive a reboot e a SSH fechado rodando como serviço do próprio usuário:

```sh
flightdeckd service install --dry-run   # mostra a unit ou a tarefa, não altera nada
flightdeckd service install
flightdeckd service status
flightdeckd service uninstall
```

- **Linux (WSL, Orange Pi, VPS):** grava `~/.config/systemd/user/flightdeckd.service`
  (`Restart=always`, `RestartSec=5`) e roda `systemctl --user enable --now flightdeckd`. Sem
  *linger*, o serviço só sobe depois do seu login; o `install` imprime o comando
  `sudo loginctl enable-linger $USER` para você rodar (ele nunca executa nada com sudo).
- **Windows:** cria a tarefa agendada `Flightdeck\flightdeckd` no logon do usuário, sem
  privilégio elevado e sem janela visível (importa um XML com `schtasks /Create /XML`; o console
  fica escondido por `conhost.exe --headless`).
- O comando do serviço é o binário compilado; rodando a partir do código-fonte, vira
  `bun run apps/daemon/src/bin.ts start`.
- Serviço não herda o `PATH` do shell: o `install` grava o caminho do `claude` em
  `claude.executablePath` na config (no Windows, prefere `claude.exe`; um `.cmd` gera aviso).
  O `--dry-run` só mostra o caminho que seria gravado e não cria nem altera a config.
- Serviço também não carrega o `.bashrc`: faça `claude auth login` em cada host em vez de
  depender de `CLAUDE_CODE_OAUTH_TOKEN` exportado no shell.
- Dois daemons com o mesmo `dataDir` não convivem: o segundo sai com código 3 ("já em execução").

### WSL a partir do Windows

O daemon do Windows pode manter o daemon de cada distro WSL rodando (e a distro acordada):

```json
"wsl": [{ "distro": "Ubuntu", "command": "~/.local/bin/flightdeckd start", "port": 7421 }]
```

Cada item vira `wsl.exe -d <distro> --exec bash -lc "<command>"`, reiniciado com backoff de 1 s
até 60 s, com log em `dataDir/logs/wsl-<distro>.log`. O daemon do WSL escuta em
`127.0.0.1:7421`, que o Windows alcança por `localhost`.

## Acesso remoto pela Tailscale

Por padrão só conexões de loopback são aceitas (`allowedNetworks`:
`["127.0.0.0/8", "::1/128"]`); qualquer outra origem recebe HTTP 403 antes do WebSocket, em
qualquer rota. Para usar a tailnet, ponha o `bind` no IP da tailnet (ou `0.0.0.0`) e libere as
faixas da Tailscale:

```json
"bind": "0.0.0.0",
"allowedNetworks": ["127.0.0.0/8", "::1/128", "100.64.0.0/10", "fd7a:115c:a1e0::/48"]
```

Não há TLS próprio: o túnel WireGuard da Tailscale cifra o tráfego. **Expor a porta na internet
aberta não é suportado.**

## Pareamento

```sh
flightdeckd pair            # imprime flightdeck://<ip>:<porta>?name=…&token=… e o QR
flightdeckd pair --rotate   # gera token novo; o daemon em execução derruba quem usava o antigo
```

O endereço é o IP da Tailscale (`tailscale ip -4`) quando existe, senão o `bind`. No app, cole o
link em **Adicionar host** ou abra-o direto (`flightdeck://` está registrado no sistema); o app
preenche o formulário, testa a conexão com `hello` e `host.info` e só salva depois que você
confirma.

## Deploy

`bun run deploy <alias>` lê `deploy.hosts.json` na raiz (fora do git):

```json
{ "pi": { "ssh": "ubuntu@orange", "target": "linux-arm64", "path": "~/.local/bin/flightdeckd" } }
```

Compila o alvo, copia com `scp` para `<path>.new`, troca o binário, reinicia com
`systemctl --user restart flightdeckd` via `ssh` e confere `systemctl --user is-active`.

## App desktop: frota e Windows

- **Precisa de você:** no topo da barra lateral, todos os pedidos de permissão abertos em todos os
  hosts, do mais antigo ao mais novo. **✓** e **✕** permitem ou negam ali mesmo, no host do
  pedido; clicar no pedido abre a sessão no card de aprovação.
- **Página do host:** clique no nome do host para ver sistema, versões, sessões ativas, latência
  do heartbeat, renomear, reconectar e remover. Um host que repassa a chave de API ao Claude
  ganha um selo ⚠.
- **Notificações** trazem o nome do host. **Bandeja:** ícone com Abrir, Precisa de você (N) e
  Sair; fechar a janela manda o app para a bandeja (desligável em Configurações).
  **Iniciar com o Windows** fica em Configurações, desligado por padrão.
- **Instância única:** abrir o app de novo (ou um link `flightdeck://`) foca a janela existente.

## Histórico

O daemon de cada host indexa os transcripts do Claude Code desse host, inclusive as sessões que
nasceram fora do Flightdeck (terminal, VS Code, Desktop). O `~/.claude` é só lido: nada é
editado, apagado ou copiado entre hosts.

### O que é indexado

- Cada arquivo `<id>.jsonl` em `~/.claude/projects/<pasta>/` é uma sessão; o id é o
  `claudeSessionId`. A pasta do projeto vem do campo `cwd` das linhas.
- Entra na busca o texto das mensagens do usuário e do assistente, mais uma linha
  `[ferramenta Nome]` por chamada de ferramenta. Resultados de ferramenta não entram, e cada
  mensagem é cortada em 8 KB.
- O formato é interno ao Claude Code. Tipos de linha desconhecidos ficam guardados crus e fora da
  busca; linhas que não são JSON são contadas como erro e puladas.
- A leitura é incremental (só o que foi acrescentado), por observação de arquivos e por varredura
  a cada 10 s. Um arquivo que encolheu é lido de novo do zero.
- A busca usa FTS5 do SQLite; sem ele, o daemon cai para `LIKE` e registra a decisão no boot.
- Uma sessão é marcada **possivelmente em uso** quando o arquivo mudou nos últimos 2 minutos.

As raízes ficam em `history.roots` na config, com padrão `["~/.claude/projects"]`:

```json
{
  "history": {
    "roots": ["~/.claude/projects"],
    "excludeCwds": ["~/clientes/sigiloso", "C:/Users/eu/privado"]
  }
}
```

### Excluir pastas

Sessões cujo `cwd` é uma pasta de `history.excludeCwds`, ou fica dentro dela, nunca entram no
índice. A comparação usa o `cwd` gravado nas linhas, nunca o nome do diretório em
`~/.claude/projects`. No Windows e no macOS ela ignora maiúsculas e o tipo de barra. Mudou a
lista? Reconstrua o índice (abaixo): sessões já indexadas só saem, e arquivos já excluídos só
voltam, depois disso.

### Reconstruir o índice

```sh
flightdeckd history reindex [--config <arquivo>]
```

Apaga o índice de histórico e lê todos os transcripts de novo, imprimindo quantas sessões e
mensagens entraram. Pare o daemon antes: com outro processo no mesmo `dataDir`, o comando sai com
código 3.

### No app

- **Histórico por host** (🕘 ao lado do nome do host): sessões indexadas com título, pasta, data
  da última mensagem, origem (`Flightdeck` ou `externa`) e o selo "possivelmente em uso";
  filtros por pasta, período (dias inteiros, em UTC) e origem.
- **Busca global** (`Ctrl+K` dentro do app, ou "Buscar no histórico"): consulta todos os hosts
  online em paralelo e junta os acertos por data, com host, pasta e trecho destacado. Host offline,
  ou que não responde em 5 s, aparece como "sem resposta" sem travar o resto.
- **Leitor:** somente leitura, com o visual do chat, carregando páginas conforme a rolagem. Vindo
  da busca, abre no ponto do acerto; "Carregar anteriores" traz o começo.
- **Continuar no Flightdeck** transforma o transcript numa sessão gerenciada com `resume`. Se a
  sessão estiver possivelmente em uso, o app pede confirmação antes, porque dois processos
  escrevendo na mesma conversa a corrompem. **Copiar comando** copia `claude --resume <id>` para
  usar no terminal.

### Atalho global

`Ctrl+Alt+F` traz o app para frente com a busca global aberta, mesmo com ele em segundo plano ou
na bandeja. Para mudar, abra **Configurações → Atalho global**, digite a combinação e clique em
**Salvar atalho**.

- Formato `Modificadores+Tecla`, por exemplo `Ctrl+Shift+Y`. A tecla é uma letra, um dígito ou
  `F1` a `F24`, e é preciso ao menos `Ctrl`, `Alt` ou `Super`.
- `Ctrl+K` é recusado: ele abre a busca dentro do app e, como atalho global, colidiria com o
  navegador e o VS Code.
- Se outro programa já usa a combinação, o app avisa e abre as Configurações para você escolher
  outra. O atalho só é salvo depois que o sistema o aceita.

## Board

Cada projeto (um repositório git do host) tem um board com cinco colunas: Backlog, Em andamento,
Esperando você, Em revisão e Concluído. Um card vira uma branch `fd/<slug>`, uma worktree e uma
sessão; o card anda sozinho conforme a sessão e o PR, e também pode ser arrastado à mão.

### Cadastrar um projeto

No app, o botão ▦ ao lado do host abre **Projetos de &lt;host&gt;**. Cada projeto registra:

- **Caminho do repositório:** precisa ser um repositório git dentro de `allowedRoots`.
- **Nome** e **branch base:** em branco, ficam o nome da pasta e a branch atual do repositório.
- **Provedor de PR:** `github`, `azure-devops` ou nenhum.
- **Script de preparação** (opcional, por exemplo `bun install`): roda na worktree antes da
  sessão, com `cmd.exe` no Windows e `sh` nos demais. É o único comando de shell que o
  Flightdeck executa por conta própria, e só existe se for cadastrado. Se falhar, o card vai para
  Esperando você com a saída do erro.
- **Modelo de instruções:** anexado ao prompt de todo card. O padrão pede para trabalhar só na
  worktree e fazer commits com mensagens descritivas.

Ao iniciar um card, o daemon roda `git worktree add <repo>/.flightdeck/worktrees/<slug> -b
fd/<slug> <base>` e acrescenta `.flightdeck/worktrees/` ao `.git/info/exclude` do repositório
(o `.gitignore` não é tocado). O prompt da sessão é a descrição do card mais o modelo.

- **Em revisão:** o card entra quando um turno termina bem. Um turno com erro, interrompido por
  Parar, ou um pedido de permissão levam a Esperando você.
- **Conclusão:** Concluir (com confirmação) ou o PR mesclado removem a worktree se `git status`
  estiver limpo. Senão, o card avisa e a worktree fica.
- **Descarte:** Descartar (com confirmação, e um aviso se houver alterações não enviadas)
  remove a worktree e a branch local.

### Provedores de PR

Abrir PR faz `git push -u origin fd/<slug>` e depois chama o CLI do provedor, com o título e a
descrição do card:

- **GitHub:** `gh pr create --base <base> --head fd/<slug>`. Estado e checks vêm de `gh pr view
  --json state,statusCheckRollup`.
- **Azure DevOps:** `az repos pr create --source-branch fd/<slug> --target-branch <base>`. Estado
  vem de `az repos pr show`, e os checks das políticas, de `az repos pr policy list`.

O CLI precisa estar instalado e autenticado no host do daemon (`gh auth login`, `az login` com a
extensão `azure-devops`). O daemon só o invoca, procurando-o no PATH. O merge continua no
provedor. Os cards com PR aberto são consultados a cada 60 s, ou a cada
`board.prPollIntervalMs` da config. PR mesclado leva o card a Concluído; fechado sem merge, a
Esperando você.

### Limite de execuções paralelas

`maxParallelRuns` (padrão 2) limita quantos cards do host rodam ao mesmo tempo, para não esgotar
a cota da assinatura com agentes em paralelo. Os cards iniciados além do limite ficam em Em
andamento com o selo "na fila", em ordem de início. Eles sobem quando uma execução termina, é
interrompida ou fica ociosa.

- Sessões abertas fora do board não contam no limite.
- O limite fica na config do daemon e pode ser trocado na tela Projetos, que grava de volta no
  `config.json`:

```json
{ "maxParallelRuns": 2, "board": { "prPollIntervalMs": 60000 } }
```

## Desenvolvimento

```sh
bun run typecheck      # tsc em todos os workspaces e scripts
bun run lint           # Biome
bun test               # todos os testes, com limite de cobertura de 100% (linhas e funções)
bun run test           # bun test + garante que nenhum arquivo-fonte ficou fora da medição
bun run smoke          # ponta a ponta com o daemon real e --runtime fake; imprime SMOKE OK
bun run smoke:multi    # dois daemons, um cliente, permissão via session.summary; SMOKE MULTI OK
bun run smoke:history  # indexa, busca, retoma e vê history.changed; SMOKE HISTORY OK
bun run smoke:board    # card com gh falso e remoto local até o PR mesclado; SMOKE BOARD OK
bun run tdd:audit -- --since fase-3   # todo feat/fix tem um commit test do mesmo escopo antes
bun run build:daemon   # binários em dist/
bun run build:desktop  # frontend Vite em apps/desktop/dist
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml   # requer apps/desktop/dist
```

Desde a Fase 2 o desenvolvimento é em TDD ([`docs/TDD.md`](docs/TDD.md)): o teste de cada área
nasce vermelho, roda sozinho com `bun --config=bunfig.area.toml test ./<arquivo>` (mesmo bunfig,
sem o limite global de cobertura) e é commitado como `test(<área>)` antes do `feat(<área>)`. O
preload dos dois bunfigs instala uma trava que reprova a suíte se algum teste executar o `claude`
de verdade, e outra que aponta `HOME`/`USERPROFILE` para uma pasta temporária, para nenhum teste
ler o `~/.claude` real. Os smokes (menos o `smoke:real`) usam as mesmas travas. Os fixtures de
transcript ficam em `apps/daemon/test/fixtures/history/` e são escritos à mão.

Testes e smoke usam só o `FakeRuntime`. `bun run smoke:real` repete o roteiro com o Claude de
verdade numa pasta descartável. Ele é manual, gasta cota e não faz parte dos critérios de aceite.
