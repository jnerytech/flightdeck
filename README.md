# Flightdeck

Central de comando pessoal para o Claude Code. O daemon `flightdeckd` hospeda sessões do Claude
Code pelo Agent SDK oficial, guarda cada evento em SQLite e expõe um protocolo WebSocket. O app
desktop (Tauri 2 + React) conecta em um ou mais daemons, mostra o chat em streaming e aprova ou
nega ferramentas.

Fases entregues: **Fase 1** ([`docs/SPEC.md`](docs/SPEC.md)), **Fase 2, multi-host**
([`docs/SPEC-fase-2.md`](docs/SPEC-fase-2.md)), **Fase 3, histórico** ([`docs/SPEC-fase-3.md`](docs/SPEC-fase-3.md)),
**Fase 4, board** ([`docs/SPEC-fase-4.md`](docs/SPEC-fase-4.md)), **Fase 5, central de sessões**
([`docs/SPEC-fase-5.md`](docs/SPEC-fase-5.md)) e **Fase 6, workflows** ([`docs/SPEC-fase-6.md`](docs/SPEC-fase-6.md)). O roadmap está no fim de [`docs/SPEC.md`](docs/SPEC.md). As divergências em relação à spec
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

Depois do primeiro `flightdeckd update` (abaixo), o serviço passa a rodar
`~/.flightdeck/bin/flightdeckd`: ajuste o `path` do `deploy.hosts.json` para esse caminho.

## Operação do host

### Versões e compatibilidade

- **Uma versão só:** o app, o daemon e o protocolo saem com a mesma versão (`0.7.0` nesta fase).
  `flightdeckd --version` imprime `flightdeckd 0.7.0 (protocolo 1)`.
- **No app:** a página do host mostra a versão do daemon, a do app e a do `claude`. Um daemon de
  outra versão ganha o selo **≠** ("versão diferente") na barra lateral: funciona, mas atualize
  quando puder.
- **Protocolo:** o app manda a versão de protocolo dele no `hello`. Se o daemon não a aceita, o
  host fica **incompatível: atualize o daemon**, com o comando na página do host. Ele não tenta
  reconectar e sai das listas (sessões, busca) até ser atualizado e reconectado.
- **Recursos:** o `host.info` anuncia o que o daemon tem (`central`, `workflows`,
  `maintenance`…), e o app esconde o que o host não anuncia. Um daemon anterior à Fase 7 não
  anuncia nada e continua aparecendo como antes, sem a seção Manutenção.

### Atualizar (`flightdeckd update`)

```sh
flightdeckd update --from <binário novo> [--allow-downgrade] [--config <arquivo>]
```

O `update` instala sempre em `~/.flightdeck/bin/flightdeckd` (`flightdeckd.exe` no Windows):

1. Roda `<binário novo> --version` e recusa o que não responder como um `flightdeckd`. Uma versão
   menor que a de quem roda o `update` só passa com `--allow-downgrade`.
2. Com o daemon rodando fora do serviço, recusa: "pare o daemon e rode de novo". Com serviço, para
   o serviço e espera o daemon soltar o `dataDir`.
3. Guarda o binário atual como `flightdeckd.old` (`.exe.old`) e põe o novo no lugar.
4. Se o serviço apontava para outro caminho (por exemplo `dist/` ou `~/.local/bin`), reinstala o
   serviço no caminho estável. Os hooks do Claude Code são reescritos só se já estavam
   instalados e apontam para outro lugar. A saída diz o que foi reescrito.
5. Sobe o serviço e espera `GET /health` responder por até 30 s. Se o daemon novo não sobe, o
   `.old` volta, o serviço sobe de novo e o comando sai com 1. O `.old` de um update bem
   sucedido é apagado no próximo.

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

### Backup e restauração

```json
{ "backup": { "enabled": true, "keep": 7 } }
```

- **Automático:** uma vez por dia, `VACUUM INTO <dataDir>/backups/flightdeck-<AAAAMMDD-HHmmss>.db`
  (horário UTC), mantendo os últimos `keep`. Funciona com o daemon rodando.
- **À mão:** `flightdeckd backup [--out <arquivo>]`, ou **Fazer backup agora** na seção
  Manutenção. Os arquivos ficam só para o dono (0600 fora do Windows).
- **Restaurar:** com o daemon parado (`systemctl --user stop flightdeckd`, ou
  `schtasks /End /TN Flightdeck\flightdeckd` no Windows), rode `flightdeckd restore <arquivo>` e
  suba de novo. O comando recusa com o daemon rodando, confere a integridade e se o backup não
  veio de uma versão mais nova, e guarda o banco atual em `flightdeck.db.before-restore`. As
  migrações que faltarem rodam no boot seguinte.
