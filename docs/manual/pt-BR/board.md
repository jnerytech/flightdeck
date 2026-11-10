# Board

[Voltar ao manual](../pt-BR.md) · [English](../en/board.md)

Cada projeto (um repositório git do host) tem um board com cinco colunas: Backlog, Em andamento,
Precisa de você, Em revisão e Concluído. Um card vira uma branch `fd/<slug>`, uma worktree e uma
sessão; o card anda sozinho conforme a sessão e o PR, e também pode ser arrastado à mão.
Cada coluna tem a sua cor de fundo e uma linha fina no topo (Backlog neutro, Em andamento âmbar,
Precisa de você laranja, Em revisão verde, Concluído apagado), o ícone do status, o número de cards
numa pílula e um **+** que põe um card direto nessa coluna. Uma coluna vazia mostra uma caixa
tracejada e discreta que diz "Vazio" e também cria um card quando você a aperta.

Uma worktree escolhida na barra lateral mostra os arquivos dela ao lado das colunas (**Arquivos**
esconde ou mostra; num board estreito os arquivos tomam o lugar das colunas). Num host que busca
arquivos, o painel busca no repositório inteiro: **Nomes** acha os arquivos cujo caminho tem o
texto, e **Conteúdo** lista cada linha que o tem como `caminho:linha`. Um só campo de busca serve
aos dois, então trocar de modo mantém o que você digitou. Um resultado abre o arquivo, e um de
conteúdo abre na linha. Uma credencial, ou um caminho ou linha com um token ou um valor do cofre,
aparece mascarado e como **Oculto**, e não abre.

## Trabalhar com vários cards

- **Selecionar.** `Ctrl`-clique (`⌘`-clique no Mac) num card para selecioná-lo ou desmarcá-lo;
  `Shift`-clique seleciona o intervalo desde o último card escolhido, dentro da coluna. O menu do
  card tem **Selecionar card** também. Enquanto há uma seleção, cada card mostra uma caixa que o
  seleciona ou desmarca, e um leitor de tela ouve o estado dela e a contagem.
