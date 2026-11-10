# Projetos

[Voltar ao manual](../pt-BR.md) · [English](../en/projects.md)

O item **Projetos** da barra lateral (entre Precisa de você e Board) lista os projetos do host
escolhido no seletor da barra do topo (os de todos com **Abas de todos os hosts**) como cartões,
para que abrir um nunca leve a outro host: nome, host, branch base, sessões ativas, cards em andamento, os que
precisam de você, a última atividade e quanto custou nos últimos sete dias. O custo aparece como
um traço quando o host não informa custos. Digite na busca para filtrar por nome, host, branch ou
pasta, e use **Ordenar por** para ordenar por última atividade, nome, custo da semana ou o que
precisa de atenção primeiro.

**Novo projeto**, no alto à direita da página, adiciona um projeto: abre o formulário de adição (as
pastas das sessões recentes, uma pasta digitada ou escolhida, **Adicionar**) e a página do projeto
abre quando ele é adicionado. Com um host online, ou com o filtro de host ligado, o formulário é
daquele host; com vários hosts online ele pergunta primeiro qual ("Em alfa", "Em beta"). Sem
nenhum host online o botão fica desligado e diz isso.

Clique em um cartão para abrir a página do projeto. Ela leva ao **Board**, às **Sessões** (a lista, filtrada pelo projeto: um chip "Projeto: nome" com × limpa o filtro), aos
**Workflows**, aos **Custos** (quando o host informa custos) e às **Configurações** (as
configurações de projetos do host, onde se editam pasta, branch base, setup e personas) do projeto.

## Mover uma sessão para outro host (prévia)

Uma sessão ociosa pode continuar em outro host: a conversa, os commits e as mudanças ainda não commitadas vão junto. É uma prévia, desligada por padrão: ligue em Configurações, Janela, "Prévia: mover uma sessão para outro host".

1. No menu da sessão (o "…" na linha dela), escolha **Mover para outro host…**.
2. Escolha o host e o repositório lá: aperte **Procurar…** para escolher entre as pastas que esse host permite, ou digite o caminho. Tem de ser o mesmo projeto, então esse host já precisa ter um clone dele.
   Se um dos hosts é alcançado por `ws://` puro e não é esta máquina, um aviso o nomeia: a conversa e o código passam pelo app sem criptografia, então mova só por uma rede em que você confia.
3. Leia o que vai: a branch, os commits ainda fora do origin, os arquivos alterados, o tamanho e quantas linhas parecem segredos. Os segredos em si nunca aparecem, e eles vão como estão.
4. Aperte **Mover** e depois **Abrir lá**. Depois que todos os bytes foram enviados, você pode fechar a janela: quando a mudança termina, um aviso diz isso, com **Abrir lá**, ou diz por que foi recusada.

No outro host o código fica numa worktree nova desse repositório, numa branch própria, e a sessão continua de onde parou. A sessão daqui é arquivada, com a conversa guardada: agora ela vive no outro host. Dá para movê-la de volta depois: este host a aceita quando a cópia que ficou aqui não tem nada que a sessão movida não tenha e não está em uso, e guarda essa cópia ao lado como `<id>.jsonl.replaced-<data>`, sem apagá-la. Se você continuou a cópia daqui depois da mudança, a volta é recusada: abra a que está aqui. Arquivos guardados no Git LFS chegam como ponteiros: rode `git lfs pull` na worktree para buscá-los. Links simbólicos no código chegam como links, como em qualquer clone do repositório de outra pessoa: uma escrita através de um deles pode cair fora da worktree, então mova sessões só entre hosts em que você confia.

## Dormir sessões ociosas