- **A `config.json` fica fora do backup**, porque tem os tokens: guarde uma cópia à parte.

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
nasceram fora do Flightdeck (terminal, VS Code, Desktop). Os transcripts são só lidos: nada é
editado, apagado ou copiado entre hosts. A única escrita em `~/.claude` é a dos hooks, por
comando explícito (veja "Central de sessões").

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

No detalhe do card, escolha o workflow (ou **Nenhum**, para o card simples da Fase 4),
preencha os `inputs` e clique em Iniciar.

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

### Orçamento

`budget` limita a execução inteira, somando todas as suas sessões:

- **Turnos:** contados entre todas as sessões.
- **Minutos:** o tempo de relógio dos turnos.
- **Custo:** o que o SDK informa (`total_cost_usd`). Em assinatura, é uma estimativa útil como
  teto.
  - O valor é cumulativo por sessão: vale o último total de cada sessão.
  - Uma sessão retomada conta só a diferença.

O orçamento é conferido antes de cada turno. Estourado, a execução pausa em Esperando você com
o motivo. Uma execução pausada não continua: inicie o card de novo. O medidor no detalhe do
card mostra turnos, minutos e custo estimado.

### `flightdeckd mcp`

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

## Central de sessões

A tela **Sessões** é a principal do app: todas as sessões do Claude Code dos hosts online, num lugar só, agrupadas por projeto e ordenadas pela última atividade.

### O que aparece na lista

| Origem | De onde vem |
| --- | --- |
| Flightdeck | sessões que o próprio daemon roda (`session.list`) |
| terminal | sessões abertas fora do Flightdeck, no terminal ou no terminal integrado do VS Code, vistas pelos hooks do Claude Code (`external.list`) |
| histórico | transcripts indexados de `~/.claude/projects` (`history.list`) |

Uma sessão aparece uma vez só. A ordem de preferência é gerenciada, depois terminal, depois histórico.

- **Grupo:** é o projeto. Vale o `remote.origin.url` do repositório da pasta da sessão, normalizado, de modo que SSH e HTTPS do mesmo repositório caem juntos. Worktrees contam como o repositório principal. Sem remoto, vale a raiz do repositório; sem repositório, a pasta.
- **Linha:** mostra host, origem, estado (rodando, precisa de você, ociosa, encerrada), o selo "controlável" e a hora.
- **Filtros:** texto, host, origem, estado, "Só fixadas" e "Mostrar arquivadas". As arquivadas ficam fora por padrão.
- **Menu:** renomear, fixar (as fixadas vão para o topo do grupo), arquivar e "Copiar comando" (`flightdeckd claude --resume <id>`).
- **Abrir uma sessão:**
  - gerenciada: abre a conversa;
  - do terminal ainda viva: abre o transcript ao vivo, com os pedidos de permissão dela e, se for controlável, a caixa de mensagem;
  - encerrada ou do histórico: abre o leitor, com "Continuar no Flightdeck".

### Hooks do Claude Code

As sessões abertas fora do Flightdeck só aparecem com os hooks instalados no host. Há dois caminhos, e ambos são opt-in: na tela do host, o botão **Instalar hooks**, que pede confirmação, ou no terminal do host:

```sh
flightdeckd hooks install     # grava as entradas do Flightdeck em ~/.claude/settings.json
flightdeckd hooks status      # instalados, ausentes ou desatualizados
flightdeckd hooks uninstall   # remove só as entradas do Flightdeck
```

- **O que é escrito:** é a única escrita do Flightdeck em `~/.claude`.
  - O `install` mescla as entradas com o que já existe, sem tocar nas outras chaves nem nos hooks de terceiros.
  - Antes, guarda uma cópia em `settings.json.flightdeck-backup`.
  - Reinstalar substitui as entradas antigas em vez de duplicar.
- **Entradas:**
  - `SessionStart` é um hook de comando: `<flightdeckd> hook session-start --url <receptor> --token <token>`. No Windows, o Claude Code roda hooks de comando pelo Git Bash, que trata `\` como escape. Por isso o caminho do executável é gravado com barras normais (`D:/...`). Uma instalação antiga, com barras invertidas, aparece como desatualizada no `hooks status`: rode `hooks install` de novo.
  - `UserPromptSubmit`, `Notification`, `PermissionRequest`, `PostToolUse`, `PostToolUseFailure`, `PermissionDenied`, `Stop` e `SessionEnd` são hooks http para o receptor do daemon, em `http://127.0.0.1:<hooks.port>`, com o cabeçalho de token.
