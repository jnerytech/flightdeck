# Hosts e configuração do daemon

[Voltar ao manual](../pt-BR.md) · [English](../en/hosts-and-daemon-configuration.md)

Um host é a máquina onde roda um `flightdeckd`. O app conecta em quantos hosts você cadastrar.

## O arquivo de configuração

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
Para que ele sobreviva a reboot e a SSH fechado, [instale-o como serviço](service.md#instalar-como-serviço).

## Conectar o app desktop

No app, clique em **Adicionar host** e cole o link de pareamento (veja [Pareamento](pairing.md#pareamento))
ou informe nome, endereço (`127.0.0.1`, ou o `bind` configurado), porta (`7420`) e token (o valor
de `token` no `config.json` do daemon). **Testar e adicionar** faz `hello` e `host.info` antes de
salvar e mostra o motivo quando falha (token recusado, host fora do ar). Depois que o link colado é
lido, o campo o mostra com o token em pontos (`token=••••`), como o campo **Token**, e uma
captura ou o compartilhamento da tela do formulário não mostram o token. Um link digitado à mão
aparece como digitado e é mascarado quando você sai do campo. O link mostrado não pode ser copiado
com o token: copie-o de novo do daemon. Editar o link com pontos mantém o token com que foi lido, mas
só para o mesmo endereço e porta: outro endereço pede que você cole o link desse host, e tirar o
token do link o tira também do formulário. Um link colado que ainda não é lido (uma porta inválida,
por exemplo) mostra seus valores em pontos e não guarda token: corrija-o e cole de novo. **Testar e
adicionar** espera enquanto o campo do link mostra um erro: corrija o link ou esvazie o campo. Um token com
`•` não cabe num link: use os campos à mão.

O token fica no cofre de credenciais do sistema operacional (Windows Credential Manager, Keychain,
Secret Service), não em texto puro. Depois, use **+** ao lado do host para criar uma sessão: pasta
dentro dos `allowedRoots`, nome, modo de permissão e primeiro prompt. Pedidos de ferramenta
aparecem como cards inline, com **Aprovar** e **Negar**. O app reconecta sozinho (de 1 s a 30 s)
e retoma cada sessão do último evento visto.

### O primeiro host

Sem nenhum host, o app mostra quatro passos no lugar das telas de sempre: instalar e iniciar o
daemon (`flightdeckd setup`), copiar o link de pareamento que ele imprime, colar o link e
apertar **Testar e adicionar**, e então o app abre a página do próprio host. Ali você lê
**Saúde e dependências** (o app verifica sozinho) e libera as pastas de projetos em **Pastas permitidas**.
Depois, **Achar meus projetos** (em **Projetos**) preenche o Board sem digitar caminho.

### Verificar um host

**Saúde e dependências** (na aba Visão geral do host) é uma seção só para o que o host precisa e
como ele está. O app lê sozinho quando o host conecta, quando você abre a página do host (se a
última leitura tem mais de cinco minutos) e depois de uma atualização do daemon, e diz "Verificado
há 3 min"; **Verificar de novo** lê agora. As dependências são **Obrigatórias** (Claude Code e o
login dele, git, o serviço que sobe o daemon no boot, uma pasta permitida) e **Opcionais** (GitHub,
Azure, SSH, Tailscale, PowerShell no Windows, os hooks); as conferências do próprio daemon
(configuração, daemon, Tailscale, modelos, ferramentas do time, versão contra a do app) ficam em
**Verificações**. Cada linha tem um ícone e uma palavra (OK, atenção, falhou, desatualizada,
faltando, não se aplica), o que deixa de funcionar sem ela e um passo simples para consertar. Onde o
app já tem a ação, a linha tem um botão: **Instalar hooks** (pergunta antes), **Atualizar o daemon
para X** (pergunta antes) e **Adicionar pasta** (abre as Configurações com a caixa da pasta em foco e à vista; **Instalar
hooks** também atualiza o estado dos hooks mostrado nas Configurações). O que precisa de `sudo` ou de instalador só aparece
para copiar: o app nunca o executa. Um programa que falta mostra a linha do gerenciador de pacotes
quando há uma (apt, brew, winget) e um botão **Página de instalação** que abre a página oficial; o
Flightdeck nunca oferece um download enviado direto para um shell. O conselho vale para o sistema em
que aparece: o **GitHub** conta como desatualizado abaixo do gh 2.31 (o primeiro com `gh project`, de que
a sincronização do quadro precisa), e no Linux aponta para a página de instalação, porque o pacote apt
de uma LTS pode ser mais antigo; o **OpenSSH** no Windows diz para rodar a linha do
`Add-WindowsCapability` em um PowerShell elevado (Executar como administrador); em um Linux sem
systemd a linha do **serviço** diz que não há serviço para instalar ali e que é para iniciar o
`flightdeckd` no login com as ferramentas do próprio sistema, em vez de oferecer um comando que
falha. As mesmas conferências rodam no terminal com `flightdeckd doctor`.

### Comparar hosts

Com dois ou mais hosts, a aba **Visão geral** do host também tem **Comparar hosts**, uma faixa da
largura da aba, abaixo das duas colunas. **Mostrar comparação** abre uma tabela com uma coluna por
host e uma linha para o sistema operacional, a versão do daemon, a versão do Claude Code, os hooks,
o login do Claude, `gh`, `az`, Iniciar no boot e os recursos. Abrir (e **Atualizar**) lê cada host
online de novo, rodando as mesmas verificações de **Saúde e dependências**; nada mais pergunta aos
hosts. Os hooks aparecem como Instalados, Desatualizados ou Ausentes, como nessa seção. A célula que
difere do que a maioria dos hosts tem fica marcada e diz o motivo em palavras ("Difere da maioria
dos hosts, que têm 1.4.0"). Quando o que está marcado falta (hooks, login, `gh`, `az` ou Iniciar no
boot ausente ou desatualizado) ou é um daemon mais antigo que o mais novo da linha, a célula tem um
botão **Corrigir em** com o nome do host, que abre a página desse host, onde Saúde e dependências
tem a instalação, o ligar ou a atualização; na página do próprio host, ele rola até lá. Sem maioria
(dois hosts diferentes, ou metade para cada lado) toda célula que difere é marcada e diz isso
("Difere, sem maioria entre os hosts"); a linha de recursos nomeia então, em cada host, o que ele
não tem e o que tem que outro host não tem. Um host que não está online diz isso uma vez ("Não
comparado: offline."), em vez de um traço em cada linha, e um valor que um host online não informa
aparece como um traço e nunca é marcado. A linha de recursos mostra
quantos recursos o host tem e, quando difere, os nomeia em palavras: os que ele não tem e os que
tem a mais em relação à maioria dos hosts ("sem stall, sem checkLoop"). Uma lista longa mostra os 3
primeiros e "e mais N", que abre a lista inteira no lugar.

## Confiar em um projeto

Um projeto (um repositório) pode trazer configuração própria: hooks que rodam comandos sozinhos,
servidores MCP que iniciam programas, configurações com ferramentas liberadas, um `CLAUDE.md`,
agentes, skills e comandos. Em uma sessão que o Flightdeck inicia, essa configuração carrega
**somente em uma pasta em que você confiou**. As pastas em que você já trabalhava quando isso
chegou (os projetos do quadro e as pastas das suas sessões anteriores) têm confiança; um
repositório que você clonar depois, ou uma pasta que você adicionar, começa sem confiança.

- Em uma pasta sem confiança a sessão carrega as suas configurações, não as do projeto, e
  **também não os seus servidores MCP nem os seus plugins** (o Claude Code é instruído a usar só o
  servidor MCP que o Flightdeck dá). O `CLAUDE.md`, os agentes e as skills do projeto também não
  carregam. Um aviso no alto da sessão diz isso, com **Revisar e confiar**.
- Um projeto sem cards abre a página com uma linha e um botão, **Próximo passo: criar o primeiro
  card**, que abre o Novo card do Board. Os cards rodam com ou sem confiança no projeto: confiar
  acrescenta a configuração própria do projeto às sessões dele.
- A página do projeto tem **Configuração do projeto**: o que o projeto carregaria, lido sem rodar
  nada (hooks por evento e servidores MCP com o comando inteiro, em um bloco com rolagem e um
  aviso quando um comando é longo ou tem várias linhas; programas que as configurações executam,
  como `apiKeyHelper` e `statusLine`; variáveis de ambiente que desviam tráfego ou código, com o
  valor, e os nomes das outras, nunca os valores; plugins; toda outra chave de configuração
  presente; ferramentas liberadas; agentes, skills e comandos, e os que trazem hooks, servidores
  ou permissões de ferramentas no cabeçalho; `CLAUDE.md`; e arquivos que não puderam ser lidos), o custo de não confiar e
  **Confiar neste projeto**. Ele pergunta antes, citando o projeto e o host, porque hooks e
  servidores MCP com confiança rodam comandos naquele computador sem perguntar a você. **Revogar a
  confiança** não pergunta. Confiar vale para as pastas dentro do projeto, não para as ao redor.
- Logo abaixo, **Configuração do Claude Code** lista, como uma checklist, o que ajuda o Claude
  Code a trabalhar bem no projeto: `CLAUDE.md`, hooks (e se algum roda um formatador após
  edições, ou verifica o `git add` ou arquivos de segredo antes de uma ferramenta rodar), skills, subagentes, permissões
  (quantas regras permitem e quantas negam) e servidores MCP. Cada um aparece como **Encontrado** ou
  **Faltando**, e o cartão diz quantas das seis partes existem. Ele só lê: nada no projeto muda, e
  variáveis de ambiente nunca aparecem nele. Quando algum arquivo do projeto não pode ser lido, ele
  avisa: uma parte marcada como faltando pode existir.
- Em um host que guarda modelos de configuração, **Compartilhar como modelo**, abaixo da checklist,
  pede um nome e guarda o `CLAUDE.md`, os agentes e as skills do projeto como um modelo do qual
  qualquer projeto desse host pode partir. As configurações (hooks, permissões, servidores MCP)
  nunca são compartilhadas, cada arquivo é verificado em busca de segredos antes, e um nome já
  usado é recusado.
- A página de um host também lista seus **modelos de configuração do Claude Code**, os compartilhados
  da configuração de um projeto, com seus arquivos e tamanho. **Apagar** pergunta antes e remove só
  esse modelo: os projetos configurados com ele ficam com os arquivos. Funciona deste computador ou
  pelo Tailscale, não de longe.
- Quando o host tem modelos de configuração, a escolha **Partir de** no diálogo de configuração
  escolhe um deles em vez dos arquivos do próprio Flightdeck. A prévia mostra então os arquivos desse
  modelo, lista em **Deixado de fora do modelo** o que ele não propôs e por quê (cabeçalho que
  poderia executar um comando ou conceder uma permissão, um segredo, uma importação de fora do
  projeto, um comando que roda ao carregar), e não oferece o rascunho do CLAUDE.md.
- **Conhecimento do projeto** lista os PRDs, RFCs, ADRs e specs do projeto (os arquivos Markdown em
  `docs/decisions`, `docs/adr`, `docs/rfc`, `docs/prd` e `docs/specs`), cada um com título, caminho,
  tipo e o status que diz ter no front matter (`status: valid`, `transitional` ou `obsolete`). Um
  documento sem status aparece como **Sem classificação**. Os filtros contam os documentos de cada
  status, e um aviso aparece quando um documento válido aponta para um obsoleto. Ele só lê: nada no
  projeto muda. Só os primeiros 500 documentos aparecem.
  Uma sessão que o Flightdeck inicia em um projeto **confiável** (`flightdeckd claude`, "Claude
  aqui", sessões em segundo plano) também recebe, no prompt de sistema, um índice curto desses
  documentos: o caminho e o título de cada documento **válido**, e de cada **transitório** marcado
  como tal. Documentos sem status e obsoletos nunca são entregues. O índice tem no máximo 4 KiB, e
  uma linha diz quantos documentos ficaram de fora. Os títulos são marcados como dados do
  repositório, não como instruções. Um worktree é lido da pasta principal confiável, não da branch.
  Um prompt de sistema que você mesmo passar (`--append-system-prompt`) fica como está, sem o
  índice ao lado. O painel diz se o projeto recebe o índice, e **Desligar** / **Ligar** mudam isso
  só para aquele projeto. A escolha fica no arquivo de configuração do host, como
  `"knowledge": { "feedOff": ["/caminho/do/projeto"] }`, e uma pasta dessa lista desliga tudo
  dentro dela também: um projeto desligado por uma pasta acima diz isso, e é religado editando
  essa entrada no arquivo. Um projeto sem confiança não recebe o índice, ligado ou desligado.
  Cada documento tem um seletor de status e um botão **Alterar**: escolher um status só o seleciona (as
  setas podem percorrer a lista sem escrever nada), e **Alterar**, ligado enquanto a escolha difere do
  status do arquivo, o escreve. Escreve só a linha `status:` do front matter
  daquele arquivo (um documento sem front matter ganha um bloco com essa linha), mantém o resto do
  arquivo como está e deixa a mudança na pasta do projeto, sem commit: revise com o git. A mudança
  é recusada quando o arquivo mudou desde que a lista o mostrou (recarregue e tente de novo),
  quando o front matter não é claro o bastante para editar com segurança, ou quando o arquivo passa
  de 1 MB ou não é texto. Só os documentos que a lista mostra podem ser mudados; um link, um nome
  de credencial ou um arquivo fora das pastas da biblioteca não podem.
  Enquanto a lista carrega o painel avisa; quando o host não consegue lê-la, o painel diz o que
  conferir (o host está online, a pasta do projeto ainda existe) e **Tentar de novo** lê de novo.
  **Criar um cartão** de uma spec continua com o foco enquanto o cartão é criado, e o painel então diz
  qual cartão foi criado, com um botão **Abrir**. Ligar ou desligar o índice, e um interruptor que não
  pôde ser mudado, são lidos pelos leitores de tela.
  **Novo documento** começa um documento a partir de um modelo: escolha o tipo (ADR, RFC ou PRD),
  digite um título e use **Criar a partir do modelo**. O arquivo vai para `docs/adr`, `docs/rfc` ou
  `docs/prd` do projeto (ADR e RFC são numerados, `0004-<título>.md`; um PRD é `<título>.md`), como
  rascunho com `status: transitional`, sem commit. Ele nunca substitui um arquivo que já existe, e é
  recusado quando `docs/<tipo>` é um link ou fica fora do projeto.
  **Rascunhar ADR**, no resumo de uma sessão, começa um registro de decisão a partir do que a
  sessão fez: o resumo é o primeiro texto, a varinha do assistente pode escrever um ADR (Contexto,
  Decisão, Consequências) a partir dele, você edita, dá um título e **Salvar como ADR** grava em
  `docs/adr` do projeto como rascunho, sem commit, do mesmo jeito que acima.
- Confiar em uma pasta não confia na de cima: um clone dentro dela que tem `.git` próprio é outro
  projeto, e uma pasta que contém as suas raízes liberadas não pode ser confiada. Uma raiz
  liberada que é ela mesma um projeto (um `.git` próprio e nenhum outro repositório dentro) pode
  ser confiada, e a confiança aparece na hora; se depois você clonar outro repositório dentro
  dela, a confiança deixa de valer até você tirar esse clone dali. Uma sessão numa pasta com confiança diz "Pasta com confiança" no topo. As sessões em
  segundo plano seguem a mesma regra das sessões do app.
- Esta confiança é do Flightdeck e decide só o que uma sessão rodada pelo Flightdeck carrega. A
  pergunta que o Claude Code faz num terminal (ou no VS Code) é outra: aceitá-la lá não dá
  confiança à pasta aqui.
- O worktree de um card sempre lê a configuração do projeto da pasta principal dele, então uma
  branch nunca traz hooks próprios, com confiança ou sem.
- Confiar só funciona a partir do próprio computador do host ou pela Tailscale (como liberar uma pasta ou sessões sem pedidos); revogar funciona de qualquer lugar.
- A decisão fica no host (`project_trust` no banco dele), por host, e é registrada no log. Um host
  que não anuncia `projectTrust` carrega tudo, como antes.

## Manter o computador acordado

Enquanto uma sessão de um host roda, ou espera a sua resposta, o host pede ao computador dele para
não dormir, e assim aprovações e avisos continuam chegando e uma execução longa não é pausada por
uma soneca. A aba **Configurações** do host tem **Manter este computador acordado** para desligar ou ligar de
novo; a escolha fica na config do host (`keepAwake`, ligado por padrão) e vale na hora. O host solta
o computador quando a última sessão para e quando o daemon sai.

- Isso impede o computador de dormir por inatividade; a tela ainda pode apagar, e fechar a tampa
  segue as configurações de energia do sistema.
- No Linux usa `systemd-inhibit`, no macOS `caffeinate` e no Windows o PowerShell
  (`SetThreadExecutionState`). Se nenhum deles existe, ou não consegue iniciar, a página diz o motivo
  e o computador dorme como de costume.
- Vale para o computador do próprio host: um host em outra máquina mantém aquela máquina acordada,
  não a sua.
- Dentro do WSL ele não segura nada: um bloqueio tomado ali não mantém o Windows acordado, então a
  página diz isso e a chave vale para o host do Windows.

## Sessões sem pedidos de permissão

Por padrão nenhuma sessão de um host roda em **Ignorar permissões** (toda ferramenta roda sem
perguntar). Para permitir, abra a página do host e use **Sessões sem pedidos de permissão →
Permitir sessões sem pedidos**; o app pede confirmação e cita o host. A escolha fica na config do
host (`allowBypassPermissions`) e vale na hora. Com ela ligada:

- **Sessão nova** oferece "Ignorar permissões: sem pedidos de permissão" na lista de modos. Ao
  escolher, o app pergunta de novo a cada Criar sessão, citando o host e a pasta.
- A lista de modos na caixa de mensagem de uma sessão aberta oferece todos os modos, inclusive
  Ignorar permissões e modos mais soltos que o de início. Mudar para Ignorar permissões pergunta
  a cada vez, citando o host e a sessão.
- Sessões iniciadas depois de ligar podem ser mudadas para Ignorar permissões; uma que já rodava
  mantém o que tinha ao começar (o Claude Agent SDK precisa saber disso no início).

Com ela desligada (o padrão) o daemon recusa iniciar uma sessão em Ignorar permissões, e uma
sessão aberta nunca fica mais permissiva que o modo em que começou. O modo de permissão de uma
persona continua valendo quando é mais estrito. Desligar não pergunta nada.

Uma sessão em Ignorar permissões não pede nada: o Claude Code pula o pedido de permissão de toda
ferramenta, inclusive as que de outro modo sempre perguntam (como descartar um card pelo servidor
MCP do flightdeck). Essa é a escolha que você faz ao escolher esse modo.