Uma sessão ociosa mantém seu processo do Claude Code, e a memória dele, até terminar. Na página do
host, **Dormir sessões ociosas após** (Desligado, 15 minutos, 30 minutos, 1 hora ou 4 horas;
desligado por padrão, e `sessions.sleepAfterMinutes` na configuração do daemon) deixa o host
encerrar o processo de uma sessão ociosa por esse tempo. A sessão continua em todas as listas como
**Dormindo** (uma lua) e guarda a transcrição, o nome e o lugar; a próxima mensagem a inicia de
novo de onde estava, sem perda visível. Só dorme a sessão sem nada acontecendo: não a que está
trabalhando ou esperando você, nem uma com mensagem na fila, aberta numa aba ou observada pelo app,
nem uma fixada, nem a de um card. **Dormir agora** no menu de uma sessão faz isso na hora para uma
sessão ociosa (ainda recusa uma fixada ou de card). Cada sono fica registrado nos eventos da
sessão. Com a opção desligada o daemon não mantém timer para isso, e reiniciar o daemon deixa as
sessões ociosas dormindo do mesmo jeito.

## Sessões lado a lado

Quando o projeto tem sessões iniciadas pelo Flightdeck, a página as mostra como **blocos**. O
controle **Disposição** acima deles é uma fileira de ícones que desenham a grade: 2 lado a lado, 3
colunas, grade 2×2, grade 2×3 e **Automática** (o padrão), que mostra todas as sessões ativas.
Passe o mouse num ícone para ver o nome; a escolha fica guardada. Quando a disposição comporta menos
blocos do que há sessões ativas, a página diz quantas ficaram de fora ("+2 fora da tela"). As sessões que precisam de
você vêm primeiro, depois as rodando, depois as ociosas. Cada bloco tem o nome da sessão (um botão
que a abre), o status, as **últimas linhas**, o **pedido** que ela espera (com **Permitir** e
**Negar**) e uma caixa de mensagem pequena: **Enter** envia, **Ctrl+Enter** quebra a linha, e o
ícone de envio aparece quando há texto. Pelo teclado, Tab chega a cada bloco e **Alt+setas** movem
entre eles (esquerda e direita de um em um, cima e baixo uma linha). Os blocos acompanham as
sessões ao vivo; a lista é a do projeto, então uma sessão de outro projeto nunca aparece aqui.

## A barra lateral, a barra de abas e as Configurações

- A barra lateral agrupa os itens por finalidade, em cinco grupos que dobram: **Trabalho** (Início, Sessões,
  Precisa de você, Projetos, Board), **Automação** (Workflows, Times, Conversas),
  **Observabilidade** (Custos, Histórico), **Biblioteca** (Personas, Snippets, Plugins, Cofre) e
  **Máquinas** (os hosts, cada um com o pontinho de estado, a marca de saúde e o menu, um **+** para
  adicionar, e depois **SSH**, os destinos SSH salvos). A página aberta tem a linha preenchida e uma
  barra na borda esquerda, os itens com subpáginas terminam em uma seta, as novidades levam um selo
  **Beta** ou **Novo** que some sozinho na versão em que foi marcado para acabar (o Beta de
  Equipes acaba na 0.39, o Novo de Conversas na 0.38). Um grupo sem nada a oferecer não aparece, os grupos dobrados são lembrados (um grupo **Máquinas** dobrado mostra
  uma marca de aviso no título enquanto uma máquina está offline, sem uma dependência obrigatória ou
  repassando a chave de API), e o trilho estreito de ícones não tem títulos.