- **Config:** `hooks.port` vale 7421 por padrão. `hooks.token` é gerado no primeiro install. `hooks.permissionTimeoutS` vale 600. `hooks.staleAfterS` vale 900; uma sessão sem eventos e sem mudança no transcript por esse tempo passa a encerrada.
- **WSL:** o daemon do WSL instala no `~/.claude` do WSL e precisa de um `hooks.port` diferente do Windows.
- **Instalar pelo CLI com o daemon rodando:** o daemon passa a receber os hooks depois de reiniciado. Instalando pelo app, o receptor sobe na hora.
- **O Claude nunca espera pelo Flightdeck:**
  - Com o daemon fora do ar, os hooks falham rápido e a sessão segue.
  - Sem nenhum app aberto, o pedido de permissão é respondido na hora, vazio, e o diálogo do terminal decide.

### Aprovar pelo app

Com o app aberto, o `PermissionRequest` de uma sessão do terminal espera a resposta e aparece em **Precisa de você**, com notificação do sistema. Enquanto isso, o diálogo do terminal continua ativo. Vale o que vier primeiro:

- **Aprovar ou Negar no app:** libera ou nega a ferramenta.
- **Responder no terminal:** o pedido sai da fila no próximo evento da sessão.

Nada é aprovado sem um clique.

### `flightdeckd claude` (alias `fd`)

```sh
flightdeckd claude [argumentos do claude]
# sugestão: alias fd="flightdeckd claude"
```

Abre o `claude` de verdade no mesmo terminal, com os mesmos argumentos e o mesmo código de saída, e acrescenta o canal do Flightdeck. O canal é um servidor MCP (`flightdeckd channel`) que deixa o app mandar mensagens para essa sessão como se você as digitasse.

- **Argumentos:** o wrapper acrescenta `--mcp-config` (arquivo temporário) e `--dangerously-load-development-channels server:flightdeck` e define `FLIGHTDECK_LAUNCH_ID`. O `.mcp.json` do projeto não é tocado.
- **Config:** como os argumentos são todos do `claude`, a config do daemon vem de `FLIGHTDECK_CONFIG`, ou do caminho padrão.
- **Sem `claude` no PATH** (nem em `claude.executablePath`): avisa e sai.
- **Sem o daemon:** avisa e abre o `claude` assim mesmo, sem canal.
- **Com `-p` ou `--print`:** abre o `claude` normal, sem canal e sem aviso. O modo print ignora o canal de desenvolvimento.
- **Research preview:** o canal é um recurso de pré-visualização do Claude Code. Cada abertura mostra um aviso de canal de desenvolvimento, que precisa ser aceito.
- **Aviso conhecido:** na abertura, o Claude Code mostra `server:flightdeck · no MCP server configured with that name`, mesmo com o canal funcionando. O aviso é avaliado antes dos servidores do `--mcp-config` e pode ser ignorado.

| | `claude` puro | `flightdeckd claude` |
| --- | --- | --- |
| aparece na lista, com estado ao vivo | sim (com hooks) | sim (com hooks) |
| aprovar e negar pelo app | sim | sim |
| transcript ao vivo | sim | sim |
| mandar mensagem pelo app | não | sim (selo "controlável") |

### Por que a extensão do VS Code fica de fora

A extensão do Claude Code para VS Code e o app Claude Desktop rodam o `claude` em modo SDK, que ignora o canal de desenvolvimento. Na prova de conceito, o canal subiu como MCP dentro da extensão, mas nenhuma mensagem chegou. O terminal integrado do VS Code é um terminal comum: lá, `flightdeckd claude` funciona.

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
bun run tdd:audit -- --since fase-5   # todo feat/fix tem um commit test do mesmo escopo antes
bun run build:daemon   # binários em dist/
bun run build:desktop  # frontend Vite em apps/desktop/dist
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml   # requer apps/desktop/dist
```

Desde a Fase 2 o desenvolvimento é em TDD ([`docs/TDD.md`](docs/TDD.md)): o teste de cada área
nasce vermelho, roda sozinho com `bun --config=bunfig.area.toml test ./<arquivo>` (mesmo bunfig,
sem o limite global de cobertura) e é commitado como `test(<área>)` antes do `feat(<área>)`. O
preload dos dois bunfigs instala uma trava que reprova a suíte se algum teste executar o `claude`
de verdade, e outra que aponta `HOME`/`USERPROFILE` para uma pasta temporária, para nenhum teste
ler o `~/.claude` real. A trava de check (Fase 6) só deixa um `check` de workflow chegar ao
shell se o comando for um falso instalado pelo próprio teste. Os smokes (menos o `smoke:real`)
usam as mesmas travas. Os fixtures de
transcript ficam em `apps/daemon/test/fixtures/history/` e são escritos à mão.

Testes e smoke usam só o `FakeRuntime`. `bun run smoke:real` repete o roteiro com o Claude de
verdade numa pasta descartável. Ele é manual, gasta cota e não faz parte dos critérios de aceite.
