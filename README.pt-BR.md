# Flightdeck

[English](README.md) | Português (Brasil)

[![CI](https://github.com/jnerytech/flightdeck/actions/workflows/ci.yml/badge.svg)](https://github.com/jnerytech/flightdeck/actions/workflows/ci.yml)
[![Licença: MIT](https://img.shields.io/badge/licen%C3%A7a-MIT-blue.svg)](LICENSE)
[![Quality Gate](https://sonarcloud.io/api/project_badges/measure?project=jnerytech_flightdeck&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=jnerytech_flightdeck)
[![Cobertura](https://sonarcloud.io/api/project_badges/measure?project=jnerytech_flightdeck&metric=coverage)](https://sonarcloud.io/summary/new_code?id=jnerytech_flightdeck)
[![Bugs](https://sonarcloud.io/api/project_badges/measure?project=jnerytech_flightdeck&metric=bugs)](https://sonarcloud.io/summary/new_code?id=jnerytech_flightdeck)
[![Vulnerabilidades](https://sonarcloud.io/api/project_badges/measure?project=jnerytech_flightdeck&metric=vulnerabilities)](https://sonarcloud.io/summary/new_code?id=jnerytech_flightdeck)
[![Manutenibilidade](https://sonarcloud.io/api/project_badges/measure?project=jnerytech_flightdeck&metric=sqale_rating)](https://sonarcloud.io/summary/new_code?id=jnerytech_flightdeck)

**Um app desktop para ver, aprovar e conduzir todas as sessões do Claude Code de todas as suas máquinas.**

## O que é o Flightdeck

O Flightdeck é um app desktop (Tauri 2 + React, Windows em primeiro lugar) que centraliza as suas
sessões do Claude Code em vários hosts. Cada host roda um daemon pequeno, o `flightdeckd` (Bun +
TypeScript, SQLite, WebSocket), que hospeda sessões pelo Agent SDK oficial e acompanha as que você
abre num terminal. O app conecta em todos os daemons, e você acompanha, aprova e conversa com as
sessões num lugar só, sem abrir cada máquina.

![A central de sessões do Flightdeck](docs/images/hub-dark.png)

## Recursos

**Sessões**

- Uma central para as sessões de todos os hosts, agrupadas por projeto, com o estado ao vivo e uma
  linha de resumo para cada uma.
- Sessões abertas num terminal também aparecem, por hooks do Claude Code que você instala se
  quiser.
- Aprove ou negue pedidos de ferramenta pelo app e mande mensagens para sessões do terminal abertas
  com `flightdeckd claude`.
- Regras de "permitir sempre" gravadas na config local do projeto no Claude Code, nunca na global.

**Trabalho**

- Um board por projeto: cada card é uma worktree git mais uma sessão, com pull requests no GitHub
  e no Azure DevOps.
- Workflows em YAML com agentes, checks, gates de aprovação, loops, etapas em paralelo e
  orçamentos.
- Issues do GitHub ou do Azure Boards viram cards, automações (horários, comentários no PR, checks que
  falharam, rótulos) e uma arena que roda um pedido em 2 a 4 variantes para comparar e escolher.
- Selo de risco em cada pedido de permissão: o de risco alto pede que você segure o botão por 2 segundos.
- Destinos SSH (no estilo Termius, com o OpenSSH do host): importe o `~/.ssh/config`, confira e
  guarde a chave do servidor, conecte numa tela de terminal e veja borda vermelha em `prod`.
- Cofre de segredos (chaves SSH, senhas, tokens e variáveis de ambiente): os valores ficam no cofre
  de credenciais do sistema, só aparecem depois de você digitar uma palavra e saem num backup cifrado.
- Ações: você declara um comando com lugares para segredos do cofre e para parâmetros, e o Claude
  o chama pelo nome (ferramentas MCP `list_actions` e `run_action`, ou o mod `flightdeck`)
  sem nunca receber o segredo. Ele recebe o código de saída e a saída (até 32 KB) com o segredo
  mascarado.
- Mensagens entre sessões, em qualquer host: uma sessão lista as outras que pode ver, manda para
  uma (`send_to_session`), pede um aviso quando outra ficar ociosa e lê outra (ferramentas MCP ou o
  mod `flightdeck`). Entre hosts o app repassa, e a mensagem espera por ele até 24 horas. Toda
  sessão ganha um nome padrão, `projeto · persona · número` (`flightdeck · revisor · 3`), e um
  apelido que a endereça (`flightdeck-revisor-3`).
- Times: uma sessão coordenadora quebra um objetivo em tarefas, despacha cada uma para uma
  executora num card próprio, confere o trabalho por conta própria e só aceita commit verde. O app
  tem Conversas, Times e a aba Mensagens de cada sessão; um time pausa sozinho quando a cota do
  plano passa do limite.
- Snippets: comandos e prompts salvos (globais, por host ou versionados no projeto), usados pelo
  Ctrl+K, numa aba de terminal ou com `/` numa sessão, importados do histórico do shell com os
  segredos ocultos.
- Memória, contexto e plugins: a memória do Claude Code de um projeto (lida, editada com hash e
  confirmação, com sugestões de limpeza) e o orçamento do que entra no contexto na partida; os
  plugins do host, cada um mostrado com o que instala (hooks, monitores, skills, agentes, comandos,
  MCP) antes de qualquer instalação, atualização ou remoção.
- Personas: papéis de engenharia que o Claude assume numa sessão (um pacote de dez, mais as suas
  por host, projeto ou app), escolhidas ao iniciar uma sessão, um card ou uma variante da arena,
  aplicadas a uma sessão aberta ou oferecidas ao Claude como subagentes.
- Vigiar e consertar o PR de um card: quando um build, uma política, um conflito ou um comentário de
  confiança piora, a sessão do card conserta dentro de limites de rodadas, custo e tempo, roda os
  seus checks locais e faz push só da branch do próprio card. Cole o link de um PR no Ctrl+K para
  achar o card ou as sessões.
- Um ambiente de execução por card: scripts para prepará-lo e rodá-lo a partir de um
  `.flightdeck/run.yaml` confiado, um bloco de portas próprio para dois cards rodarem lado a lado,
  cada processo numa aba de terminal e um preview do app rodando (só loopback).
- Busca no histórico de todos os hosts, inclusive de sessões que não nasceram no Flightdeck.
- Revisão do que uma sessão ou um card mudou: comente linhas do diff e envie a revisão ao agente,
  reverta ou edite arquivos, leve os comentários do PR ao agente e faça o merge local do card.
- Uma linha do tempo por sessão: volte aos arquivos de qualquer turno (com prévia e desfazer),
  bifurque a conversa a partir de um turno e edite os servidores MCP, o `CLAUDE.md`, os agentes e as
  skills do projeto. Voltar cobre só arquivos: não desfaz banco de dados, rede nem `git push`.
- Arquivos não rastreados (como `.env`) podem acompanhar um card até o worktree: liste-os em
  `.worktreeinclude` na raiz do repositório.
- Uma statusline do Claude Code com sua cota e custo: aponte `statusLine` para
  `flightdeckd statusline`. O Flightdeck nunca grava essa configuração; para manter uma statusline
  que você já tem, chame as duas em um só script e junte as linhas (veja o manual).

**Custo e cota**

- Custo estimado por projeto, modelo e origem, com exportação em CSV.
- Barras da cota do plano com a projeção de quando a janela esgota, fila por cota e orçamentos em
  US$ que avisam ou seguram cards novos.

**Desktop**

- Abas com histórico próprio, fixadas, reordenadas e guardadas entre aberturas, e tela dividida em
  duas áreas, lado a lado ou empilhadas.
- Terminal embutido em qualquer host, numa aba, sem SSH: sobrevive ao app e reanexa com o
  scrollback. "Abrir Claude aqui" roda o `flightdeckd claude` nele, e a sessão é aprovável pelo
  app.
- Menu da bandeja para aprovar pedidos sem abrir a janela e paleta `Ctrl+K`.
- Atualização automática assinada, do app e dos daemons.
- Leve em recursos: listas longas, texto ao vivo e saída de terminal são limitados e agrupados, as partes pesadas carregam sob demanda, e `bun run perf:baseline` imprime os números.
- Temas claro e escuro; português e inglês.

## Prints

| Aprovação, com "permitir sempre" | Tema claro |
| --- | --- |
| ![Aprovação de um pedido de ferramenta](docs/images/approval-dark.png) | ![A central no tema claro](docs/images/hub-light.png) |

| Board | Custos |
| --- | --- |
| ![O board](docs/images/board-dark.png) | ![A tela de custos](docs/images/costs-dark.png) |

## Instalação

Baixe na página de [Releases](https://github.com/jnerytech/flightdeck/releases):

| Arquivo | O que é |
| --- | --- |
| `Flightdeck_<versão>_x64-setup.exe` (ou `.msi`) | o app desktop para Windows |
| `flightdeckd-windows-x64.exe`, `flightdeckd-linux-x64`, `flightdeckd-linux-arm64` | o daemon, um por host |
| `SHA256SUMS` | o SHA-256 de cada arquivo |

1. **Confira o download.** No Linux: `sha256sum -c SHA256SUMS --ignore-missing`. No Windows
   (PowerShell): `(Get-FileHash .\<arquivo>).Hash.ToLower()`, comparado com a linha do
   `SHA256SUMS`.
2. **Rode o instalador do app.** Ele não tem assinatura de código do Windows, então o SmartScreen
   mostra "O Windows protegeu o computador". Com o hash conferido, clique em **Mais informações** e
   depois em **Executar assim mesmo**.
3. **Instale o daemon em cada host**, com o Claude Code instalado e logado. Veja o Início rápido
   abaixo.

Para compilar a partir do código-fonte, veja o [manual](docs/manual/pt-BR.md#a-partir-do-código-fonte).

## Início rápido

1. **Instale o daemon como serviço** (no Linux, faça `chmod +x` no binário antes). No Windows, use
   `flightdeckd-windows-x64.exe` e `~\.flightdeck\bin\flightdeckd.exe`.

   ```sh
   ./flightdeckd-linux-x64 update --from ./flightdeckd-linux-x64   # instala em ~/.flightdeck/bin
   ~/.flightdeck/bin/flightdeckd service install
   ```

   Os comandos abaixo supõem `~/.flightdeck/bin` no seu `PATH`; senão, use o caminho completo
   (`~\.flightdeck\bin\flightdeckd.exe` no Windows). A primeira execução cria
   `~/.flightdeck/config.json`. Ponha em `allowedRoots` as pastas onde
   as sessões podem rodar (com a lista vazia nenhuma sessão pode ser criada) e reinicie:
   `flightdeckd service stop && flightdeckd service start`. Para um host que não seja esta
   máquina, defina também `bind` e `allowedNetworks`
   ([acesso remoto](docs/manual/pt-BR.md#acesso-remoto-pela-tailscale)).

2. **Pareie.** Imprima um link e um QR para o app:

   ```sh
   flightdeckd pair
   ```

3. **Adicione o host no app.** Clique em **Adicionar host**, cole o link `flightdeck://` e
   confirme com **Testar e adicionar**.

4. **Instale os hooks** (opt-in) para que as sessões do terminal apareçam. Você também pode usar o
   botão **Instalar hooks** na página do host, que dispensa o reinício:

   ```sh
   flightdeckd hooks install    # com o daemon já rodando, faça service stop / service start
   ```

5. **Abra o Claude Code pelo Flightdeck** para o app poder mandar mensagens para a sessão:

   ```sh
   flightdeckd claude          # mesmos argumentos do claude; alias sugerido: fd
   ```

## Como funciona

Cada host roda um `flightdeckd`. Ele abre sessões do Claude Code pelo Agent SDK, recebe eventos
dos hooks do Claude Code, indexa os transcripts do Claude Code que já existem no host e guarda
tudo num banco SQLite local. O app desktop abre um WebSocket por daemon e junta todos numa visão
só. Os hosts são independentes: nada é copiado entre eles.

```text
┌───────────────────────┐   WebSocket + token   ┌────────────────────────────────┐
│ App Flightdeck        │◄─────────────────────►│ flightdeckd, host A            │
│ (Tauri 2 + React)     │                       │  sessões pelo Agent SDK        │
│                       │                       │  receptor dos hooks do Claude  │
│  central · board ·    │   (pela Tailscale     │  índice do histórico (SQLite)  │
│  custos · bandeja     │    nos hosts remotos) │  worktrees git · PRs           │
│                       │                       └────────────────────────────────┘
│                       │◄─────────────────────►┌────────────────────────────────┐
└───────────────────────┘                       │ flightdeckd, host B  (igual)   │
                                                └────────────────────────────────┘
```

## Modelo de segurança

- **Um token por host.** O app conecta com um token aleatório, guardado no cofre de credenciais do
  sistema operacional. Tokens nunca aparecem nos logs, e `flightdeckd pair --rotate` troca o token.
- **Pastas.** Sessões só abrem dentro de `allowedRoots`; o caminho é resolvido com realpath, então
  `..` e symlinks que saem das raízes são recusados.
- **Redes.** Por padrão só conexões de loopback são aceitas. Qualquer outra origem exige uma
  entrada explícita em `allowedNetworks`, e expor a porta na internet aberta não é suportado.
- **Hooks opt-in.** A única escrita do Flightdeck em `~/.claude` são as entradas dos hooks, e só
  quando você pede (`flightdeckd hooks install`). Ele guarda uma cópia, e o `hooks uninstall` as
  remove. Os transcripts são só lidos. "Sempre neste projeto" grava no
  `.claude/settings.local.json` do próprio projeto, não no `~/.claude`.
- **Terminais.** Um terminal embutido é um shell completo no host. Ele vem ligado só quando o
  daemon escuta em loopback; ligá-lo num host alcançável por outras redes pede confirmação. O
  conteúdo nunca vai para o log nem para o banco.
- **Comandos de execução são confiados por hash.** O que o `.flightdeck/run.yaml` declara só roda
  depois de você revisar e confiar naquele conteúdo exato, como argv sem shell, na worktree do
  card; o preview só abre `127.0.0.1` e `localhost`.
- **Nada é aprovado sem um clique.** Os comandos `check` de um workflow só rodam se você confiou
  no workflow, e um arquivo alterado pede confiança de novo.
- **Segredos fora do transcript.** Uma ação roda o `run` como lista de argumentos, nunca por um
  shell, e o segredo vai só para o ambiente ou para um arquivo temporário, nunca para um argumento.
  Um `.flightdeck/actions.yaml` versionado só roda depois que você confia, e a confiança fixa o
  sha256 do script que ele executa, conferido de novo logo antes de cada execução.
  `run_with_secret` (um comando escrito pelo Claude) sempre pede a sua aprovação e nunca é
  automático. A máscara cobre o valor literal e as formas em base64, URL e hex, não um valor
  transformado de outro jeito. **O limite é o usuário do sistema:** enquanto a ação roda, outro
  processo do mesmo usuário (uma sessão do Claude com Bash no mesmo host) pode ler o ambiente ou o
  arquivo temporário. Segredos de produção ficam em ações `ssh:`, que rodam num host remoto onde o
  Claude não tem shell.
- **Regras de uso por segredo.** Cada segredo tem regras em ordem (quem, para quê, quando, quantas
  vezes) sobre padrões seguros; nenhuma regra permite `run_with_secret` nem um segredo `prod` fora
  de uma janela de horário, e um uso de risco alto sempre pergunta.
- **Mensagem nunca é aprovação.** O cabeçalho diz que ela vem de outra sessão, não de você, e
  nenhuma mensagem responde a um pedido de permissão. Por padrão só falam sessões do mesmo projeto
  ou time (exceções em Configurações), com limites por par e por sessão; um laço pausa o par e
  avisa você. Uma sessão que recebeu conteúdo de terceiros passa essa marca adiante, e a aprovação
  automática fica desligada também em quem recebe dela.
- **Atualizações assinadas.** O app e o daemon só instalam atualizações assinadas com a chave do
  projeto ([`release/flightdeck.pub`](release/flightdeck.pub)). O instalador do Windows em si não
  tem assinatura de código.

## Documentação

- Manual: [English](docs/manual/en.md) | [Português (Brasil)](docs/manual/pt-BR.md)
- Roadmap e specs: [`docs/SPEC.md`](docs/SPEC.md)
- Decisões e divergências em relação às specs: [`docs/DECISIONS.md`](docs/DECISIONS.md)

## Desenvolvimento

Pré-requisitos: [Bun](https://bun.sh) 1.4 ou mais novo e o Claude Code instalado e logado. Para o
app desktop, Rust estável e os
[pré-requisitos do Tauri 2](https://v2.tauri.app/start/prerequisites/).

```sh
bun install
bun run typecheck      # tsc em todos os workspaces e scripts
bun run lint           # Biome
bun run test           # testes com cobertura de 100% + confere que nenhum arquivo-fonte ficou de fora
bun run smoke          # ponta a ponta com o daemon real e o runtime fake
bun run build:daemon   # binários em dist/
bun run demo           # dois hosts de mentira e a entrada web do app, em http://localhost:1420
```

O desenvolvimento é test-first: o teste de cada área é commitado vermelho antes da implementação.
As regras estão em [`docs/TDD.md`](docs/TDD.md). Os outros smokes, o build e o fluxo de release
estão no [manual](docs/manual/pt-BR.md#desenvolvimento).

## Roadmap

O roadmap, com as fases já entregues, está no fim de [`docs/SPEC.md`](docs/SPEC.md).

## Licença

[MIT](LICENSE).