- Em **Projetos**, cada projeto do host do seletor (de todo host online com **Abas de todos os
  hosts**) lista seus **branches**: o checkout principal
  (selo **principal**, o branch base) e uma linha por card que tem worktree, cada uma com o pontinho
  de estado, o branch e a base logo abaixo. Escolher um reduz o board e a lista de Sessões àquele
  checkout (um chip com o branch limpa); escolher de novo também limpa. Escolhido na lista de Sessões, ele reduz a lista ali mesmo, sem abrir o board; de outro lugar, abre o board do projeto. Uma escolha cujo branch, projeto ou host sumiu não faz nada e não mostra chip. A árvore vem do que o app já
  tem, sem mudar o host. Um projeto com muitas worktrees lista as 8 primeiras e um botão **mais N**
  (e **Mostrar menos**) para o resto; o branch escolhido sempre aparece. O nome do projeto dobra
  seus branches (as setas esquerda e direita dobram e desdobram); a dobra é lembrada neste
  computador, e um projeto dobrado que guarda o branch escolhido mostra uma marca no nome.
  No trilho estreito de ícones, que não tem espaço para a árvore, o ícone de **Projetos** a abre num
  painel ao lado do trilho (a mesma árvore, com **Todos os projetos (N)** sempre no fim): escolher um
  branch ou esse link fecha o painel, Esc ou apertar o ícone de novo também fecha, e o foco volta para
  o ícone. Sem nenhum projeto para listar, o ícone abre a página de Projetos como antes.
  A árvore lista no máximo 5 projetos: os que você **fixou** (o alfinete na linha do projeto), depois
  os de atividade mais recente, e sempre o projeto do branch escolhido. Abaixo deles, **Todos os
  projetos (N)** abre a página de Projetos. Com mais de 5 projetos, um campo **Filtrar projetos**
  reduz a lista pelo nome a todas as combinações (Esc limpa). Com mais de 3 projetos, todos menos o
  ativo começam dobrados; o que você dobra ou desdobra é lembrado, e um projeto dobrado com uma
  sessão rodando ou que precisa de você mostra um pontinho no nome. Os alfinetes ficam neste
  computador.
- No pé da barra, **Configurações** é um item visível (marcado enquanto as Configurações estão
  abertas), e a conta do Claude (e-mail e plano, lidos do cartão da conta do host; o trilho mostra só
  a inicial) abre um menu. O cabeçalho dele diz o nome do app e a versão. Depois vêm o plano, a conta
  e o id do host dessa conta, cada um copiado ao ser escolhido; **Linhas compactas**, uma chave
  guardada neste computador (a mesma densidade das Configurações); mais três chaves guardadas neste
  computador, **Ocultar os selos Novo e Beta** (os selinhos dos itens recentes da barra), **Ocultar as
  novidades** (o ponto e o item logo abaixo) e **Esconder a lista de configuração inicial** (o
  mesmo do botão de esconder na linha dela; **Mostrar a lista de configuração inicial** nas
  Configurações a traz de volta); **Configurações**; **Novidades** (os
  destaques das últimas versões, lidos do GitHub por um host que consiga; a linha da conta e este item
  ganham um ponto, e o nome da linha avisa, depois que o app foi atualizado, até você abrir; em tela
  cheia numa janela estreita; **Ver todas as versões** abre o GitHub); **Procurar
  atualizações** (abre as Configurações, onde a resposta aparece); **Atalhos de teclado**; **Alternar
  tema**; **Manual**; e, para cada host cujo `gh` está conectado ao GitHub com um login que o app pode
  remover, **Sair do GitHub** (após uma confirmação; um login que vem do ambiente do daemon é removido
  lá). Com vários hosts aparece a
  conta do host aberto, e quantas contas há quando diferem; um host offline não mostra nenhuma.