- **Selecionar pelo teclado** (#1354). Num card, `X` seleciona ou desmarca, e `Shift` com uma seta,
  `Home` ou `End` anda e seleciona o trecho desde o primeiro card escolhido, na ordem do board.
  Enquanto há uma seleção, `M` abre o **Mover para…** da barra e `S` o **Iniciar N**, nunca um card sozinho. `Esc`
  limpa a seleção e deixa o foco no card; sem seleção, faz o que fazia antes (uma tela dividida
  fecha). Um filtro esconde cards mas os mantém selecionados; o que você faz então vale só para os
  cards que aparecem, e a barra diz quantos estão escondidos.
- **A barra de seleção** acima do board mostra "3 selecionados" com **Iniciar N** (os cards que podem
  iniciar), **Parar N** (quando algum deles roda ou espera na fila), **Mover para…** (uma coluna),
  **Descartar…** e **Limpar seleção**. `S` com uma seleção é **Iniciar N**. Iniciar pergunta antes:
  quantos iniciam agora e quantos esperam na fila do host, a janela de 5 horas do host numa assinatura,
  uma linha para cada trava que segura os cards novos (o limite de pausa da cota, um orçamento no limite,
  o host sem memória, o host com novas execuções pausadas), com todos os cards na fila enquanto uma delas segura, e os cards que ficam de fora e por quê. Quando alguns cards esperariam (o host
  está cheio, pausado ou travado) e outro host online tem o mesmo projeto (o mesmo repositório) com
  vagas para todos eles, a confirmação também oferece **Iniciar em <host>**: ela cria cada um desses
  cards nesse host e o inicia lá, depois marca o card daqui "Iniciado em <host> como <card>" e o move
  para **Concluído**. Nada é apagado: mova o card de volta para o **Backlog** para desfazer. Não são
  oferecidos o card cujo modelo nomeia um workflow ou uma persona, o card que espera um bloqueio e o
  card que segura outros: iniciariam de outro jeito lá, ou ir para Concluído liberaria os outros cedo demais.
  Parar também pergunta: o turno de um card rodando é
  interrompido e ele espera em **Precisa de você**, um card na fila volta para o **Backlog**, e worktrees,
  branches e commits ficam. Os cards vão um de cada vez; os que foram saem da seleção, e a barra nomeia
  os que o host recusou. **Atualizar N com a base** aparece quando um card selecionado tem branch e
  não está rodando: depois que a branch base anda, ele faz o rebase desses cards sobre ela, um de cada
  vez, com "Atualizando 2 de 5…" na barra. Um card que já está na base fica como está, e um conflito
  para só aquele card: o host aborta o rebase, então o worktree dele fica como estava. O resumo então
  nomeia os cards atualizados, os já em dia e os com conflito, e os que o host recusou, com o motivo;
  os com conflito e os recusados continuam selecionados. Numa janela estreita a barra diz quantos
  selecionados estão em colunas que não aparecem, e **Mover para…**, **Atualizar N com a base** e
  **Descartar…** ficam sob ⋯. Arrastar um card selecionado arrasta a seleção toda para a
  coluna onde você solta, na ordem do board; solta sobre um card, eles ficam antes dele.
- **O que uma coluna pede de um card** (#78). **Em revisão** pede um link de PR e verificações
  passando; **Em andamento** pede critérios de aceite, um item de checklist (`- [ ] …`) na
  descrição do card. As outras colunas não pedem nada. Um card que não tem algo diz isso nele mesmo
  ("Precisa de: um link de PR"), e enquanto você arrasta um card as colunas que pedem algo dizem o
  quê, com a borda tracejada. Mover um card para **Em revisão** à mão (arrastar, o menu do card ou a
  barra de seleção) pergunta antes e diz o que falta; **Mover mesmo assim** o move, e com vários
  cards uma só janela lista cada card que não tem algo, com **Mover só os que atendem**. **Em
  andamento** só mostra o aviso, nunca pergunta, então começar o trabalho continua sendo um
  movimento. Os movimentos que o app faz sozinho (um PR abre ou é mesclado, uma sessão falha)
  nunca são perguntados. O host guarda os contratos de
  cada projeto e confere também os seus movimentos: um movimento que ele recusaria diz o que falta ao
  card. **Mover mesmo assim** manda o host seguir, e o card guarda um aviso ("Movido para Em revisão
  mesmo assim; faltava um link de PR"). O host nunca recusa o que move cards sozinho: o gerente, a
  sincronização do quadro, a vigia do PR e os eventos de PR.
- **Uma nota de validação e iniciar sem critérios** (#78). Um card tem uma **Nota de validação** nos
  Detalhes: uma ou duas linhas sobre como você conferiu o trabalho. Um projeto pode fazer uma coluna
  pedir isso (um contrato com a verificação `validation`), e o card passa a dizer "Precisa de: uma
  nota de validação". Uma nota vazia mostra o formato de uma nota como dica, nunca salva: um projeto
  confiável pode dar o seu em `.flightdeck/templates/validation.md` no checkout (até 32 KiB), e o
  card diz o motivo quando esse arquivo existe mas não foi usado. **Iniciar** (o menu do card, a seção Executar do card ou a paleta Ctrl+K)
  pergunta antes só num projeto cujo contrato de Em andamento confirma critérios de aceite, e só
  para um card sem eles (nenhum item `- [ ] …` na descrição): **Iniciar mesmo assim** segue. Por
  padrão Em andamento só avisa, então Iniciar não pergunta nada.
- **Um arquivo de especificação** (#78). Um projeto pode fazer uma coluna pedir uma
  **especificação**: o worktree do card precisa ter o arquivo que o card indica,
  `docs/specs/<nome do card>.md`, a menos que você defina outro caminho no campo **Arquivo da
  especificação** do card (um caminho relativo para um arquivo `.md` dentro do worktree). A página do
  card diz o que o host achou ("Especificação encontrada: <primeiro título>" ou "Nenhum arquivo de
  especificação em <caminho>") e **Verificar de novo** olha mais uma vez; um movimento para uma
  coluna que pede isso olha o arquivo antes. O host só confere que o arquivo existe (um arquivo
  comum, não vazio, que não seja um link, dentro do worktree) e lê o primeiro título: nunca lê nem
  envia o resto. Quando um card começa pela primeira vez e o projeto pede uma especificação, o host
  escreve uma a partir de um modelo, como rascunho (`draft: true`, que mantém a verificação sem ser
  atendida até ser completada). Um projeto confiável pode ter o próprio modelo em
  `.flightdeck/templates/spec.md` no seu checkout (`{{title}}` e `{{criteria}}` são preenchidos);
  quando há um modelo que não pode ser usado, o embutido é escrito e o card diz o motivo: o projeto
  não é confiável, o arquivo é um link ou tem um segundo nome, passa de 32 KiB ou está vazio. O aviso
  nunca cita o modelo.
- **Modelos de card** (#1201). Um projeto confiável pode listar modelos de card em
  `.flightdeck/templates/cards.json` (até 32 KiB, 12 modelos): cada um tem um `id`, um `name` e,
  se quiser, `description`, `criteria` (uma lista, escrita como itens `- [ ]`), `workflow`,
  `persona`, `pins` (documentos da biblioteca) e um arquivo de `spec`. O **Novo card** passa a
  oferecer **A partir de um modelo**; escolher um preenche a descrição vazia e diz com o que mais o
  card começa. O card recebe o arquivo de spec e os documentos fixados do modelo, e a página dele
  abre com o workflow e a persona do modelo já escolhidos, quando o projeto e o host ainda os têm.
  Um modelo com erro fica de fora e é contado; um arquivo que não pode ser usado (o projeto não é
  confiável, é um link, é grande demais, está vazio, não é uma lista) é dito no **Novo card** com o
  motivo.
- **Documentos fixados** (#76). Num host com a biblioteca do projeto, a página do card tem o painel
  **Documentos fixados**: escolha um documento da biblioteca (ADRs, RFCs, PRDs, specs) para fixá-lo,
  até 10, e **Desafixar** tira um. Quando o card começa, o primeiro prompt lista cada documento
  fixado que está no worktree do card, com o título, e orienta a sessão a lê-los. Só o caminho e o
  primeiro título vão no prompt, nunca o conteúdo do documento. Um documento fixado marcado como
  obsoleto continua citado: você o escolheu.
- **Um card que o host recusa mover** (por exemplo, concluir um que ainda está rodando) fica onde
  estava, continua selecionado e é citado numa nota com o motivo do host. Os outros se movem.
- **Descartar…** mostra uma só janela com todos os cards selecionados e diz o que vai junto com
  cada um: um worktree ou branch perde mudanças não commitadas e commits não enviados; uma sessão é
  encerrada. Se o host não conseguir descartar um card, a nota diz que ele pode ter ficado
  parcialmente limpo. Cards que nunca começaram são excluídos; os que começaram são
  descartados. Cancelar deixa tudo como estava.
- **Largura das colunas.** A alça na borda direita de uma coluna (arraste-a, ou vá até ela com Tab e
  use as setas, 20 px por vez, ou Home e End; só a alça da última coluna recebe Tab) define uma só largura para todas, entre 180 e 520 px, guardada neste computador. Até você
  definir uma, as cinco colunas dividem a largura da janela (a 1280 px cada uma tem uns 187 px, e janelas
  maiores as deixam mais largas), então nenhuma é cortada na borda direita. Com a janela estreita demais
  para isso, ou depois de você definir uma largura, o board rola dentro de si, nunca a página.
- **Contagens.** Cada coluna mostra quantos cards tem; com um filtro ligado ela lê `n / total`, e
  uma coluna que o filtro esvaziou diz "Nenhuma correspondência" em vez de oferecer um card novo.
- **Card novo numa coluna.** O botão **Novo card** no fim de uma coluna cria o card ali (aparece ao
  passar o mouse e ao focar, e sempre numa tela sem ponteiro).

## Iniciar uma sessão pela tarefa

**Nova sessão** abre em **Primeiro prompt**, com o cursor nele: escreva a tarefa e aperte **Criar
sessão** (ou **Ctrl+Enter**). A pasta, o modo de permissão e o modelo começam como a última sessão
daquele host os usou (**Bypass permissions** nunca: ele pergunta toda vez). O agente, a subpasta, o
nome, o esforço e a persona ficam em **Mais opções**, que abre sozinho para mostrar uma subpasta
lembrada.

Na paleta **Ctrl+K**, uma frase digitada com um projeto no escopo oferece **Iniciar em <projeto>:
<texto>**: **Enter** inicia uma sessão na pasta desse projeto com o texto como primeiro prompt, no
mesmo modo e modelo, e a abre.

## Escolher uma pasta

**Nova sessão** e o formulário do projeto têm um botão **Procurar…** ao lado da pasta. Ele abre
uma janela que lista as pastas **do host** (que pode ser outra máquina), um nível por vez:

- começa nas `allowedRoots` do host e só mostra pastas dentro delas: sem arquivos, sem pastas
  ocultas a não ser que você marque **Mostrar pastas ocultas**, no máximo 500 por pasta;
- um caminho de migalhas nomeia cada passo, **↑** sobe, as setas andam pela lista, **Enter** abre
  uma pasta e **Backspace** sobe;
- **Escolher esta pasta** entrega o caminho ao formulário. Fica desligado, com o motivo ao
  lado, até você abrir uma pasta;
- quando o host é esta máquina, **Escolher no sistema** abre também a janela de pastas do
  sistema operacional. O que ela escolhe é conferido pelo host contra as `allowedRoots`, como
  tudo o mais, e uma pasta fora delas é recusada com as pastas permitidas.

Digitar o caminho continua possível. O comando do host por trás disso é `fs.dirs`; um link
simbólico que leva para fora das `allowedRoots` nem é listado nem seguido.

## Cadastrar um projeto

No app, o botão ▦ ao lado do host abre **Projetos de &lt;host&gt;**. Cada projeto registra:

- **Caminho do repositório:** precisa ser um repositório git dentro de `allowedRoots`.
  **Procurar…** abre o [seletor de pasta](#escolher-uma-pasta).
- **Nome** e **branch base:** em branco, ficam o nome da pasta e a branch atual do repositório.
- **Provedor de PR:** `github`, `azure-devops` ou nenhum.
- **Script de preparação** (opcional, por exemplo `bun install`): roda na worktree antes da
  sessão, com `cmd.exe` no Windows e `sh` nos demais. É o único comando de shell que o
  Flightdeck executa por conta própria, e só existe se for cadastrado. Se falhar, o card vai para
  Precisa de você com a saída do erro.
- **Modelo de instruções:** anexado ao prompt de todo card. O padrão pede para trabalhar só na
  worktree e fazer commits com mensagens descritivas.

Ao iniciar um card, o daemon roda `git worktree add <repo>/.flightdeck/worktrees/<slug> -b
fd/<slug> <base>` e acrescenta `.flightdeck/worktrees/` ao `.git/info/exclude` do repositório
(o `.gitignore` não é tocado). O prompt da sessão é a descrição do card mais o modelo.

## Achar projetos

**Achar meus projetos** (na tela **Projetos**, para hosts que anunciam `projects.scan` e
`projects.clone`) tem duas partes:

- **Procurar nas pastas permitidas** busca repositórios git dentro das pastas permitidas, em dois
  níveis por padrão, até 200 repositórios. Pula pastas ocultas, `node_modules`, links e o
  interior de um repositório já achado, e nunca abre mais de 2000 pastas. Repositórios que já são
  projetos ficam de fora. Marque os que quiser e aperte **Adicionar selecionados**.
- **Clonar a partir de um endereço** roda `git clone` numa pasta dentro das pastas permitidas e
  registra o resultado como projeto. Só entram endereços `https://`, `ssh://` e `usuario@host:caminho`;
  é recusado o endereço que começa com traço, tem espaços, aponta para um caminho local ou usa
  `file://` ou um auxiliar de transporte, assim como um nome de pasta que não seja um nome simples
  ou uma pasta que já exista. O git roda sem pedir senha e para depois de cinco minutos, então um
  repositório privado precisa de chave SSH ou de um credential helper já configurado no host.
  Toda recusa diz o motivo.


## Começar pelo GitHub

Para hosts que anunciam `github` há dois lugares:

- **Hosts, painel do GitHub.** **Entrar com o GitHub** pede ao `gh` do host que inicie o fluxo de
  dispositivo do GitHub. O painel mostra um código de uso único: aperte **Abrir o GitHub**,
  digite o código naquela página e confirme. O painel percebe sozinho e mostra **Conectado como
  <conta>**, onde o login fica guardado (o chaveiro do sistema, o arquivo do próprio `gh`, ou uma
  variável de ambiente do daemon) e as permissões (`repo`, `read:project`). O Flightdeck nunca vê o
  seu token: quem guarda é o `gh`. **Sair** pede ao `gh` que o esqueça; um login que vem de
  `GH_TOKEN` ou `GITHUB_TOKEN` é do ambiente do daemon e não dá para sair por aqui. Se o `gh` não
  estiver instalado no host, o painel avisa; instale e aperte **Verificar de novo**.
- **Projetos, Começar pelo GitHub.** Lista os seus repositórios (ou busque), escolha um e, se
  quiser, uma das issues abertas dele. Escolha a pasta permitida onde clonar e se abre **Um card do
  quadro** ou **Uma sessão**. O host clona o repositório nessa pasta (ou usa o clone que já estiver
  lá), registra como projeto e então:
  - **o card** leva o título, o corpo e o link da issue (uma vez por issue); a issue escrita por
    alguém de fora das pessoas do repositório vem marcada como conteúdo de terceiros e fica sem
    aprovação automática;
  - **a sessão** abre no clone com a issue citada no primeiro prompt, sob a mesma marca quando
    vem de fora.
  Sem issue, só o repositório é clonado e registrado. Uma pasta com esse nome que seja outro
  repositório é recusada, e toda recusa diz o motivo.

Para testar: na página do host aperte **Entrar com o GitHub**, confirme no GitHub; em **Projetos** aperte
**Começar pelo GitHub**, escolha um repositório e aperte **Começar**.


## Sincronização do quadro com o GitHub Projects

Para hosts que anunciam `boardsync` (precisa do `gh` do host conectado, veja **Começar pelo GitHub**), o botão
**Sincronizar** do **Board** de um projeto liga o projeto a um quadro do GitHub Projects (v2):

- **Ligar quadro.** Escolha um dos seus quadros e aperte **Ligar quadro**. Os itens dele viram cards (uma issue guarda o
  link e, quando foi escrita por um estranho, a marca de terceiros e fica sem aprovação automática); o **Status** de cada
  item põe o card numa coluna. Depois disso o host lê o quadro a cada minuto, e **Sincronizar agora** faz isso na hora.
- **Mapa de status.** Cada status do quadro tem uma coluna aqui: por padrão Todo e Backlog para Backlog, In Progress para
  Em andamento, In Review para Em revisão, Done para Concluído. Mude uma coluna e aperte **Salvar mapa**; um status
  *Sem mapa* deixa os cards onde estão. *Precisa de você* não tem par no GitHub, então os cards que vão para lá não são
  enviados.
- **Só leitura por padrão.** Mover um card aqui não muda nada no quadro até você ligar **Enviar minhas mudanças de card ao
  quadro**. Ligar pede confirmação e precisa da permissão `project`; se o login não a tem, a mensagem diz e nada é
  enviado. O envio só muda o Status de itens que já são cards: nunca cria, edita ou apaga um item.
- **Conflitos.** Se um card mudou de coluna aqui e o item mudou lá desde a última sincronização, vale a mudança mais
  recente. Um empate em até dois segundos vai para o quadro quando o envio está desligado e para este lado quando está
  ligado. O valor que perdeu nunca é descartado: o **Registro da sincronização** do card mostra, com os dois horários. Um
  card que está rodando não é movido pelo quadro (o registro diz isso).
- **No card.** **Abrir no quadro** abre o item; *Não está mais no quadro* aparece quando ele foi arquivado ou removido (o
  card fica); o **Registro da sincronização** lista conflitos, movimentos pulados e envios que falharam.
- **Desligar** para a sincronização e mantém os cards, com seus links.

Para testar: entre no GitHub na página do host, abra o **Board** de um projeto, aperte **Sincronizar**, escolha um quadro e
**Ligar quadro**.

## Ciclo do card

- **Em revisão:** o card entra quando um turno termina bem. Um turno com erro, interrompido por
  Parar, ou um pedido de permissão levam a Precisa de você.
- **Conclusão:** Concluir (com confirmação) ou o PR mesclado removem a worktree se `git status`
  estiver limpo. Senão, o card avisa e a worktree fica.
- **Descarte:** Descartar (com confirmação, e um aviso se houver alterações não enviadas)
  remove a worktree e a branch local.
- **A página do card tem um botão que lidera:** o painel Execução mostra o que vem a seguir.
  **Iniciar** para um card que ainda não rodou, **Parar** enquanto roda, **Revisar mudanças**
  quando uma execução termina (mostra as Mudanças do card), depois **Abrir PR** e, com o PR aberto
  e pronto para merge, **Fazer merge do PR** (a confirmação abaixo; enquanto
  uma sessão roda, **Parar** lidera e **Fazer merge do PR** espera no menu, e com checks falhando
  ele não é oferecido). O resto está no menu **Ações** (⋯) ao
  lado: **Iniciar com workflow ou persona…** (o mesmo diálogo do **Iniciar card** do board),
  **Iniciar**, **Iniciar em segundo plano**, **Parar**, **Abrir PR**, **Fazer merge do PR**,
  **Finalizar…** e **Descartar**. Um card cuja execução terminou abre em **Mudanças**. Enquanto uma
  execução espera num portão, **Aprovar** e **Negar** do próprio portão, no alto da página, são
  os únicos botões principais: o painel Execução não lidera com nada até o portão ser respondido.
- **Editar e excluir:** o menu **⋯** do card tem **Editar…**, que abre o card com o título pronto
  para mudar (a página do card também edita a descrição e, com o ROI ligado, a estimativa), e
  **Excluir…**, que cita o card e pergunta antes. Excluir vale só para um card que nunca começou
  (sem worktree, branch nem sessão). Para um que já começou, a janela explica o motivo e oferece
  **Descartar card** no lugar. Os cards que esperavam o excluído ficam livres dele, com um aviso.
- **O selo Precisa de:** de um card do board é um botão. Para o que o texto do card não tem
  (critérios, uma nota de validação, uma especificação) abre o card com o título pronto para
  editar; para um link de PR ou checks abre o card, onde o próximo passo aparece primeiro. Ele não
  é uma parada do Tab: pelo teclado, Enter no título do card abre o card, e **M** e depois
  **Editar** o abre com o título pronto para editar.

## Provedores de PR

Abrir PR faz `git push -u origin fd/<slug>` e depois chama o CLI do provedor, com o título e a
descrição do card:

- **GitHub:** `gh pr create --base <base> --head fd/<slug>`. Estado e checks vêm de `gh pr view
  --json state,statusCheckRollup`.
- **Azure DevOps:** `az repos pr create --source-branch fd/<slug> --target-branch <base>`. Estado
  vem de `az repos pr show`, e os checks das políticas, de `az repos pr policy list`.

Um projeto com o provedor **nenhum** (o padrão de um projeto novo, e o que um repositório sem remote
tem) não tem Abrir PR: o painel do card diz isso, com os passos (defina o provedor nas configurações
do projeto; se o repositório não tem remote, `git remote add origin <url>` antes, depois `gh auth
login` ou `az login`) e a branch em que está o trabalho do card, para enviar à mão. **Revisar
mudanças** continua.

Num host que anuncia `prDetect`, a página do card também lê o provedor do `origin` do repositório
sozinha ao aparecer (e enquanto o provedor do projeto for nenhum), e **Verificar o remote de novo** o
lê outra vez depois de um `git remote add`. Um remote do `github.com` (ou `*.ghe.com`) ou do Azure
DevOps vira o provedor do projeto, um aviso diz isso, e o Abrir PR aparece. Qualquer outro host é
nomeado e deixado como está: o Flightdeck não escolhe um provedor por um nome que apenas contém
"github", então um servidor GitHub Enterprise se define à mão nas configurações do projeto. Se o git
não consegue ler o repositório, a nota diz isso, em vez de mandar adicionar um remote. Um PR que o
host recusa mantém o diálogo aberto com o texto que você escreveu, e o motivo aparece nele.

O CLI precisa estar instalado e autenticado no host do daemon (`gh auth login`, `az login` com a
extensão `azure-devops`). O daemon só o invoca, procurando-o no PATH. O merge segue as regras
do provedor: no GitHub, **Fazer merge do PR** num card com PR aberto (e checks que não estejam
falhando) pergunta antes, com o endereço do PR, os checks e o jeito de fazer o merge (commit de
merge ou squash), e então roda `gh pr merge` com esse jeito e nada mais: sem `--admin`, sem
`--auto`, sem apagar a branch, então os checks e revisões obrigatórios continuam valendo. Se o
GitHub recusar, o card diz por quê (revisão pendente, checks falhando ou ainda rodando, conflito, ou
as palavras do próprio GitHub) com um link para o PR, e o card fica onde está; quando o merge
acontece, o card vai para Concluído. Quando o radar de conflitos do host acha outros cards do projeto
que mudam os mesmos arquivos, o card mostra **Pode conflitar com …** no board, lista esses cards e os
arquivos em comum em **Pode conflitar com outros cards** nos detalhes, e a confirmação do merge os
nomeia. Funciona por uma conexão próxima (este computador ou
Tailscale), e os cards do Azure DevOps fazem o merge no Azure DevOps. Os cards com PR aberto são consultados a cada 60 s, ou a cada
`board.prPollIntervalMs` da config. PR mesclado leva o card a Concluído; fechado sem merge, a
Precisa de você.

## Limite de execuções paralelas

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

- **Pouca memória** (#1343): enquanto a memória em uso do host estiver em `resources.pauseAt` ou
  acima (90% por padrão, o **Crítico** do painel Recursos), um card novo espera com "aguardando
  memória" e começa sozinho quando a memória fica 2 pontos abaixo; o host olha de novo a cada 15 segundos.
  Execuções que já estão rodando nunca são paradas. Troque no painel **Recursos** da página do host
  (**Cartões novos esperam com a memória em**, ou **Nunca**), ou no `config.json`
  (`{ "resources": { "pauseAt": 0.9 } }`, `null` desliga). Quando o host não consegue ler a
  memória, nada espera; o macOS, que conta o cache como memória em uso, não é lido.
- **Pausar novas execuções** (#1404): antes de reiniciar ou atualizar um host, ligue **Pausar novas
  execuções** na página dele (aba Configurações). Cards novos esperam com "aguardando: host
  pausado", à frente de qualquer outro motivo, e as execuções em andamento terminam. O painel e a
  barra de status dizem **Pausado · 2 rodando**, depois **Pausado · ocioso** quando nada roda; o item
  da barra abre o host. **Retomar novas execuções** libera a fila. A pausa fica no `config.json`
  (`"pauseNewRuns": true`) entre reinícios, e só uma conexão próxima (este computador ou a
  Tailscale) pode mudá-la.

## Dependências entre cards

Um card pode ser **bloqueado por** outros cards do mesmo projeto, e a ordem que você guardava de
cabeça fica no board. Abra o card e vá em **Bloqueado por**:

- **Adicionar bloqueio** escolhe entre os cards do projeto; um card que fecharia um ciclo (já espera,
  direta ou indiretamente, por este) não é oferecido, e o daemon também recusa. Um card tem no
  máximo 20 bloqueios.
- Um bloqueio está satisfeito quando o card dele está em **Concluído** (um PR mesclado o leva para
  lá, e o Concluir também) ou, se você escolher "com o PR mesclado", quando o PR dele foi mesclado.
  A escolha é de cada card bloqueado.
- O board mostra **Bloqueado · N** num card que ainda espera (passe o mouse para ver os títulos),
  **Bloqueando N** num card que segura outros e **Desbloqueado** num card cujo último bloqueio
  acabou de terminar. O botão **Bloqueados** nos filtros do board deixa só os cards que esperam. O
  detalhe lista os bloqueios com a coluna e o estado do PR, e a cadeia atrás deles até três níveis
  ("e mais 2").
- **Iniciar** num card bloqueado é recusado com uma frase que nomeia os bloqueios. Nada inicia um
  card bloqueado: nem Iniciar, nem a arena, nem a ferramenta do `flightdeckd mcp` do Claude. Mover
  o card à mão não é bloqueado: move um marcador e não inicia nada, e é o jeito de passar por cima
  do plano. A execução de ajuste de um PR (fase 22) nunca é segurada, porque o PR já existe.
- Com **Iniciar sozinho quando liberar**, o card inicia quando o último bloqueio fica satisfeito,
  pela fila normal (vagas, cota e orçamentos continuam valendo), com o workflow escolhido ali, se
  houver. Sem isso o card ganha a marca **Desbloqueado** e o desktop avisa; a marca some quando
  você inicia o card ou a dispensa. Um card inicia sozinho uma vez só, também depois de reiniciar o
  daemon.
- Um bloqueio **descartado** sai da lista na hora, com um aviso no card, e o card fica liberado:
  nunca fica preso a um card que não existe mais.
- Um card que esperou por bloqueios parte da branch base **como ela está depois que eles foram
  mesclados**: o daemon roda `git fetch origin <base>` e cria a worktree a partir de `origin/<base>`
  quando a base local está atrás dela (um PR mesclado no remoto), e a partir da base local nos
  outros casos (um merge local já a moveu). Ele nunca mexe na sua branch base local. Se o fetch
  falhar, o card avisa e a execução parte da base local.

As dependências ficam dentro de um projeto: entre projetos o vínculo seria um lembrete, não uma
ordem de construção, porque a sessão parte da branch mesclada do bloqueio.
