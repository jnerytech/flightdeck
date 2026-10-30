# Manual do Flightdeck

[English](en.md) | Português (Brasil) · [Voltar ao README](../../README.pt-BR.md)

Referência completa do Flightdeck, organizada por assunto. Vale para a versão 0.17.0. O roadmap
está em [`docs/SPEC.md`](../SPEC.md), as divergências em relação às specs em
[`docs/DECISIONS.md`](../DECISIONS.md) e o vocabulário da interface em
[`docs/GLOSSARY.md`](../GLOSSARY.md). O manual supõe `flightdeckd` no `PATH`; o binário instalado
fica em `~/.flightdeck/bin`, que o `update` não acrescenta ao `PATH`.

## Sumário

- [Visão geral](#visão-geral)
- [Instalação](#instalação)
  - [Pelos binários da release](#pelos-binários-da-release)
  - [A partir do código-fonte](#a-partir-do-código-fonte)
- [Hosts e configuração do daemon](#hosts-e-configuração-do-daemon)
  - [O arquivo de configuração](#o-arquivo-de-configuração)
  - [Subir o daemon](#subir-o-daemon)
  - [Conectar o app desktop](#conectar-o-app-desktop)
- [Serviço](#serviço)
  - [Instalar como serviço](#instalar-como-serviço)
  - [WSL a partir do Windows](#wsl-a-partir-do-windows)
- [Acesso remoto pela Tailscale](#acesso-remoto-pela-tailscale)
- [Pareamento](#pareamento)
- [Central de sessões e hooks do Claude Code](#central-de-sessões-e-hooks-do-claude-code)
  - [O que aparece na lista](#o-que-aparece-na-lista)
  - [Hooks do Claude Code](#hooks-do-claude-code)
  - [Aprovar sessões do terminal pelo app](#aprovar-sessões-do-terminal-pelo-app)
- [flightdeckd claude e o canal](#flightdeckd-claude-e-o-canal)
  - [Como funciona](#como-funciona)
  - [Por que a extensão do VS Code fica de fora](#por-que-a-extensão-do-vs-code-fica-de-fora)
- [Aprovações e permitir sempre](#aprovações-e-permitir-sempre)
- [Board](#board)
  - [Cadastrar um projeto](#cadastrar-um-projeto)
  - [Ciclo do card](#ciclo-do-card)
  - [Provedores de PR](#provedores-de-pr)
  - [Limite de execuções paralelas](#limite-de-execuções-paralelas)
- [Revisão de mudanças](#revisão-de-mudanças)
  - [`.worktreeinclude`](#worktreeinclude)
  - [Statusline do Claude Code](#statusline-do-claude-code)
- [Workflows](#workflows)
  - [Declarar](#declarar)
  - [Confiar](#confiar)
  - [Rodar e acompanhar](#rodar-e-acompanhar)
  - [Orçamento de uma execução](#orçamento-de-uma-execução)
  - [O servidor MCP flightdeckd mcp](#o-servidor-mcp-flightdeckd-mcp)
- [Histórico](#histórico)
  - [O que é indexado](#o-que-é-indexado)
  - [Excluir pastas](#excluir-pastas)
  - [Reconstruir o índice](#reconstruir-o-índice)
  - [No app](#no-app)
- [Checkpoints e configuração do agente](#checkpoints-e-configuração-do-agente)
  - [Snapshots](#snapshots)
  - [A linha do tempo](#a-linha-do-tempo)
  - [Voltar arquivos](#voltar-arquivos)
  - [Bifurcar](#bifurcar)
  - [A tela Agente](#a-tela-agente)
- [Issues, automações e arena](#issues-automações-e-arena)
  - [Issues](#issues)
  - [Automações](#automações)
  - [Arena](#arena)
- [Aprovação graduada por risco](#aprovação-graduada-por-risco)
- [Ações: o Claude usa um segredo sem vê-lo](#ações-o-claude-usa-um-segredo-sem-vê-lo)
- [Custos, orçamentos e cota](#custos-orçamentos-e-cota)
  - [Cota do plano](#cota-do-plano)
  - [Fila por cota](#fila-por-cota)
  - [Uso](#uso)
  - [Custos](#custos)
  - [Preços](#preços)
  - [Orçamentos](#orçamentos)
  - [Histórico da cota](#histórico-da-cota)
- [Abas e terminal embutido](#abas-e-terminal-embutido)
  - [Abas](#abas)
  - [Tela dividida](#tela-dividida)
  - [Terminal embutido](#terminal-embutido)
  - [Claude aqui](#claude-aqui)
- [Uso diário](#uso-diário)
  - [Precisa de você, página do host e notificações](#precisa-de-você-página-do-host-e-notificações)
  - [Bandeja](#bandeja)
  - [Abrir no terminal](#abrir-no-terminal)
  - [Paleta Ctrl+K](#paleta-ctrlk)
  - [Atalho global](#atalho-global)
- [Interface](#interface)
  - [Desenho e navegação](#desenho-e-navegação)
  - [Modo demonstração, prints e testes de ponta a ponta](#modo-demonstração-prints-e-testes-de-ponta-a-ponta)
- [Operação do host](#operação-do-host)
  - [Versões e compatibilidade](#versões-e-compatibilidade)
  - [Atualizar com flightdeckd update](#atualizar-com-flightdeckd-update)
  - [Atualização automática assinada](#atualização-automática-assinada)
  - [Retenção](#retenção)
  - [Backup e restauração](#backup-e-restauração)
- [Deploy](#deploy)
- [Releases](#releases)
- [Desenvolvimento](#desenvolvimento)

## Visão geral

O Flightdeck é uma central de comando pessoal para o Claude Code. O daemon `flightdeckd` hospeda
sessões do Claude Code pelo Agent SDK oficial, guarda cada evento em SQLite e expõe um protocolo
WebSocket. O app desktop (Tauri 2 + React) conecta em um ou mais daemons, mostra o chat em
streaming, aprova ou nega ferramentas e reúne, num lugar só, as sessões de todos os hosts.

```text
packages/protocol   schemas zod + tipos de comandos e eventos (compartilhado)
apps/daemon         flightdeckd (Bun + TypeScript)
apps/desktop        app Tauri 2 + React
scripts/            smoke, build dos binários e verificação de cobertura
```

Cada fase entregue tem a sua spec (`docs/SPEC-fase-<n>.md`); a Fase 1 e o roadmap estão em
[`docs/SPEC.md`](../SPEC.md). As primeiras: Fase 2, multi-host
([`SPEC-fase-2.md`](../SPEC-fase-2.md)); Fase 3, histórico ([`SPEC-fase-3.md`](../SPEC-fase-3.md));
Fase 4, board ([`SPEC-fase-4.md`](../SPEC-fase-4.md)); Fase 5, central de sessões
([`SPEC-fase-5.md`](../SPEC-fase-5.md)); Fase 6, workflows ([`SPEC-fase-6.md`](../SPEC-fase-6.md)).

## Instalação

### Pelos binários da release

Cada versão sai na página de [Releases](https://github.com/jnerytech/flightdeck/releases) com:

| Arquivo | O que é |
| --- | --- |
| `Flightdeck_<versão>_x64-setup.exe` | instalador do app desktop para Windows (NSIS) |
| `Flightdeck_<versão>_x64_en-US.msi` | o mesmo app, em MSI |
| `flightdeckd-windows-x64.exe` | daemon para Windows |
| `flightdeckd-linux-x64` | daemon para Linux e WSL (x64) |
| `flightdeckd-linux-arm64` | daemon para Linux arm64 (Orange Pi, Raspberry Pi) |
| `SHA256SUMS` | o SHA-256 de cada arquivo |

A release traz também as assinaturas (`.sig`) do instalador NSIS e dos daemons e os manifestos
`latest.json` e `daemon-latest.json`, usados pela [atualização automática](#atualização-automática-assinada).

1. **Confira o download** antes de executar:
   - Linux: `sha256sum -c SHA256SUMS --ignore-missing`.
   - Windows (PowerShell): `(Get-FileHash .\<arquivo>).Hash.ToLower()`, e compare com a linha do
     arquivo no `SHA256SUMS`.
2. **App:** rode o instalador. Ele **não tem assinatura de código do Windows (Authenticode)**, então
   o SmartScreen mostra "O Windows protegeu o computador". Com o hash conferido, clique em **Mais
   informações** e depois em **Executar assim mesmo**. (A assinatura minisign das atualizações é
   outra coisa: veja [Atualização automática assinada](#atualização-automática-assinada).)
3. **Daemon:** em cada host, com o Claude Code instalado e logado:
   - no Linux, `chmod +x` no binário antes de usar;
   - rode `<binário> update --from <binário>`, que instala em `~/.flightdeck/bin`;
   - depois, `~/.flightdeck/bin/flightdeckd service install` (veja
     [Instalar como serviço](#instalar-como-serviço)).

### A partir do código-fonte

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

O app desktop, em desenvolvimento ou como instalável:

```sh
cd apps/desktop
bun run tauri dev      # desenvolvimento
bun run tauri build    # instalável
```

## Hosts e configuração do daemon

Um host é a máquina onde roda um `flightdeckd`. O app conecta em quantos hosts você cadastrar.

### O arquivo de configuração

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

As demais chaves (`allowedNetworks`, `wsl`, `hooks`, `history`, `updates`, `retention`,
`backup`, `quota`, `pricing`, `maxParallelRuns`, `board`) estão nas seções dos recursos a que
pertencem.

### Subir o daemon

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
Para que ele sobreviva a reboot e a SSH fechado, [instale-o como serviço](#instalar-como-serviço).

### Conectar o app desktop

No app, clique em **Adicionar host** e cole o link de pareamento (veja [Pareamento](#pareamento))
ou informe nome, endereço (`127.0.0.1`, ou o `bind` configurado), porta (`7420`) e token (o valor
de `token` no `config.json` do daemon). **Testar e adicionar** faz `hello` e `host.info` antes de
salvar e mostra o motivo quando falha (token recusado, host fora do ar).

O token fica no cofre de credenciais do sistema operacional (Windows Credential Manager, Keychain,
Secret Service), não em texto puro. Depois, use **+** ao lado do host para criar uma sessão: pasta
dentro dos `allowedRoots`, nome, modo de permissão e primeiro prompt. Pedidos de ferramenta
aparecem como cards inline, com **Aprovar** e **Negar**. O app reconecta sozinho (de 1 s a 30 s)
e retoma cada sessão do último evento visto.

## Serviço

### Instalar como serviço

O daemon sobrevive a reboot e a SSH fechado rodando como serviço do próprio usuário:

```sh
flightdeckd service install --dry-run   # mostra a unit ou a tarefa, não altera nada
flightdeckd service install [--config <arquivo>]
flightdeckd service status              # estado e a config que o serviço usa
flightdeckd service stop                # para o daemon; o serviço continua instalado
flightdeckd service start               # sobe o serviço e espera o /health
flightdeckd service uninstall           # para o daemon e remove o serviço
```

- **Config:** com `--config`, o serviço roda `start --config <caminho absoluto>`; sem, usa
  `~/.flightdeck/config.json`.
- **Parar:** o `stop` e o `uninstall` seguem a mesma sequência:
  - pedem `daemon.shutdown` ao daemon;
  - param a tarefa ou a unit;
  - esperam o lock do `dataDir`, encerrando o processo só se ele for o executável do serviço.

  No Windows, `schtasks /End` sozinho não basta: ele encerra o `conhost.exe` e deixa o daemon
  rodando. O `start` sobe o serviço e espera o `/health` da config dele por até 30 s.

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
`127.0.0.1:7421`, que o Windows alcança por `localhost`. Se esse daemon também recebe hooks, o
`hooks.port` dele precisa ser diferente do do Windows (veja [Hooks do Claude Code](#hooks-do-claude-code)).

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

## Central de sessões e hooks do Claude Code

A tela **Sessões** é a principal do app: todas as sessões do Claude Code dos hosts online, num
lugar só, agrupadas por projeto e ordenadas pela última atividade.

### O que aparece na lista

| Origem | De onde vem |
| --- | --- |
| Flightdeck | sessões que o próprio daemon roda (`session.list`) |
| terminal | sessões abertas fora do Flightdeck, no terminal ou no terminal integrado do VS Code, vistas pelos hooks do Claude Code (`external.list`) |
| histórico | transcripts indexados de `~/.claude/projects` (`history.list`) |

Uma sessão aparece uma vez só. A ordem de preferência é gerenciada, depois terminal, depois
histórico.

- **Grupo:** é o projeto. Vale o `remote.origin.url` do repositório da pasta da sessão,
  normalizado, de modo que SSH e HTTPS do mesmo repositório caem juntos. Worktrees contam como o
  repositório principal. Sem remoto, vale a raiz do repositório; sem repositório, a pasta.
- **Linha:** mostra host, origem, estado (rodando, precisa de você, ociosa, encerrada), o selo
  "controlável" e a hora.
- **Resumo:** abaixo, uma linha tirada do transcript, sem IA: "Pedido: <primeira linha do último
  prompt, até 80 caracteres>" e o que a sessão faz agora ("rodando Bash", "esperando aprovação de
  Write", "ociosa há 12 min"). O daemon manda isso no campo `summary` das listas.
- **Filtros:** texto, host, origem, estado, "Só fixadas" e "Mostrar arquivadas". As arquivadas
  ficam fora por padrão.
- **Menu:** renomear, fixar (as fixadas vão para o topo do grupo), arquivar e "Copiar comando"
  (`flightdeckd claude --resume <id>`).
- **Abrir uma sessão:**
  - gerenciada: abre a conversa;
  - do terminal ainda viva: abre o transcript ao vivo, com os pedidos de permissão dela e, se for
    controlável, a caixa de mensagem;
  - encerrada ou do histórico: abre o leitor, com "Continuar no Flightdeck".

### Hooks do Claude Code

As sessões abertas fora do Flightdeck só aparecem com os hooks instalados no host. Há dois
caminhos, e ambos são opt-in: na tela do host, o botão **Instalar hooks**, que pede confirmação,
ou no terminal do host:

```sh
flightdeckd hooks install     # grava as entradas do Flightdeck em ~/.claude/settings.json
flightdeckd hooks status      # instalados, ausentes ou desatualizados
flightdeckd hooks uninstall   # remove só as entradas do Flightdeck
```

- **O que é escrito:** é a única escrita do Flightdeck em `~/.claude`.
  - O `install` mescla as entradas com o que já existe, sem tocar nas outras chaves nem nos hooks
    de terceiros.
  - Antes, guarda uma cópia em `settings.json.flightdeck-backup`.
  - Reinstalar substitui as entradas antigas em vez de duplicar.
- **Entradas:**
  - `SessionStart` é um hook de comando:
    `<flightdeckd> hook session-start --url <receptor> --token <token>`. No Windows, o Claude Code
    roda hooks de comando pelo Git Bash, que trata `\` como escape. Por isso o caminho do
    executável é gravado com barras normais (`D:/...`). Uma instalação antiga, com barras
    invertidas, aparece como desatualizada no `hooks status`: rode `hooks install` de novo.
  - `UserPromptSubmit`, `Notification`, `PermissionRequest`, `PostToolUse`, `PostToolUseFailure`,
    `PermissionDenied`, `Stop` e `SessionEnd` são hooks http para o receptor do daemon, em
    `http://127.0.0.1:<hooks.port>`, com o cabeçalho de token.
- **Config:** `hooks.port` vale 7421 por padrão. `hooks.token` é gerado no primeiro install.
  `hooks.permissionTimeoutS` vale 600. `hooks.staleAfterS` vale 900; uma sessão sem eventos e sem
  mudança no transcript por esse tempo passa a encerrada.
- **WSL:** o daemon do WSL instala no `~/.claude` do WSL e precisa de um `hooks.port` diferente do
  Windows.
- **Instalar pelo CLI com o daemon rodando:** o daemon passa a receber os hooks depois de
  reiniciado (`flightdeckd service stop` e `service start`). Instalando pelo app, o receptor sobe
  na hora.
- **O Claude nunca espera pelo Flightdeck:**
  - Com o daemon fora do ar, os hooks falham rápido e a sessão segue.
  - Sem nenhum app aberto, o pedido de permissão é respondido na hora, vazio, e o diálogo do
    terminal decide.

### Aprovar sessões do terminal pelo app

Com o app aberto, o `PermissionRequest` de uma sessão do terminal espera a resposta e aparece em
**Precisa de você**, com notificação do sistema. Enquanto isso, o diálogo do terminal continua
ativo. Vale o que vier primeiro:

- **Aprovar ou Negar no app:** libera ou nega a ferramenta.
- **Responder no terminal:** o pedido sai da fila no próximo evento da sessão.

Nada é aprovado sem um clique.

## flightdeckd claude e o canal

### Como funciona

```sh
flightdeckd claude [argumentos do claude]
# sugestão: alias fd="flightdeckd claude"
```

`flightdeckd claude` (alias sugerido `fd`) abre o `claude` de verdade no mesmo terminal, com os
mesmos argumentos e o mesmo código de saída, e acrescenta o canal do Flightdeck. O canal é um
servidor MCP (`flightdeckd channel`) que deixa o app mandar mensagens para essa sessão como se
você as digitasse.

- **Argumentos:** o wrapper acrescenta `--mcp-config` (arquivo temporário) e
  `--dangerously-load-development-channels server:flightdeck` e define `FLIGHTDECK_LAUNCH_ID`. O
  `.mcp.json` do projeto não é tocado.
- **Config:** como os argumentos são todos do `claude`, a config do daemon vem de
  `FLIGHTDECK_CONFIG`, ou do caminho padrão.
- **Sem `claude` no PATH** (nem em `claude.executablePath`): avisa e sai.
- **Sem o daemon:** avisa e abre o `claude` assim mesmo, sem canal.
- **Com `-p` ou `--print`:** abre o `claude` normal, sem canal e sem aviso. O modo print ignora o
  canal de desenvolvimento.
- **Research preview:** o canal é um recurso de pré-visualização do Claude Code. Cada abertura
  mostra um aviso de canal de desenvolvimento, que precisa ser aceito.
- **Aviso conhecido:** na abertura, o Claude Code mostra
  `server:flightdeck · no MCP server configured with that name`, mesmo com o canal funcionando. O
  aviso é avaliado antes dos servidores do `--mcp-config` e pode ser ignorado.

| | `claude` puro | `flightdeckd claude` |
| --- | --- | --- |
| aparece na lista, com estado ao vivo | sim (com hooks) | sim (com hooks) |
| aprovar e negar pelo app | sim | sim |
| transcript ao vivo | sim | sim |
| mandar mensagem pelo app | não | sim (selo "controlável") |

### Por que a extensão do VS Code fica de fora

A extensão do Claude Code para VS Code e o app Claude Desktop rodam o `claude` em modo SDK, que
ignora o canal de desenvolvimento. Na prova de conceito, o canal subiu como MCP dentro da
extensão, mas nenhuma mensagem chegou. O terminal integrado do VS Code é um terminal comum: lá,
`flightdeckd claude` funciona.

## Aprovações e permitir sempre

Além de Aprovar e Negar, uma aprovação, de sessão gerenciada ou do terminal, oferece:

- **Permitir nesta sessão:** aparece quando o Claude Code sugere permissões de destino `session`,
  que só valem para aquela sessão.
- **Sempre neste projeto:** abre a regra para edição antes de mandar.
  - No Bash, o padrão é o comando exato, que você pode trocar por um prefixo como `npm test:*`.
  - Nas outras ferramentas, o padrão é o nome da ferramenta.
  - A regra vai para `<projeto>/.claude/settings.local.json`, o arquivo local, não versionado, do
    Claude Code.

O daemon só aceita uma das sugestões do próprio pedido (destinos `session` ou `localSettings`) ou
uma regra do projeto para a mesma ferramenta, com até 500 caracteres e sem quebra de linha.

- **Recusados:** `userSettings` (o `~/.claude/settings.json`), `projectSettings` (o
  `.claude/settings.json` versionado), `cliArg` e os modos `bypassPermissions` e `auto`.
- **Na recusa:** o app mostra o erro, e o pedido continua aberto.

Cards rodam em worktrees, e cada worktree tem o próprio `.claude`:

- uma regra aceita numa sessão de card (ou de uma etapa de workflow) também é gravada no
  `.claude/settings.local.json` da raiz do repositório, sem duplicar e sem tocar nas outras
  chaves;
- toda worktree nova recebe uma cópia do arquivo da raiz, a menos que o repositório o versione;
- `.claude/settings.local.json` entra no `.git/info/exclude` do repositório, então nunca aparece
  no diff de um card nem num commit.

Na tela Projetos, **Editar** mostra a seção **Regras** do projeto, com o botão de remover, que
pede confirmação e preserva o resto do arquivo.

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

### Ciclo do card

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

## Revisão de mudanças

Toda sessão (gerenciada ou do terminal) e todo card tem uma aba **Mudanças**, ao lado da conversa.
É onde você confere o que o agente fez e devolve a ele o que corrigir.

- **O que mostra:**
  - numa sessão cuja pasta está num repositório git, o working tree contra o `HEAD`, com os
    arquivos não rastreados;
  - num card, o diff contra a base, com quantos commits ele está à frente e atrás dela;
  - os arquivos com status e contagens, e o diff unificado ou lado a lado, com as linhas
    numeradas. Um arquivo binário aparece na lista, sem diff;
  - acompanha o disco ao vivo (o host observa a pasta, com debounce de 500 ms), e **Atualizar**
    lê de novo.
- **Comentários inline:**
  - clique no número de uma linha para comentá-la, e com shift em outra para estender o intervalo.
    Uma linha apagada é comentada pelo lado antigo;
  - os comentários ficam em rascunho, que dá para editar ou remover, até **Enviar revisão**;
  - a revisão vai para a sessão gerenciada, para a sessão do card ou para o canal de uma sessão do
    terminal aberta com `flightdeckd claude`. Uma sessão que não recebe mensagens ganha o texto
    copiado, e os comentários contam como enviados;
  - um comentário segue o trecho citado quando o arquivo muda, e mostra **Desatualizado** quando o
    trecho some. Os enviados continuam na lista como histórico.
- **Reverter e editar:**
  - **Reverter** pede confirmação, volta ao `HEAD` (ou à base do card; um arquivo novo é removido),
    guarda uma cópia em `<dataDir>/review-trash/` por 7 dias e oferece **Desfazer** por 30 s;
  - **Editar** abre um editor de texto simples (arquivos de texto até 1 MB). Só grava se o arquivo
    estiver como estava quando foi aberto; se mudou no disco, dá para recarregar o texto do disco
    ou sobrescrever com o seu;
  - os dois valem só nas pastas de `allowedRoots`; em qualquer outra, o host só lê.
- **Sessões que mexeram num arquivo:** cada arquivo lista as sessões que o escreveram, a partir dos
  transcripts (`Write`, `Edit`, `MultiEdit` e `NotebookEdit`; mudanças feitas pelo `Bash` não
  entram).
- **Card e a base:**
  - **Atualizar com a base** faz o rebase da branch do card. Com conflito, aborta, deixa a
    worktree como estava e lista os arquivos;
  - **Merge e arquivar**, para um card sem PR: `merge --no-ff` (o padrão) ou `squash`. Se a base
    está em checkout em alguma worktree (em geral o `main` do repositório principal), o merge é
    feito ali, e só se aquela worktree estiver limpa; senão, vai por uma worktree temporária. Um
    conflito recusa e não muda nada. Depois do merge, a worktree e a branch do card somem e o card
    vai para Concluído.
- **Comentários do PR:** num card com PR, os comentários de revisão são lidos do GitHub (`gh api`)
  ou do Azure DevOps (`az devops invoke`) a cada consulta do PR, e listados com arquivo, linha,
  autor e estado (resolvido ou não). No GitHub, quem não é dono, membro nem colaborador ganha o
  selo **Autor externo**: trate o texto como não confiável. O Azure DevOps não tem esse campo, e
  por isso nada é marcado ali. Os comentários abertos vêm selecionados; **Enviar ao agente** entrega
  os escolhidos à sessão do card. Nada é postado de volta no provedor.

O host anuncia `review` no `host.info`; um host mais antigo não tem a aba Mudanças.

### `.worktreeinclude`

Uma worktree nova recebe os arquivos rastreados do repositório, mas não os ignorados, como `.env`.
Para levá-los ao card, crie `.worktreeinclude` na raiz do repositório, com padrões no formato do
`.gitignore`:

```gitignore
.env
.env.local
config/*.secret.json
```

- **O que é copiado:** do repositório principal, os arquivos **ignorados pelo git** que casam com
  os padrões, até 50 MB no total. Acima disso, o card avisa quantos ficaram de fora.
- **O que nunca é copiado:** nada de `.git/` nem de `.flightdeck/`.
- **Padrão embutido:** `.claude/settings.local.json`, as regras do projeto da Fase 7, entra sempre.
- O formulário do projeto, no app, avisa quando o repositório não tem `.worktreeinclude`, com um
  exemplo.

### Statusline do Claude Code

`flightdeckd statusline` imprime uma linha como `5h 35% · 7d 27% · hoje $4.20 · sessão $0.84`: a
cota do plano, o custo estimado do dia e o custo da sessão. Ele lê o JSON que o Claude Code passa
no stdin e consulta o daemon local, com prazo de 300 ms. Com o daemon fora do ar ou lento, imprime
uma linha vazia e sai com 0.

O Flightdeck **nunca escreve** a configuração da statusline. Para usar o comando, ponha você mesmo
no `~/.claude/settings.json`:

```json
{ "statusLine": { "type": "command", "command": "flightdeckd statusline" } }
```

Para somar à statusline que você já tem, chame os dois num script e junte as linhas. O stdin vai
para os dois:

```bash
#!/usr/bin/env bash
input=$(cat)
mine=$(printf '%s' "$input" | ~/.claude/minha-statusline.sh)
fd=$(printf '%s' "$input" | flightdeckd statusline)
printf '%s%s\n' "$mine" "${fd:+ · $fd}"
```

O comando usa a config do daemon (`~/.flightdeck/config.json`, ou `--config <arquivo>`) e nunca a
cria.

## Workflows

Um card pode rodar um workflow em vez de uma sessão só: uma sequência de etapas (agentes,
verificações, aprovações suas), com orçamento, acompanhada e aprovada pelo app.

### Declarar

Os workflows são arquivos `.flightdeck/workflows/<nome>.yaml`, versionados no próprio
repositório. O daemon sempre os lê da branch base do projeto (`git show <base>:<caminho>`). Um
workflow escrito pelo agente na branch do card nunca é usado.

```yaml
name: feature
inputs: [task]
budget: { maxTurns: 80, maxMinutes: 120, maxCostUsd: 15 }
steps:
  - id: plan
    agent: { prompt: "Planeje: {{inputs.task}}", permissionMode: plan }
  - id: approve-plan
    gate: { message: "Aprovar o plano?", show: "{{steps.plan.output}}" }
  - id: implement
    agent: { prompt: "Implemente este plano e faça commits:\n{{steps.plan.output}}" }
  - id: tests
    loop:
      max: 3
      until: { check: "bun test" }
      do:
        agent: { continue: implement, prompt: "Os testes falharam:\n{{loop.lastCheck.output}}" }
  - id: review
    parallel:
      - agent: { prompt: "Revise o diff com foco em segurança." }
      - agent: { prompt: "Revise o diff com foco em legibilidade." }
  - id: pr
    pr: {}
```

| Etapa | O que faz |
| --- | --- |
| `agent` | Abre uma sessão na worktree do card. Com `continue: <id>`, manda a mensagem à sessão daquela etapa. A saída é o texto do assistente no turno. |
| `check` | Roda o comando na worktree. Guarda o código de retorno e os últimos 8 KB da saída. Se o comando falhar, a execução falha. |
| `gate` | Pausa até você aprovar ou recusar, com nota opcional. A nota é a saída do gate. |
| `loop` | Roda o `check` do `until`. Enquanto ele falhar, roda o `do` (no máximo `max` vezes). Esgotado o `max`, a execução pausa. |
| `parallel` | Roda os itens ao mesmo tempo, dentro de `maxParallelRuns`. As saídas chegam em `outputs`, na ordem declarada. |
| `pr` | Faz o push e abre o PR pelo provedor do projeto. |

A interpolação aceita só `{{inputs.*}}`, `{{steps.<id>.output}}` (`outputs` num `parallel`) e
`{{loop.lastCheck.output|exitCode}}`, este dentro do `do` de um loop. Uma referência
desconhecida, um campo desconhecido, uma etapa sem `id` ou um `continue` para uma etapa que não
é um `agent` anterior são erros de validação. Um valor interpolado maior que 8 KB é cortado.

### Confiar

As etapas `check` rodam comandos de shell: `cmd.exe /d /s /c` no Windows e `sh -c` nos demais,
como o script de preparação. Por isso, cada workflow precisa ser confiado antes da primeira
execução. Na tela Projetos, **Workflows de &lt;projeto&gt;** lista os workflows da base com a
validação e os comandos `check`. **Confiar** mostra esses comandos e pede confirmação.

- **O que fica guardado:** a confiança guarda o hash (sha256) do arquivo.
- **Se o arquivo mudar na base:** o hash muda, e o workflow volta a pedir confiança.
- **Antes de cada check:** o daemon confere que o comando está literalmente no workflow da
  execução e que esse conteúdo continua confiado. Qualquer outro comando é recusado sem chegar
  ao shell.

### Rodar e acompanhar

No detalhe do card, escolha o workflow (ou **Nenhum**, para o card simples), preencha os
`inputs` e clique em Iniciar.

- **Linha do tempo:** o detalhe mostra cada etapa com status, tentativa, duração e, num `agent`,
  os turnos e o custo estimado. Clicar abre a conversa da etapa ou a saída do `check`.
- **Gate aberto:** leva o card a Esperando você e libera a vaga do host. Ele aparece no próprio
  card e em **Precisa de você**, com Aprovar, Recusar e nota.
  - Aprovado, a execução volta à fila do host e segue.
  - Recusado, termina como `rejected`.
- **Etapa `pr`:** leva o card a Em revisão. O merge leva a Concluído e fecha as sessões das
  etapas.
- **Reinício do daemon:** a execução retoma de onde parou.
  - Um agent no meio do turno retoma a sessão e reenvia o prompt, precedido de "A execução foi
    interrompida; continue de onde parou."
  - Um check roda de novo.
  - Um gate continua aberto.

### Orçamento de uma execução

`budget` limita a execução inteira, somando todas as suas sessões:

- **Turnos:** contados entre todas as sessões.
- **Minutos:** o tempo de relógio dos turnos.
- **Custo:** o que o SDK informa (`total_cost_usd`). Em assinatura, é uma estimativa útil como
  teto.
  - O valor é cumulativo por sessão: vale o último total de cada sessão.
  - Uma sessão retomada conta só a diferença.

O orçamento é conferido antes de cada turno. Estourado, a execução pausa em Esperando você com
o motivo. Uma execução pausada não continua: inicie o card de novo. O medidor no detalhe do
card mostra turnos, minutos e custo estimado. (Não confundir com os [orçamentos em
US$](#orçamentos) de host e de projeto.)

### O servidor MCP flightdeckd mcp

`flightdeckd mcp [--config <arquivo>]` é um servidor MCP stdio para o Claude Code do mesmo host.
Ele lê a config do daemon e conecta no daemon local pelo protocolo, com o token da config. Isso
deixa uma sessão do Claude criar cards e disparar workflows. Ferramentas:

- `list_projects` e `list_workflows`;
- `create_card` e `start_card` (com `workflow` e `inputs`);
- `get_card` e `get_run`.

Não há ferramenta para aprovar permissões nem para responder gates: isso fica só com você, no
app. Para registrar no Claude Code:

```sh
claude mcp add flightdeck -- flightdeckd mcp
```

## Histórico

O daemon de cada host indexa os transcripts do Claude Code desse host, inclusive as sessões que
nasceram fora do Flightdeck (terminal, VS Code, Desktop). Os transcripts são só lidos: nada é
editado, apagado ou copiado entre hosts. A única escrita em `~/.claude` é a dos hooks, por
comando explícito (veja [Hooks do Claude Code](#hooks-do-claude-code)).

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
lista? [Reconstrua o índice](#reconstruir-o-índice): sessões já indexadas só saem, e arquivos já
excluídos só voltam, depois disso.

### Reconstruir o índice

```sh
flightdeckd history reindex [--config <arquivo>]
```

Apaga o índice de histórico e lê todos os transcripts de novo, imprimindo quantas sessões e
mensagens entraram. Pare o daemon antes: com outro processo no mesmo `dataDir`, o comando sai com
código 3.

### No app

- **Histórico por host** (🕘 ao lado do nome do host): sessões indexadas com título, pasta, data
  da última mensagem, origem (`Flightdeck` ou `terminal`) e o selo "possivelmente em uso";
  filtros por pasta, período (dias inteiros, em UTC) e origem.
- **Busca global** (`Ctrl+K` dentro do app, ou "Buscar no histórico"): é a última seção da
  [paleta](#paleta-ctrlk). Enter, sem nada escolhido, consulta todos os hosts online em paralelo
  e junta os acertos por data, com host, pasta e trecho destacado. Host offline, ou que não
  responde em 5 s, aparece como "sem resposta" sem travar o resto.
- **Leitor:** somente leitura, com o visual do chat, carregando páginas conforme a rolagem. Vindo
  da busca, abre no ponto do acerto; "Carregar anteriores" traz o começo.
- **Continuar no Flightdeck** transforma o transcript numa sessão gerenciada com `resume`. Se a
  sessão estiver possivelmente em uso, o app pede confirmação antes, porque dois processos
  escrevendo na mesma conversa a corrompem. **Copiar comando** copia `claude --resume <id>` para
  usar no terminal.
- **Atalho global:** veja [Atalho global](#atalho-global).

## Checkpoints e configuração do agente

Duas coisas da Fase 12: voltar no tempo dentro de uma sessão (a **linha do tempo**) e configurar o
agente de um projeto (a **tela Agente**). As duas precisam de um daemon que anuncie os recursos
`checkpoints` e `agentcfg` (0.12.0 ou mais novo); num daemon antigo os botões simplesmente não
aparecem.

### Snapshots

No começo e no fim de cada turno, quando a pasta da sessão está dentro de um repositório git, o
daemon tira um **snapshot**: uma cópia do HEAD mais todas as mudanças, com os arquivos não
rastreados e sem os ignorados. Ele é montado num índice temporário e guardado como um commit para o
qual só aponta `refs/flightdeck/snapshots/<sessão>/<n>`; o seu índice, os seus arquivos e o `git
status` não mudam, e nada aparece no `git log`.

- As sessões gerenciadas tiram os snapshots sozinhas. As sessões do terminal tiram pelos
  [hooks](#hooks-do-claude-code) (`UserPromptSubmit` antes do turno, `Stop` depois), então os hooks
  precisam estar instalados.
- Um turno que muda mais de 200 MB é pulado, com o motivo. Uma pasta fora de um repositório não tem
  snapshots.
- A manutenção diária guarda 50 snapshots por sessão e 30 dias, e apaga as refs que nada mais usa.

### A linha do tempo

O botão **Linha do tempo** no cabeçalho de uma sessão (gerenciada ou do terminal) abre um painel
lateral com os turnos, do mais antigo ao mais novo. Cada turno mostra o número, a hora local, o
prompt e se mudou arquivos: **Mudou arquivos**, **Sem mudança nos arquivos** ou **Em andamento**.
**Ver arquivos do turno N** lista os arquivos que o turno mudou, com o que aconteceu com cada um
(alterado, criado, apagado) e as linhas somadas e removidas.

### Voltar arquivos

**Voltar arquivos até aqui** devolve os arquivos do repositório ao que eram antes daquele turno.

1. Abre primeiro uma prévia: os arquivos que mudam, o que acontece com cada um (volta ao que era,
   será removido porque foi criado depois, será restaurado), as linhas, e por onde volta: pelo
   checkpoint do próprio Claude Code (sessão gerenciada viva) ou pelo snapshot git do turno.
2. Nada muda até você apertar **Voltar arquivos**.
3. Antes de voltar, o Flightdeck guarda o estado de agora. **Desfazer volta** (no painel) traz tudo
   de volta.

O botão fica desligado enquanto a sessão está num turno: pare a sessão antes. Os arquivos ignorados
pelo git nunca são tocados, e só voltam arquivos de dentro do repositório.

**O que voltar arquivos não faz.** Cobre arquivos, e só arquivos. Uma mudança de banco, uma chamada
de rede, um `git push` ou qualquer outro comando que agiu fora do repositório não é desfeito. O
checkpoint do próprio SDK não enxerga o que o `Bash` ou os subagentes mudaram, e é por isso que o
Flightdeck soma os snapshots git.

### Bifurcar

**Bifurcar daqui** cria uma conversa nova que começa naquele turno; a original continua como está.
Você escolhe onde abrir:

- **Abrir no Flightdeck:** uma sessão gerenciada nova, retomada na conversa nova.
- **Abrir no terminal:** a janela mostra o comando (`flightdeckd claude --resume <id>`) e o botão do
  terminal.

**Voltar os arquivos também** devolve os arquivos ao estado daquele turno antes de abrir a
bifurcação, com a mesma prévia de cima. Dá para desfazer depois, pela linha do tempo.

Numa sessão do terminal, o daemon acha a mensagem do turno no transcript pelo prompt. Quando não
tem certeza (o mesmo prompt dito mais vezes do que há turnos, ou o contrário, ou a mensagem ainda
não foi indexada), a bifurcação fica desligada naquele turno e o painel diz por quê.

A bifurcação é gravada pelo SDK como um transcript novo em `~/.claude/projects`, como qualquer
sessão do Claude Code: a única escrita ali que vem desta fase, e só quando você pede.

### A tela Agente

**Projetos → Agente de {projeto}** abre a configuração do projeto para o Claude Code, em quatro
abas. O Flightdeck escreve só arquivos do projeto, cada vez que você aperta o botão que nomeia o
arquivo; o `~/.claude` e o `~/.claude.json` do usuário aparecem **só para leitura**.

- **MCP:** os servidores do `.mcp.json` do projeto e os do usuário (`~/.claude.json`, o geral e o
  deste projeto), cada um com a sua origem. Dá para adicionar, editar e remover os do `.mcp.json`; a
  chave de ligar e desligar grava o `.claude/settings.local.json`. O `.mcp.json` é versionado, e a
  tela avisa. Os valores de `env` e `headers` aparecem mascarados: para salvar um servidor que os
  tem, digite de novo cada valor mascarado.
- **Testar** mostra o comando e os argumentos exatos (ou a URL) e pede confirmação antes de rodar
  qualquer coisa, porque um servidor stdio é um comando que veio do repositório. Depois sobe o
  servidor, lista as ferramentas e os recursos e o derruba (limite de 15 s). Abrir a lista nunca
  sobe um servidor.
- **CLAUDE.md, Agentes e Skills:** os arquivos do projeto (um `CLAUDE.md` em qualquer pasta, o
  `CLAUDE.local.md`, `.claude/agents/*.md`, `.claude/skills/<nome>/SKILL.md`) podem ser editados,
  com prévia; os do usuário são só leitura. Salvar compara o hash lido quando o arquivo foi aberto:
  se o arquivo mudou no disco, nada é sobrescrito, o que você digitou fica na tela e **Recarregar**
  traz a versão atual. Agentes e skills têm um formulário para o frontmatter (nome, descrição, e
  ferramentas e modelo num agente) e guardam todas as outras linhas do arquivo. **Novo agente**,
  **Nova skill** e **Novo CLAUDE.md** criam o arquivo no primeiro salvamento.
- Os arquivos do projeto que não são o `CLAUDE.local.md` são versionados: a tela avisa que salvar
  muda um arquivo do repositório.

## Issues, automações e arena

Três coisas da Fase 13, no board e na lista de projetos. Cada uma só aparece quando o daemon anuncia
o recurso (`issues`, `automation`, `arena`; daemon 0.13.0 ou mais novo). Com um daemon mais antigo, os
botões simplesmente não existem.

### Issues

O botão **Issues** no cabeçalho do board abre um painel lateral com as issues do projeto no GitHub
(pelo `gh`) ou no Azure Boards (pelo `az`). Antes, conecte um provedor pelo mesmo botão: **Conectar
issues** pergunta o provedor e uma busca opcional (em branco, as abertas atribuídas a você) e pode
permitir que o daemon comente na issue quando o PR abrir (desligado por padrão, porque escreve no
provedor).

- **Filtrar issues** reduz a lista por título, rótulo ou autor.
- **Criar card** faz um card no Backlog a partir da issue e guarda o link: a linha passa a oferecer
  **Abrir card**, o card mostra a issue (um botão que a abre no navegador) e um PR que fecha o card
  fecha a issue (`Fixes #n` ou `AB#id`).
- Uma issue de **Autor externo** vem marcada. O texto é conteúdo de terceiro: a aprovação automática do
  card fica suspensa até você reativá-la.
- Só endereços `http` e `https` são abertos.

### Automações

Em **Projetos**, cada projeto tem um botão **Automações** (num daemon que anuncia automação). A tela lista
as automações do projeto, cada uma com gatilho, ação, limite por dia, a marca **Aceita autores externos**
e um interruptor.

- **Nova automação** é um formulário guiado em três passos: gatilho (horário com cron e fuso, comentário
  novo no PR de um card, checks do PR de um card que falharam, ou issue nova com um rótulo), ação (iniciar um
  workflow, enviar o conteúdo do evento à sessão do card, ou criar um card a partir da issue; a lista só
  oferece as ações que combinam com o gatilho) e limite (nome, disparos por dia e se também age sobre
  autores externos, desligado por padrão).
- Uma automação **sempre nasce desligada**, também depois de editar. Ligar mostra antes o gatilho e a ação e
  pede **Ligar**; desligar não pede nada.
- O **Histórico** lista os disparos: Executou, Falhou, Ignorado, Pulado, Limite do dia ou Perdido (um horário
  que caiu com o daemon parado; é registrado, não recuperado).
- Um disparo que falha não repete sozinho, e as filas por cota e por orçamento continuam valendo.

### Arena

Num card que ainda não começou, **Iniciar em arena** roda o mesmo pedido em 2 a 4 **variantes**, cada uma com
o próprio modelo e esforço (em branco, o padrão do host), em worktree e branch próprias (`fd/<slug>-a`,
`-b`...). **Adicionar variante** e **Remover variante** mudam a contagem. Cada variante ocupa uma vaga do
limite de execuções em paralelo e espera na fila quando não há.

O card passa a mostrar a **Comparação da arena**: uma coluna por variante com modelo e esforço, estado,
duração, custo estimado, arquivos alterados e checks do workflow, e **Ver mudanças** para o diff da própria
variante. **Escolher a variante X** fica disponível quando a variante parou; pede confirmação, faz daquela
worktree a do card e para e remove as outras.

## Aprovação graduada por risco

Todo pedido de permissão leva um **selo de risco**, definido por uma lista fixa de regras no daemon (sem IA):
**Risco baixo** (leituras dentro do projeto), **Risco médio** (a maioria dos comandos, escritas dentro do
projeto, tudo que acessa a rede, ferramentas desconhecidas e MCP) e **Risco alto** (por exemplo `rm -rf`,
`git push --force`, `sudo`, substituição de comando, pipe para um shell ou qualquer acesso a caminhos de
credencial). Você pode acrescentar padrões na configuração do host (`risk.extraHigh`); os embutidos não
podem ser rebaixados.

- Um pedido de **Risco alto** fica vermelho e **Aprovar** vira **Segurar para aprovar**: segure o botão por
  2 segundos. A tecla A não o aprova; N continua negando.
- A bandeja nunca aprova um pedido de risco alto: só oferece **Abrir**.
- Com a aprovação automática ligada, o que ninguém aprovou à mão aparece na linha do tempo da sessão como
  "Aprovado automaticamente", com quem decidiu e o motivo. Um pedido de risco alto ou que acessa a rede
  sempre vem para você.
- Em um host cujo daemon tem a aprovação automática, a página do host tem o botão **Aprovações
  automáticas**. A tela lista o que o daemon decidiu, da mais nova para a mais antiga: a ferramenta, o
  risco, se **Aprovou** ou **Perguntou a você**, quem decidiu (a regra ou a IA e o modelo) e o motivo.
  Filtre por projeto, ou por ferramenta ou motivo em **Filtrar decisões**. **Sessões suspensas** lista as
  sessões em que a aprovação automática parou porque chegou conteúdo de terceiro, com o motivo;
  **Reativar** pede confirmação antes de ligar de novo.
- O texto da bandeja soma quantas aprovações automáticas o app viu.

## Conexões

**Conexões** (barra lateral, para hosts que guardam destinos SSH) lista os **destinos** cadastrados
no primeiro host online que os anuncia e abre cada um numa tela de terminal com o cliente OpenSSH
desse host. O Flightdeck não tem cliente SSH próprio: ele monta o comando `ssh` como uma lista de
argumentos, sem shell no meio, e nunca guarda uma senha nem uma chave, só a referência a uma (o
caminho de um arquivo de chave).

- **Conectar** confere antes a chave do servidor. Um servidor nunca visto mostra o **fingerprint
  SHA256** e espera **Confirmar chave do servidor**; só então o terminal abre. As conexões seguintes
  usam um arquivo known_hosts próprio do Flightdeck e exigem que a chave seja a mesma. Uma **chave
  trocada bloqueia a conexão** e mostra o fingerprint guardado e o novo; nada conecta até você abrir
  o destino e escolher **Esquecer chave do servidor**.
- **Novo destino**, **Editar**, **Duplicar** e **Remover** (com confirmação). Um destino tem nome,
  host, porta, usuário, autenticação (o **agente SSH** do host, ou um **arquivo de chave** pelo
  caminho), o host que o abre, um **salto** opcional (outro destino), etiquetas e uma lista curta e
  fixa de opções: segundos de keep-alive, compressão, encaminhamentos locais em texto e
  **ForwardAgent**, que vem desligado e pede confirmação para ligar.
- **Testar conexão** (no formulário de edição) roda o `ssh` sem terminal e diz "Conexão ok." ou o
  erro em palavras. Não cobre senhas.
- **Importar do SSH config** lê o `~/.ssh/config` do host (só leitura, nunca escreve), lista os
  nomes que achou, marca os já cadastrados e cria só os que você marcar. Entradas com curinga (`*`,
  `?`) são padrões para as outras, não destinos.
- **Busca** por nome, host ou usuário; filtro por etiqueta e pelo host que abre o destino. O
  **Ctrl+K** também oferece **Conectar a <nome>** para cada destino.
- A aba de terminal de um destino se chama "SSH · nome" e leva as etiquetas. Um destino com a
  etiqueta `prod` ou `produção` deixa essa **aba com borda vermelha**, para um servidor de produção
  não ser confundido com outro.

Um destino também pode usar a autenticação por **Senha**: quando o ssh pergunta, o app abre uma
janela com o campo mascarado (ou uma para a frase de uma chave). A resposta vai ao host uma vez,
nunca é guardada nem registrada, e **Cancelar** faz o ssh falhar na hora. Com o Cofre, a
autenticação por **Chave do cofre** escolhe uma chave SSH do cofre (e **Senha** pode apontar para
uma senha do cofre, que então responde ao ssh sem janela). A chave vai ao host que roda o ssh, no
comando de conexão e em mais nenhum lugar, só se o segredo estiver liberado para esse host e a
conexão for `localhost` ou Tailscale; cada uso aparece na aba **Uso** do cofre com a finalidade
`ssh`, pedido por **Você**.

Um destino com **host que o abre** diferente do que o guarda roda o ssh lá (por exemplo uma VPS,
para alcançar a rede interna dela): o Flightdeck guarda uma cópia do destino nesse host e avisa na
tela se o host está offline ou sem suporte a SSH.
## Cofre

O **Cofre** (barra lateral) guarda segredos: chaves SSH, senhas, tokens e conjuntos de variáveis de
ambiente. O **valor** de um segredo fica no cofre de credenciais do sistema (Gerenciador de
Credenciais do Windows), nunca nos arquivos do app e nunca em um log. A lista da tela guarda só o
nome, o tipo, as etiquetas e uma descrição do segredo.

- **Novo segredo** pede nome, tipo, valor e etiquetas. **Gerar chave SSH** cria um par `ed25519`
  com o `ssh-keygen` deste computador, guarda a chave privada no cofre, apaga o arquivo temporário
  e mostra a chave pública, pronta para **Copiar chave pública**. **Importar arquivo de chave** lê
  um arquivo que você escolhe no diálogo do sistema; o original fica onde está, a menos que você
  marque **Apagar o arquivo original depois de importar**.
- Cada linha mostra só o que é seguro mostrar: a impressão digital da chave pública, o começo e o
  fim de um token (`ghp_…WXYZ`, e nada para um token curto) ou os nomes de um conjunto de
  variáveis. Uma senha não mostra nada.
- **Revelar** pede que você digite a palavra `revelar` e então mostra o valor por 10 segundos.
  **Copiar** coloca o valor na área de transferência e a limpa 30 segundos depois. **Remover** pede
  que você digite o nome do segredo e apaga também o valor do cofre do sistema.
- **Uso** é o registro de cada pedido feito ao cofre: o segredo, o host, a finalidade, quem pediu
  (você, o Claude, uma automação ou um workflow) e o resultado (entregue, negado ou usado). Ele
  nunca guarda um valor. Filtre por segredo ou por quem pediu.
- **Backup** exporta o cofre para um arquivo `cofre.fdvault`, cifrado com a frase-senha que você
  digitar (pelo menos 12 caracteres, confirmada duas vezes). **Importar cofre** lê esse arquivo com
  a frase-senha e mostra uma prévia dos segredos **Novos**, **Iguais** e **Conflitantes** antes de
  mudar qualquer coisa; um conflito mantém o que está no cofre, a menos que você escolha
  **Substituir pelo backup**. Uma frase-senha errada e um arquivo alterado são recusados.

Um segredo só chega a um daemon quando o app o envia, só para um host da lista de hosts permitidos
do segredo e só por `localhost` ou Tailscale; o daemon o guarda na memória por no máximo 60
segundos. Nesta versão nenhuma função do daemon pede segredos ainda, então todo pedido vindo de um
daemon é negado.
## Ações: o Claude usa um segredo sem vê-lo

Uma **ação** é um comando que você declara, com lugares para segredos do cofre e para parâmetros.
O Claude a chama pelo nome e só escolhe os parâmetros que você permitiu. O daemon aplica o segredo
do lado dele e entrega ao Claude o código de saída e a saída (até 32 KB) com o segredo mascarado
como `•••(nome)`. As ações precisam do cofre (um segredo guardado no app) e de um daemon que as
tenha: o botão **Ações de <projeto>** só aparece nesse caso.

```yaml
# .flightdeck/actions.yaml (versionado, sem segredos) ou a tela Ações do projeto
- name: deploy-staging
  description: Faz o deploy da branch na VPS de staging
  run: ["./scripts/deploy.sh", "{{param.branch}}"]
  cwd: /srv/app
  env:
    DEPLOY_TOKEN: "{{secret.deploy-token-staging}}"
  params:
    branch: { pattern: "^[a-zA-Z0-9._/-]{1,80}$", default: main }
  timeoutS: 600
  approval: first-per-session   # always | never | first-per-session
```

- `run` é uma lista de argumentos e nunca passa por shell. O segredo vai só para o `env` ou para um
  arquivo temporário (`{{secretFile.x}}`, apagado depois), nunca para um argumento, porque
  argumento aparece na lista de processos.
- Cada parâmetro precisa casar o `pattern` inteiro, e um `{{param.*}}` não pode ocupar a posição de
  código de um interpretador (depois de `-c`, `-e`, `/c`, `-Command`, `-EncodedCommand` ou `eval`).
- `ssh: <destino>` roda a ação no destino SSH (Fase 15) com esse nome, onde o Claude não tem shell.
  O comando chega com cada palavra entre aspas e o ambiente vai pela entrada padrão; um destino que
  entra com uma chave do cofre a recebe só para aquela execução. Um destino com senha não roda
  ações.
- `approval` vale `first-per-session` por padrão para uma ação com segredo e `never` para uma sem.

### A tela Ações

- Cada ação mostra a descrição, onde roda (este host, um host nomeado ou um destino SSH), como pede
  aprovação, os segredos e os parâmetros que usa, e se foi **Criada no app** ou é **Versionada**. Os
  problemas do `.flightdeck/actions.yaml` aparecem acima (as ações válidas continuam carregando).
- **Confiança.** Uma ação criada no app já nasce confiada. Uma versionada mostra **Não confiada**
  até você apertar **Confiar em <nome>** e confirmar; a confirmação mostra o que ela executa. A
  confiança fixa a declaração e o sha256 do `run[0]` e de cada arquivo do argv que está dentro de
  um repositório git, e o daemon confere de novo logo antes de cada execução. Se algum mudou, a ação
  mostra **Mudou desde que foi confiada** com o que mudou, e só roda de novo depois que você
  confiar outra vez.
- **Nova ação** abre um formulário: o nome, uma descrição, o comando com um argumento por linha,
  um destino SSH, a pasta, o tempo limite e a aprovação (opcionais), as variáveis de ambiente que
  recebem um segredo do cofre (o seletor mostra nomes e tags, nunca um valor) e os parâmetros com
  o padrão e o valor inicial. O daemon confere, e o que ele recusa aparece no formulário. **Editar**
  e **Remover** (que pergunta antes) ficam nas ações criadas no app; uma ação versionada muda no
  arquivo dela.
- **Aviso de produção.** Uma ação que roda neste host com um segredo de tag `prod` avisa na linha
  dela: uma sessão do Claude com Bash neste host poderia ler o segredo enquanto ela roda. Prefira
  uma ação `ssh:` para ele.
- **Execuções.** **Execuções de <nome>** abre o histórico, da mais nova para a mais antiga:
  quando, quem pediu (Você, Claude, Automação ou Workflow), o código de saída, a duração e a saída,
  já mascarada pelo daemon.

### Aprovar um pedido

Quando o Claude, uma automação ou um workflow roda uma ação que precisa de um segredo, o pedido
aparece em **Precisa de você** com uma notificação: quem pediu, a ação e os parâmetros (ou o
comando, os segredos e o host). **Aprovar** entrega o segredo só para aquela execução; **Negar**
faz a execução falhar na hora. Uma ação com `approval: never` roda sem pergunta, `first-per-session`
pergunta uma vez e fica lembrada até o app reiniciar, e `always` pergunta todas as vezes. Um
`run_with_secret` é de risco alto: segure o botão por 2 segundos para aprovar, e a bandeja só o
abre.

### Como o Claude chama uma ação

- **MCP (`flightdeckd mcp`):** `list_actions` (nome, descrição e parâmetros, nunca segredos),
  `run_action { name, params }` e `run_with_secret { command, secrets, host }`. A última é um
  comando escrito pelo próprio Claude, com os segredos no ambiente: **sempre** pede a sua
  aprovação, com o comando, os nomes dos segredos e o host, e nunca é automática, nem com a
  aprovação automática. Não existe "permitir sempre" aqui.
- **O mod `flightdeck-actions`** (`mods/flightdeck-actions`, instale com `/plugin install`)
  registra as mesmas duas ferramentas para sessões do terminal sem o MCP, mostra uma faixa "ação
  rodando" e o comando `/flightdeck-actions`.
- **A máscara** troca o valor entregue, cada linha de um valor de várias linhas e as formas dele em
  base64, URL-encode e hex. Um segredo transformado de outro jeito (um hash, um corte no meio) não
  é pego; por isso a ação declarada é o caminho seguro, e o comando livre não.

### O limite: o mesmo usuário do sistema

A garantia é que o segredo nunca chega ao transcript nem ao contexto do modelo pelo Flightdeck. Não
é isolamento contra um processo hostil do mesmo usuário: enquanto a ação roda, o ambiente dela
(`/proc/<pid>/environ` no Linux) e o arquivo temporário podem ser lidos por outro processo do mesmo
usuário do sistema operacional, e uma sessão do Claude com Bash no **mesmo host** consegue lê-los.
Segredos de produção ficam em ações `ssh:`.

Num terminal, uma ação sai mascarada quando roda por `flightdeckd action run` (o que o mod
`flightdeck-actions` usa): o que ela imprime é o resultado já mascarado pelo daemon. O resto do que
um terminal mostra não é mascarado.

## Snippets

**Snippets** são comandos e prompts salvos. A tela **Snippets** (barra lateral, para hosts que os
guardam) mostra os snippets do host; escolha um **Projeto** para somar os dele e os do
`.flightdeck/snippets.yaml` versionado, ou **Globais (deste app)** para os guardados no app.

- **Novo snippet**: nome, tipo (**Comando**, uma linha, ou **Prompt**), o texto, etiquetas e onde
  guardar (no host, no projeto, no arquivo versionado do projeto ou no app). Escreva `{{nome}}`
  para um valor pedido na hora de usar; o editor mostra os campos enquanto você digita, e cada um
  pode ter um padrão e uma lista de opções. `{{cwd}}`, `{{branch}}`, `{{file}}` e `{{selection}}`
  vêm de onde o snippet é usado.
- Um snippet nunca leva segredo: um com segredo é recusado com o motivo, e **Transformar em ação**
  abre as Ações do projeto com uma ação nova preenchida: o comando sem o segredo e uma variável de
  ambiente para ele, cujo segredo do cofre você escolhe.
- O arquivo versionado é compartilhado pelo repositório. Até você **Confiar no arquivo**, os
  comandos dele só colam, sem rodar; mudar o arquivo tira a confiança. As entradas que o app não
  consegue ler aparecem com o motivo.
- **Importar do histórico do shell** lista os comandos dos históricos de bash, zsh e PowerShell do
  host, os mais usados primeiro (só leitura). Uma linha com token, chave, senha ou um valor do cofre
  fica oculta e não pode ser importada; **Revelar linhas ocultas** mostra só as que os padrões
  acharam, ainda travadas. As linhas marcadas vão para os snippets do host ou do app, nunca para o
  arquivo versionado.
- **Importar de arquivo** lê uma lista de snippets em YAML ou JSON (o formato do arquivo versionado), mostra o que achou e o que deixou de fora e guarda os snippets no host ou no app.
- Os favoritos (a estrela) vêm primeiro, depois os usados mais recentemente. **Usar** numa linha abre o snippet para preencher e usar.

Para usar:

- **Ctrl+K**: **Snippet: <nome>** (a busca também olha etiquetas e conteúdo) abre o snippet com os
  campos. Um comando **cola no terminal** da tela (com ou sem **Enter**) ou **roda numa aba nova**
  na pasta que você der; um prompt é **enviado à sessão** da tela (gerenciada ou do terminal em que se pode escrever) ou abre uma **Nova sessão com este prompt**. **Copiar** vale para os dois.
- Numa aba de terminal, **Ctrl+Shift+Espaço** lista os snippets de comando daquele host e do app.
- Na caixa de mensagem de uma sessão, **/** lista os snippets de prompt; o escolhido entra na
  caixa preenchido com a pasta da sessão, ou como está escrito quando falta um valor.
- O Claude lê snippets pelas ferramentas `list_snippets` e `get_snippet` do MCP do Flightdeck. O
  Flightdeck nunca roda um snippet pelo Claude: um comando que o Claude roda passa pelas permissões
  do próprio Claude Code.

## Custos, orçamentos e cota

### Cota do plano

Cada turno de uma sessão gerenciada traz a cota do plano do Claude. Todas as sessões de um host
usam o mesmo login, então a cota é do host. O daemon guarda a última leitura de cada janela (5
horas, 7 dias e as outras que vierem), e a leitura deixa de valer quando a janela reinicia.

- **No app:** o topo da tela Sessões mostra, para cada host online, as barras de 5 horas e de 7
  dias, com a porcentagem, a hora de reinício e a idade da leitura ("lida há 12 min").
  - A barra fica vermelha a partir de `quota.pauseAt`.
  - Cruzar o `pauseAt` gera uma notificação, uma vez por janela.
- **Só terminal:** os hooks não trazem a cota. Quem usa só sessões do terminal vê barras vazias ou
  antigas até rodar um card ou uma sessão gerenciada no host.

### Fila por cota

```json
{ "quota": { "pauseAt": 0.9 } }
```

Enquanto alguma janela válida está em `pauseAt` ou acima (ou foi recusada pelo plano):

- um card iniciado entra na fila com o selo "aguardando cota até HH:MM" e começa sozinho quando a
  janela reinicia;
- um workflow em andamento espera antes do próximo turno de agente, no mesmo ponto em que confere
  o orçamento;
- sessões manuais não são bloqueadas; o app só mostra o aviso.

`"pauseAt": null` desliga a fila por cota.

### Uso

A tela do host mostra os últimos 7 dias de uso, por dia (no fuso do host) e por projeto. Num
host da Fase 8 em diante (que anuncia `costs`), o painel lê os custos de todas as sessões (veja
[Custos](#custos)). Num host da Fase 7, mostra o uso das sessões gerenciadas: custo estimado,
tokens e turnos.

- **Custo:** é a diferença do total que o SDK informa para cada sessão, nunca a soma turno a
  turno.
- **Projeto:** o mesmo da tela Sessões (o remoto `origin`, ou o caminho do repositório).
- **Fora do uso:** as sessões do terminal, porque os hooks não trazem custo.

### Custos

A tela **Custos**, no menu lateral, mostra o custo de todas as sessões de um host: do terminal,
do app, dos cards e dos workflows, subagentes incluídos.

> **Estimativa:** o valor é o equivalente em preços de API, estimado. Numa assinatura do Claude,
> nada disso é cobrado.

- **Fonte:** os transcripts do Claude Code em `~/.claude/projects`, os mesmos do histórico.
  - Cada mensagem conta uma vez, mesmo quando o transcript a repete em várias linhas.
  - No primeiro boot desta versão, o daemon lê em segundo plano os transcripts que já existem e
    continua respondendo enquanto isso.
- **Período:** hoje, 7 dias, 30 dias, mês atual ou um intervalo, sempre no fuso do host.
- **Filtros:** host, projeto, modelo e origem (terminal, app, card, workflow, subagent).
- **O que aparece:**
  - o custo estimado, os tokens e a economia do cache (quanto o cache read custou a menos do que
    o mesmo volume como input normal);
  - um gráfico por dia, empilhado por projeto, e as quebras por projeto, modelo e origem;
  - as sessões mais caras, e clicar numa abre a sessão;
  - o custo estimado também aparece na lista de sessões, na sessão aberta, no card e na execução
    de workflow.
- **Exportar CSV:** salva, pelo diálogo do sistema, uma linha por dia, projeto, modelo e origem.
- **Avisos:**
  - modelos sem preço aparecem como "sem preço", com o nome;
  - nas sessões gerenciadas, o daemon compara o custo calculado com o que o próprio Claude Code
    informa, e se a diferença passa de 10% (e de US$ 0,05), a tela avisa que a tabela de preços
    pode estar desatualizada.
- **Retenção:** o uso fica `retention.usageDays` dias (padrão 400).
- **Ir para Custos** na [paleta](#paleta-ctrlk) aparece quando o app tem a tela de Custos e algum
  host anuncia `costs`.

### Preços

A tabela padrão é a de preços de API de 06/10/2026, em US$ por milhão de tokens:

| Modelo | Input | Output | Cache read |
| --- | --- | --- | --- |
| `claude-fable-5-1` | 10,00 | 50,00 | 0,25 |
| `claude-opus-5-5` | 4,00 | 20,00 | 0,20 |
| `claude-sonnet-5-5` | 2,00 | 10,00 | 0,20 |
| `claude-haiku-5-5` | 0,10 | 0,50 | 0,01 |

- **Escrita de cache:** 1,25× o input no cache de 5 minutos e 2× no de 1 hora, que é o que o
  Claude Code usa.
- **Haiku 5.5:** passa a 0,50 e 2,50 acima de 100 mil tokens de prompt.
- **Fast mode:** o do Opus 5.5 custa 2×.

Para sobrescrever, use `pricing` na config, modelo a modelo:

```json
{
  "pricing": {
    "models": {
      "claude-opus-5-5": { "input": 4, "output": 20, "cacheRead": 0.2 },
      "claude-haiku-5-5": {
        "input": 0.1, "output": 0.5, "cacheRead": 0.01,
        "tiers": [{ "abovePromptTokens": 100000, "input": 0.5, "output": 2.5 }]
      }
    },
    "cacheWrite5mMultiplier": 1.25,
    "cacheWrite1hMultiplier": 2,
    "fastMultiplier": { "claude-opus-5-5": 2 }
  }
}
```

- **O que muda:** um modelo na config substitui o padrão daquele modelo. Os modelos que não
  aparecem ficam com o padrão.
- **Recalcular:** o comando `costs.reprice` relê a config e recalcula o custo de todas as
  entradas. Não precisa reiniciar o daemon.

### Orçamentos

Em **Configurações**, cada host com custos tem a seção **Orçamentos**:

- **Configuração:** cada orçamento é do host ou de um projeto (a chave de projeto da tela
  Sessões), por dia ou por mês, no fuso do host, com um limite em US$.
- **O que conta:** o custo estimado de todas as origens. A lista mostra quanto já foi gasto no
  período e o percentual.
- **Alertas:** em 50%, 80% e 100%, uma vez por período cada, como notificação do sistema e na
  faixa "Precisa de você".
- **Ação:**
  - **notificar:** só os alertas;
  - **segurar cards novos:** em 100%, os cards novos daquele escopo esperam na fila com o
    motivo `budget`. Eles saem sozinhos no período seguinte ou quando o limite sobe.
  - Sessões do terminal e sessões manuais nunca são seguradas.

### Histórico da cota

Toda leitura da cota de uma sessão gerenciada fica guardada por 30 dias. Leituras iguais em menos
de 5 minutos viram uma só.

- **Na tela Custos:** a seção **Cota** mostra as janelas de 5 horas e de 7 dias ao longo do tempo.
- **Projeção:** com pelo menos 3 leituras da janela atual:
  - "no ritmo atual, a janela de 5 h esgota às HH:MM";
  - ou "não esgota antes de HH:MM", quando o ritmo não chega a 100% antes do reinício.
- **Tooltip:** as barras do topo da tela Sessões mostram a mesma projeção.
- **Quem consumiu a janela:** a fatia de cada projeto no custo estimado desde o início da janela
  de 5 horas atual. É uma atribuição aproximada, porque o plano não diz quem usou a cota.

## Abas e terminal embutido

### Abas

Toda tela abre numa aba, como num navegador. Cada aba tem o próprio histórico de voltar e avançar.

- **Abrir:** o clique normal troca a aba atual. `Ctrl+clique`, o botão do meio do mouse ou **Abrir
  em nova aba** (no menu do host e no menu de uma linha de sessão) abre uma nova. O botão **+** no
  fim da barra abre uma aba nova na paleta `Ctrl+K`.
- **A barra:** cada aba mostra o ícone do tipo e o título, e um selo quando uma sessão nela
  precisa de você, está rodando ou respondeu sem nenhuma aba mostrando (**Não lida**). **Fixar**
  deixa a aba à esquerda, só com o ícone. Os botões de fixar, mover e fechar, depois das abas,
  agem na aba ativa; o botão do meio fecha qualquer aba. Arraste uma aba sobre outra para reordenar.
- **Atalhos:**

  | Atalho | Ação |
  | --- | --- |
  | `Ctrl+T` | aba nova, na paleta |
  | `Ctrl+W` | fecha a aba |
  | `Ctrl+Shift+T` | reabre a última fechada (guarda as últimas 20) |
  | `Ctrl+Tab` / `Ctrl+Shift+Tab` | próxima e anterior |
  | `Ctrl+1`…`Ctrl+9` | vai para aquela aba (`Ctrl+9` é a última) |
  | `Ctrl+Shift+PageUp` / `PageDown` | move a aba para a esquerda ou a direita |
  | `Ctrl+\` | divide a tela ou junta as áreas |

  Na entrada web do demo, o Chromium fica com `Ctrl+T`, `Ctrl+W` e `Ctrl+Shift+T`: lá, use os
  botões.
- **Guardadas entre aberturas:** as abas, quais estão fixas, a aba ativa, a divisão e o divisor
  voltam quando o app abre de novo. Cada aba volta na sua tela, sem o histórico. O formulário de
  host nunca é guardado, porque pode ter um token. A aba de um host que ainda não conectou mostra
  **Conectando a <host>…** até conectar.

### Tela dividida

`Ctrl+\` ou **Dividir a tela** (no fim da primeira barra de abas) divide a janela em duas áreas,
lado a lado; **Dividir na horizontal** as empilha, e **Juntar as áreas** devolve todas as abas a
uma só. Cada área tem a sua barra de abas.

- A área nova começa na tela da aba ativa.
- Um clique numa área a deixa em foco: o que você abre pela barra lateral, pela paleta ou por um
  link vai para ela.
- Arraste o divisor, ou dê foco a ele e use as setas, para dar a uma área de 20% a 80% da janela.
- **Mover a aba para a outra área** leva a aba para o outro lado; a área que fica vazia fecha.

### Terminal embutido

O daemon a partir da versão 0.14 abre terminais de verdade (um PTY) no host, e o app os mostra
numa aba, sem SSH.

- **Ligado ou desligado:** um terminal é um shell completo no host, com o usuário do daemon. Ele
  vem ligado só quando o daemon escuta em loopback; com `bind` aberto a outras redes, vem
  desligado. O painel **Terminal** da página do host liga (pergunta antes) ou desliga (encerra os
  terminais abertos); o daemon grava a escolha em `terminal.enabled` da config.
- **Abrir:** **Novo terminal** na página do host, ou **Novo terminal em <host>** na paleta, abre o
  shell padrão do host (`pwsh` ou `powershell` no Windows; `$SHELL`, `bash` ou `sh` no Linux) na
  primeira pasta permitida. O painel também lista os terminais vivos, cada um com **Abrir**.
- **Na aba:** copiar e colar com `Ctrl+Shift+C` / `Ctrl+Shift+V` ou com o menu **Copiar** /
  **Colar** do botão direito (`Ctrl+C` vai para o processo),
  buscar com `Ctrl+Shift+F` (Enter para a próxima, Shift+Enter para a anterior, Esc fecha). Links
  abrem no navegador. A fonte é a monoespaçada do sistema; o tamanho fica nas Configurações
  (**Tamanho da fonte do terminal**, de 10 a 24).
- **Desanexar e reabrir:** o terminal sobrevive ao app: guarda os últimos 2 MB de saída, e anexar
  de novo os mostra. Fechar a aba de um terminal pergunta: **Desanexar** (o padrão; o processo
  continua no host) ou **Encerrar processo**. Um terminal desanexado ou encerrado tem **Reabrir**.
- **Limites:** 10 terminais vivos por host (`terminal.max`), e um terminal sem ninguém anexado é
  encerrado depois de 120 minutos (`terminal.idleMinutes`). Os terminais não sobrevivem a
  reiniciar ou atualizar o daemon. O conteúdo nunca vai para o log nem para o banco.

### Claude aqui

Com os terminais do host ligados, todo botão **Abrir no terminal** (sessão, card, projeto,
checkpoint) ganha um companheiro:

- **Abrir Claude aqui (terminal)** abre o `flightdeckd claude` na pasta (a worktree, num card)
  numa aba de terminal. A sessão nasce na central, controlável: você aprova e manda mensagens pelo
  app enquanto vê o terminal.
- **Continuar no terminal** retoma uma sessão com `flightdeckd claude --resume <id>`; as sessões
  do terminal encerradas e as do histórico o têm no leitor.
- A aba de terminal dessa sessão tem **Ver como sessão**, e a sessão tem **Ver terminal**: as duas
  são o mesmo Claude, ligadas pelo id do lançamento.

O terminal de fora ([Abrir no terminal](#abrir-no-terminal)) continua ao lado.

## Uso diário

### Precisa de você, página do host e notificações

- **Precisa de você:** na barra lateral, com o contador de pedidos abertos em todos os hosts. A
  tela lista os pedidos, do mais antigo ao mais novo, e o cartão do pedido escolhido fica ao
  lado: **A** aprova, **N** nega e **Esc** fecha o detalhe. **Abrir sessão** leva à conversa.
- **Página do host:** clique no nome do host para ver sistema, versões, sessões ativas, latência
  do heartbeat, renomear, reconectar e remover. Um host que repassa a chave de API ao Claude
  ganha um selo ⚠.
- **Notificações** trazem o nome do host.
- **Fechar a janela** manda o app para a bandeja (desligável em Configurações). **Iniciar com o
  Windows** fica em Configurações, desligado por padrão.
- **Instância única:** abrir o app de novo (ou um link `flightdeck://`) foca a janela existente.

### Bandeja

O ícone da bandeja tem Abrir, o submenu **Precisa de você (N)** e Sair. O submenu lista até 10
pedidos abertos, de sessões gerenciadas e do terminal, do mais antigo ao mais novo, no formato
`host · sessão · ferramenta: resumo da entrada` (por exemplo `pc · api · Bash: npm test`).

- Cada pedido abre um submenu com **Aprovar**, **Negar** e **Abrir**. Aprovar e Negar respondem no
  host do pedido, sem abrir a janela; Abrir traz o app na sessão, com o card de aprovação.
- Gates de workflow aparecem só com **Abrir**: eles pedem leitura, e a resposta fica no card.
- Acima de 10, a última linha é **e mais N…**, que abre o app.
- O submenu é refeito meio segundo depois de a lista parar de mudar.
- **Notificação de pedido:** leva o link `flightdeck://request?host=…&request=…`, que abre o app
  focado no pedido. No app desktop, o plugin de notificação do Tauri não informa cliques no
  Windows nem no Linux: lá, a bandeja é o caminho rápido. Abrir o link por fora (por exemplo,
  `start flightdeck://request?...`) funciona.

### Abrir no terminal

O botão **Abrir no terminal** aparece na sessão (gerenciada e do terminal), no card (a worktree
dele) e em cada projeto da tela Projetos. A sessão é retomada com
`flightdeckd claude --resume <id>`, e o projeto abre um `claude` novo na pasta.

| Host | O que roda |
| --- | --- |
| Este Windows (daemon em `127.0.0.1`) | `wt.exe -d <pasta> <flightdeckd> claude --resume <id>`; sem o Windows Terminal, `cmd.exe /c start "" /d <pasta> cmd /k <flightdeckd> claude …` |
| WSL supervisionado (daemon Linux em `127.0.0.1` dentro de uma distro) | `wt.exe wsl.exe -d <distro> --cd <pasta> -- <flightdeckd> claude …` (sem o Windows Terminal, pelo `cmd /c start`) |
| Qualquer outro | o botão vira **Copiar comando**: `cd <pasta> && <flightdeckd> claude --resume <id>` |

- `<flightdeckd>` é o binário estável (`~/.flightdeck/bin/flightdeckd`, da
  [atualização](#atualizar-com-flightdeckd-update)) quando ele existe no host, senão
  `flightdeckd` do PATH. O daemon informa os dois, e a distro do WSL, no `host.info`.
- O comando sai da casca Rust do app, com os argumentos em lista, sem passar por shell, a não ser
  o `cmd /k` do fallback. Ela só aceita `wt.exe` e `cmd.exe`.

### Paleta Ctrl+K

`Ctrl+K` (ou "Buscar no histórico", na barra lateral) abre uma paleta com seções nesta ordem:
**Sessões ao vivo**, **Cards**, **Projetos**, **Hosts**, **Ações** (Nova sessão em…, Ir para
Configurações) e, depois de Enter, **Histórico**.

- O que é local aparece na hora e filtra enquanto você digita. Enter sem nada escolhido busca no
  histórico de todos os hosts, que chega depois, sem apagar o resto.
- **↑/↓** escolhem, **Enter** abre e **Tab** mostra as ações da entrada (por exemplo, num projeto:
  Abrir board, Workflows, Abrir no terminal). Esc volta das ações para a lista e, dali, fecha.
- **Ir para Custos** aparece quando o app tem a tela de Custos e algum host anuncia `costs`.

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

## Interface

### Desenho e navegação

O app segue um desenho só, no estilo do Linear: Inter embutida (sem rede), base de 13 px,
superfícies em camadas, um único token de destaque e o estado das sessões como um pontinho de
8 px (rodando em azul, precisa de você em âmbar, ociosa em cinza, encerrada esmaecida, erro em
vermelho).

- **Barra lateral:** logo, navegação (Sessões, Precisa de você com o contador, Board, Workflows,
  Custos, Histórico), os hosts, as sessões fixadas e, no rodapé, a busca (`Ctrl K`),
  Configurações e o tema. Recolhe para um trilho de ícones de 56 px, sozinha abaixo de 960 px.
- **Três colunas** em Sessões, Precisa de você e Histórico: a lista à esquerda (largura
  ajustável e guardada), a sessão, o pedido ou a transcrição à direita. Board, Custos,
  Configurações e as páginas do host usam a largura toda. O cabeçalho mostra o caminho
  (Sessões > sessão, Histórico > host, Board > projeto > card).
- **Teclado:** `J` e `K` movem pela lista, `Enter` abre, `Esc` fecha o detalhe, `A` e `N`
  aprovam e negam, `Ctrl K` abre a paleta, `Alt+←` e `Alt+→` voltam e avançam.
- **Densidade:** linhas compactas (32 px, o padrão) ou confortáveis (40 px), em Configurações.
- **Tema:** Claro, Escuro e Sistema (o padrão), em Configurações, na barra lateral e na paleta.
  A escolha fica guardada.
- **Idioma:** o do sistema (`pt-BR` para qualquer `pt-*`, `en` para o resto), trocado em
  Configurações ou na paleta, sem reiniciar. Datas e horas saem sempre em hora local. O
  vocabulário está em [`docs/GLOSSARY.md`](../GLOSSARY.md).
- **Modos de permissão** aparecem com nome e uma linha de explicação, nunca com o valor técnico;
  o "Sem perguntas" avisa em vermelho.

### Modo demonstração, prints e testes de ponta a ponta

```bash
bun run demo         # sobe dois hosts de mentira (runtime fake, dados semeados) e a entrada web
                     # do app já pareada, em http://localhost:1420
bun run demo:shots   # os prints das telas, nos 2 temas e nos 2 idiomas, em
                     # apps/desktop/screenshots/ (e o axe-core, que reprova serious e critical)
bun run e2e          # as cinco jornadas num navegador de verdade, nos 2 idiomas, e a conferência
                     # do layout a 1280x800 e a 800x600
```

Nada sai da máquina e nenhum dado real é usado. Os scripts usam o Chrome instalado (ou o Edge)
pelo `playwright-core`; no CI, o job `screenshots` roda os três e publica os prints.

## Operação do host

### Versões e compatibilidade

- **Uma versão só:** o app, o daemon e o protocolo saem com a mesma versão (0.14.0 nesta
  documentação). `flightdeckd --version` imprime `flightdeckd <versão> (protocolo 1)`.
- **No app:** a página do host mostra a versão do daemon, a do app e a do `claude`. Um daemon de
  outra versão ganha o selo **≠** ("versão diferente") na barra lateral: funciona, mas atualize
  quando puder.
- **Protocolo:** o app manda a versão de protocolo dele no `hello`. Se o daemon não a aceita, o
  host fica **incompatível: atualize o daemon**, com o comando na página do host. Ele não tenta
  reconectar e sai das listas (sessões, busca) até ser atualizado e reconectado.
- **Recursos:** o `host.info` anuncia o que o daemon tem (`central`, `workflows`,
  `maintenance`…), e o app esconde o que o host não anuncia. Um daemon anterior à Fase 7 não
  anuncia nada e continua aparecendo como antes, sem a seção Manutenção.

### Atualizar com flightdeckd update

```sh
flightdeckd update --from <binário novo> [--allow-downgrade] [--config <arquivo>]
```

O `update` instala sempre em `~/.flightdeck/bin/flightdeckd` (`flightdeckd.exe` no Windows):

1. Roda `<binário novo> --version` e recusa o que não responder como um `flightdeckd`. Uma versão
   menor que a de quem roda o `update` só passa com `--allow-downgrade`.
2. Com o daemon rodando fora do serviço, recusa: "pare o daemon e rode de novo". Com serviço:
   - pede `daemon.shutdown` ao daemon e para o serviço;
   - espera o daemon soltar o `dataDir`;
   - se o lock continua preso, encerra o processo, mas só se ele for o executável do serviço.
3. Guarda o binário atual como `flightdeckd.old` (`.exe.old`) e põe o novo no lugar.
4. Se o serviço apontava para outro caminho (por exemplo `dist/` ou `~/.local/bin`), reinstala o
   serviço no caminho estável, com o mesmo `--config`. Os hooks do Claude Code são reescritos só
   se já estavam instalados e apontam para outro lugar. A saída diz o que foi reescrito.
5. Sobe o serviço e espera `GET /health` responder por até 30 s. Sem `--config` no `update`, a
   porta vem da config do serviço. Se o daemon novo não sobe:
   - o `.old` volta para o lugar;
   - o serviço volta ao caminho e à config de antes e sobe de novo;
   - o comando sai com 1.

   O `.old` de um update bem sucedido é apagado no próximo.

Sem serviço instalado, o `update` só instala o binário e diz como subir. Use o binário instalado
para rodar o `update` (ele compara a versão nova com a dele); na primeira vez, rode o próprio
binário novo.

- **Windows:** `bun run build:daemon`, depois
  `~\.flightdeck\bin\flightdeckd.exe update --from dist\flightdeckd-windows-x64.exe` (na primeira
  vez, `dist\flightdeckd-windows-x64.exe update --from dist\flightdeckd-windows-x64.exe`).
- **WSL:** copie o binário Linux para dentro da distro e rode o `update` lá:
  `cp /mnt/<drive>/<repo>/dist/flightdeckd-linux-x64 ~/` e
  `~/.flightdeck/bin/flightdeckd update --from ~/flightdeckd-linux-x64`.
- **Linux remoto (VPS, Orange Pi):** `scp dist/flightdeckd-linux-arm64 <host>:~/` e, no host,
  `~/.flightdeck/bin/flightdeckd update --from ~/flightdeckd-linux-arm64`.

### Atualização automática assinada

Cada release traz os instaladores e os daemons assinados com a chave do projeto (minisign, gerada
pelo `tauri signer`). A chave pública está em
[`release/flightdeck.pub`](../../release/flightdeck.pub), e o app e o daemon só aceitam o que ela
assinou. Isso vale para as atualizações: o instalador do Windows em si não tem assinatura
Authenticode (veja [Instalação](#pelos-binários-da-release)).

- **O app:**
  - procura a versão nova ao abrir e a cada 6 h, no `latest.json` da última release;
  - com uma versão nova, mostra a faixa "Flightdeck X disponível", com as notas, **Instalar e
    reiniciar** e **Depois**;
  - assinatura inválida ou download quebrado aparecem na faixa, e nada é instalado;
  - em **Configurações**: **Procurar atualização agora** e **Avisar sobre atualizações** (ligado
    por padrão).
- **O daemon:**
  - verifica o `daemon-latest.json` ao subir e a cada `updates.checkIntervalH` (24 h);
  - na página do host, o app mostra **Atualizar daemon para X** quando há versão nova, e pede
    confirmação;
  - o daemon baixa o binário do próprio sistema para `<dataDir>/updates/`, confere o sha256 e a
    assinatura, e roda o `flightdeckd update --from` fora do serviço, para sobreviver à própria
    parada: uma tarefa única `Flightdeck\update` no Windows e `systemd-run --user` no Linux;
  - o host mostra "atualizando…" até reconectar na versão nova.
- **Ordem:** com o app e os daemons atrasados, a faixa sugere atualizar primeiro o app.

```json
{ "updates": { "manifestUrl": "https://github.com/jnerytech/flightdeck/releases/latest/download/daemon-latest.json",
               "checkIntervalH": 24 } }
```

Só o `flightdeckd` compilado verifica o GitHub por padrão. Rodando do código-fonte não há binário
para atualizar, e o `manifestUrl` padrão é `null`.

**Quando falha:**

- **"o daemon não roda como serviço":** a atualização pelo app precisa do serviço. Instale com
  `flightdeckd service install`, ou atualize à mão com `flightdeckd update --from`.
- **Verificação recusada** (sha256 ou assinatura): o arquivo baixado é apagado e nada muda. Baixe
  de novo da página de Releases e confira o `SHA256SUMS`.
- **O host não volta em 2 minutos:** a página do host mostra o comando manual. No host, rode
  `~/.flightdeck/bin/flightdeckd service status` e, se preciso, `flightdeckd update --from` com o
  binário da release. A volta automática do `update` restaura a versão anterior quando a nova
  não sobe.

### Retenção

```json
{ "retention": { "eventsDays": 90, "externalSessionsDays": 30 } }
```

- **Apaga:** eventos e pedidos de permissão de sessões gerenciadas encerradas há mais de
  `eventsDays` dias, e sessões externas encerradas há mais de `externalSessionsDays` dias. `0`
  apaga assim que a sessão encerra.
- **Nunca apaga:** sessões vivas, sessões fixadas, sessões de cards fora de Concluído (inclusive
  as etapas de workflow desses cards), os cards, as execuções de workflow e os nomes e
  marcações das sessões. O índice do histórico segue os transcripts e fica de fora.
- **Quando:** no boot do daemon e a cada 24 h. À mão, `flightdeckd db prune [--dry-run]` mostra
  a contagem por tabela; no app, a seção **Manutenção** da página do host tem **Simular** e
  **Limpar** (que pede confirmação).
- Uma conversa limpa aparece como "conversa removida pela retenção".
- O uso de custos tem retenção própria: `retention.usageDays` (veja [Custos](#custos)).

### Backup e restauração

```json
{ "backup": { "enabled": true, "keep": 7 } }
```

- **Automático:** uma vez por dia, `VACUUM INTO <dataDir>/backups/flightdeck-<AAAAMMDD-HHmmss>.db`
  (horário UTC), mantendo os últimos `keep`. Funciona com o daemon rodando.
- **À mão:** `flightdeckd backup [--out <arquivo>]`, ou **Fazer backup agora** na seção
  Manutenção. Os arquivos ficam só para o dono (0600 fora do Windows).
- **Restaurar:** `flightdeckd service stop`, depois `flightdeckd restore <arquivo>`, depois
  `flightdeckd service start`. Sem serviço, pare o daemon à mão antes do `restore`. O comando
  recusa com o daemon rodando, confere a integridade e se o backup não veio de uma versão mais
  nova, e guarda o banco atual em `flightdeck.db.before-restore`. As migrações que faltarem rodam
  no boot seguinte.
- **A `config.json` fica fora do backup**, porque tem os tokens: guarde uma cópia à parte.

## Deploy

`bun run deploy <alias>` lê `deploy.hosts.json` na raiz (fora do git):

```json
{ "pi": { "ssh": "ubuntu@orange", "target": "linux-arm64", "path": "~/.local/bin/flightdeckd" } }
```

Compila o alvo, copia com `scp` para `<path>.new`, troca o binário, reinicia com
`systemctl --user restart flightdeckd` via `ssh` e confere `systemctl --user is-active`.

Depois do primeiro [`flightdeckd update`](#atualizar-com-flightdeckd-update), o serviço passa a
rodar `~/.flightdeck/bin/flightdeckd`: ajuste o `path` do `deploy.hosts.json` para esse caminho.

## Releases

- **Integração contínua** ([`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)): todo
  push no `main` e todo pull request rodam, no Ubuntu e no Windows:
  - typecheck, lint e os testes com cobertura de 100%;
  - todos os smokes (`smoke`, `smoke:multi`, `smoke:history`, `smoke:board`, `smoke:central`,
    `smoke:workflow`, `smoke:ops`, `smoke:limits`, `smoke:update` e `smoke:costs`);
  - no Windows, também o `cargo check` do app.

  Um job à parte, `screenshots`, roda `demo:shots` e `e2e` no Ubuntu e publica os prints.
- **Versão:** `packages/protocol`, `apps/daemon` e `apps/desktop` sobem juntos, e o
  `tauri.conf.json` lê a versão do desktop. Um teste falha se as versões divergirem.
- **Publicar:** só o orquestrador empurra a tag `v<versão>`, depois que a versão está no `main`.
  O [`.github/workflows/release.yml`](../../.github/workflows/release.yml) roda no Windows:
  1. `bun run release:version <tag>`, que recusa uma tag que não bate com a versão do produto;
  2. `bun run release:tauri-config`, que monta a config de build do app com a chave pública e o
     endpoint do updater, e falha se `release/flightdeck.pub` não for uma chave pública válida;
  3. `bun run build:daemon`, que gera os três daemons;
  4. `bun run release:sign`, que assina os daemons;
  5. `bun run tauri build --bundles nsis,msi` em `apps/desktop`, que gera os instaladores (com a
     assinatura `.sig` do updater);
  6. `bun run release:assets`, que junta os arquivos, as assinaturas e os manifestos
     (`latest.json`, `daemon-latest.json`) em `release-assets/` com o `SHA256SUMS`;
  7. `gh release create <tag> --generate-notes`, com esses arquivos.
- **Repetir uma publicação:** pelo `workflow_dispatch`, informando a tag, que já precisa existir.
- **Ambiente:** o job usa o `GITHUB_TOKEN`, com `contents: write`, e os segredos
  `TAURI_SIGNING_PRIVATE_KEY` e `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, só para assinar as
  atualizações (minisign). Os instaladores do Windows saem sem assinatura Authenticode.

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
bun run smoke:central  # hooks, flightdeckd claude com o claude falso, aprovação e canal; SMOKE CENTRAL OK
bun run smoke:workflow # o workflow de exemplo inteiro, check e gh falsos, até o PR mesclado; SMOKE WORKFLOW OK
bun run smoke:limits   # cota e fila por cota, regra do projeto, recusa de bypass e hook com updatedPermissions; SMOKE LIMITS OK
bun run smoke:ops      # operação do host: manutenção (backup, limpeza), protocolo incompatível, restore
bun run smoke:update   # servidor de release local, daemon-latest.json, binários assinados e a recusa de um adulterado
bun run smoke:costs    # custos a partir de transcripts de fixture, orçamento que segura um card, exportação CSV
bun run tdd:audit -- --since fase-5   # todo feat/fix tem um commit test do mesmo escopo antes
bun run build:daemon   # binários em dist/
bun run build:desktop  # frontend Vite em apps/desktop/dist
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml   # requer apps/desktop/dist
```

Desde a Fase 2 o desenvolvimento é em TDD ([`docs/TDD.md`](../TDD.md)): o teste de cada área
nasce vermelho, roda sozinho com `bun --config=bunfig.area.toml test ./<arquivo>` (mesmo bunfig,
sem o limite global de cobertura) e é commitado como `test(<área>)` antes do `feat(<área>)`. O
preload dos dois bunfigs instala uma trava que reprova a suíte se algum teste executar o `claude`
de verdade, e outra que aponta `HOME`/`USERPROFILE` para uma pasta temporária, para nenhum teste
ler o `~/.claude` real. A trava de check (Fase 6) só deixa um `check` de workflow chegar ao
shell se o comando for um falso instalado pelo próprio teste. Os smokes (menos o `smoke:real`)
usam as mesmas travas. Os fixtures de transcript ficam em `apps/daemon/test/fixtures/history/` e
são escritos à mão.

Testes e smoke usam só o `FakeRuntime`. `bun run smoke:real` repete o roteiro com o Claude de
verdade numa pasta descartável. Ele é manual, gasta cota e não faz parte dos critérios de aceite.

Outros scripts do `package.json`: `bun run coverage`, `bun run format` (Biome com `--write`),
`bun run ui:lock` (grava `apps/desktop/components.lock.json`, o hash de cada componente shadcn/ui
gerado pelo CLI), `bun run release:version`, `bun run release:assets`,
`bun run release:tauri-config` e `bun run release:sign` (os quatro últimos são usados pela
[release](#releases)).