- O **Início** (primeiro em Trabalho) é uma faixa de quatro cartões com os últimos sete dias de todos
  os hosts online, cada um com um gráfico pequeno: **Gasto** (com o orçamento mensal dos hosts, quando
  há), **Turnos** (ok e com falha), **Tokens** (com o que veio do cache) e o **turno médio** (custo,
  tempo e taxa de sucesso). Gasto, Tokens e o turno médio abrem Custos nos mesmos sete dias (em todos
  os hosts quando vários têm custos); Turnos abre o Histórico do host, nos mesmos dias, quando há um
  host online, e Custos em todos eles quando há vários (o Histórico é de um host). Um host que não
  tem custos mostra "—" em Gasto e Tokens, não US$ 0, e o cartão o cita; o custo médio conta só
  sessões gerenciadas, ao contrário do Gasto, que lê todas as transcrições, e o cartão diz isso.
  Enquanto os hosts ainda estão conectando na abertura, o Início diz "Conectando aos seus hosts…"
  numa região viva, e "O Início está pronto." é anunciado quando os números chegam. Os turnos com falha e o tempo do turno são contados pelo daemon a partir
  desta versão: um host com daemon mais antigo mostra "—" em vez de um zero inventado, e os dias
  anteriores à atualização são desconhecidos (o tempo médio e a taxa de sucesso usam só os turnos
  que foram contados). O Início lê de novo a cada minuto e quando a janela volta ao foco; um host
  que não responde é citado sob o título e os outros continuam contando. O Início guarda os últimos
  números de cada conjunto de hosts, na memória e no armazenamento local do app (só números e a hora
  da leitura, sem projeto nem título), e os mostra na hora com uma linha "Atualizado há …" enquanto
  lê de novo em segundo plano; um host que não responde mantém os últimos números dele, e a página
  avisa. O app abre no Início
  quando a janela é nova; uma janela que você já usou volta com as abas dela. A conta no pé da
  barra é a do host em que você está; sem host aberto, é a conta que os hosts online dividem, ou
  "N contas" quando diferem.
- **Dados de** (#126): com dois hosts ou mais, a barra do Início tem um menu que diz de quem são os
  números mostrados, **Todos os hosts**, um host ou um projeto do grupo **Projetos** (esse projeto
  em todos os hosts, com o nome no subtítulo), e os troca; a escolha fica guardada entre
  aberturas, e a troca é anunciada ("Mostrando alfa"). Não é o seletor de host do topo, que é das
  abas. Quando o host escolhido está offline, o Início diz isso e oferece **Mostrar todos os
  hosts**; um host cujo daemon precisa de atualização diz isso no lugar, e o menu não o oferece. Os
  Custos também o seguem (veja **Custos e orçamentos**), e as Sessões também (o filtro
  de host próprio delas, se você tinha um, vira a escolha uma vez); o Board passa a segui-lo numa
  versão seguinte.
- As abas têm uma linha própria sob a barra do topo, sobre cada área (com a tela dividida, cada área
  tem a sua). São planas, como no VS Code: linhas finas as separam, cada uma tem a largura do título
  (depois o título é cortado e a dica o mostra inteiro), as inativas ficam mais apagadas e a ativa
  tem o fundo da tela com uma linha de destaque em cima. Numa janela com menos de 600 px de altura,
  as abas da área única ficam na linha da barra do topo, para a janela pequena ter espaço para a
  conversa. A barra mantém três ferramentas: o menu de **Ações** da aba ativa (mover para a esquerda
  ou a direita, mover para a outra área, fixar), **Nova aba** e **Dividir**.
- O caminho na barra do topo nomeia cada passo numa janela de 1024 px ou mais. De 640 a 1023 px ele
  mostra só o passo em que você está (o caminho inteiro está na dica e é lido pelo leitor de tela);
  abaixo de 640 px ele não é desenhado, porque o cabeçalho da própria página traz o título.
- O seletor de host na barra do topo mostra o nome do host numa janela de 1024 px ou mais. Abaixo de
  1024 px ele mostra o ponto de cor do host e a primeira letra do nome (o leitor de tela continua
  lendo o nome inteiro). Abaixo de 640 px **Voltar** e **Avançar** saem da barra do topo e ficam no
  alto da gaveta da barra lateral, que uma navegação fecha.
- Enquanto um pedido espera por você numa sessão, o cabeçalho da sessão, o aviso de pasta sem
  confiança e o resumo ocupam uma linha cada, para o pedido aparecer inteiro; **Mais ações** e o
  botão do resumo abrem o resto.
- As **Configurações** têm um trilho com as suas seções (leva até a seção e põe o foco nela) e uma
  caixa de busca: ao digitar, ficam as seções cujo nome ou configurações combinam.
- **Custos** mostra quatro blocos acima dos gráficos: o custo estimado, os tokens, a economia do
  cache e o modelo principal com o que ele custou.
- **Enquanto você esteve fora** (no topo de **Precisa de você**) resume o que aconteceu nos seus
  hosts desde a última vez que o app esteve ativo, quando isso foi há pelo menos 30 minutos: por
  host, as sessões que terminaram, os cards que chegaram à revisão, os PRs com merge feito ou com
  checks falhando, as execuções de workflow que falharam e a cota usada. Cada linha leva à sessão
  ou ao card; um grupo mostra as três primeiras linhas e diz quantas faltam. Um host que não
  respondeu é citado. Só aparece quando há novidade, e **Dispensar** o fecha até o próximo início (o foco vai para o primeiro item da lista, ou para o
  título da página quando não há nenhum).
- **Pull requests** (na barra lateral, em Trabalho, depois de Board; ou **Ir para Pull requests**
  na paleta) lista todo card com PR aberto nos hosts conectados, primeiro os que pedem atenção
  (checks falhando, conflito, mudanças pedidas, ou uma vigia que precisa de você). Cada linha diz o card, o host e o projeto, os
  checks, se **Vigiar e consertar** está desligado, vigiando ou precisa de você, e um link para o
  PR. **Fazer merge do PR** pergunta antes, com a mesma confirmação da página do card, e só aparece
  quando o host faz merge e os checks não estão falhando; **Atualizar com a base** faz o rebase da
  branch do card, e um conflito fica na tela com os arquivos. Com dois ou mais PRs que podem ser
  atualizados (com branch, e sem estar rodando), **Atualizar N com a base** acima da lista atualiza
  todos, um de cada vez, cada um no seu host, como a barra de seleção do board: um PR que já está na
  base fica como está, um conflito para só aquele card, e uma linha nomeia os atualizados, os já em
  dia e os com conflito. Sob o botão, uma linha nomeia os PRs da lista que ficam de fora e por quê
  (sem branch no host, ou rodando). O título abre o card. Uma linha sob o título diz a revisão
  (aprovado, mudanças pedidas, revisão pendente) e há quanto tempo o PR está aberto, como a checagem
  de PRs do host informa (a cada cerca de um minuto); um host que não informa, ou que ainda não
  checou, não acrescenta nada. Um PR que conflita com a base não tem **Fazer merge do PR** (o GitHub
  o recusaria): o conflito é um selo ao lado dos checks, **Atualizar com a base** passa a liderar, e
  um card sem worktree aqui diz para atualizar a branch com a base. Um PR bloqueado pelas regras da
  branch, ou que espera uma revisão ou mudanças, mantém **Fazer merge do PR** como botão secundário
  e diz por que o GitHub pode recusá-lo.
- **Atividade** (na barra lateral, depois de Custos; `g a`, ou **Ir para Atividade** na paleta)
  mostra todas as sessões ao vivo de todos os hosts em quatro colunas: **Precisa de você** (a
  sessão está pedindo algo), **Trabalhando**, **Concluídas** (um turno terminou nas últimas 2 horas
  e você ainda não abriu a sessão) e **Ociosas**, que fica escondida até você marcar **Mostrar
  sessões ociosas** (a escolha é guardada). Um card diz a sessão, o projeto, o host e a persona, o
  último pedido e há quanto tempo mudou; a mudança mais recente vem primeiro. Um card que está
  pedindo mostra o pedido com **Aprovar** e **Negar** (um de risco alto se aprova segurando o
  botão; uma pergunta para você só abre a sessão). Um clique abre a sessão; Ctrl+clique ou o botão
  do meio a abre numa aba nova. A busca e as listas de Host, Projeto e Persona reduzem os cards, e a
  contagem diz "n de m mostradas". Quando uma sessão muda de estado, o card desliza para a outra
  coluna (não com movimento reduzido). O quadro rola dentro de si. O modo simples não tem esta tela.
