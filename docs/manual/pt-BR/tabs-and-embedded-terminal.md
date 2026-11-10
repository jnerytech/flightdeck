# Abas e terminal embutido

[Voltar ao manual](../pt-BR.md) · [English](../en/tabs-and-embedded-terminal.md)

## Abas

Toda tela abre numa aba, como num navegador. Cada aba tem o próprio histórico de voltar e avançar.

- **Abas por host:** cada host guarda as próprias abas. Escolher um host na barra do topo troca a
  fileira pelas abas desse host e volta para a aba que ele tinha aberta (um host sem aba abre a
  Visão geral). Abrir uma tela de outro host (um resultado de busca, uma notificação, um link)
  muda para esse host. As telas que não são de nenhum host (Início, Sessões, Precisa de você,
  Projetos de todos os hosts, Configurações e semelhantes) ficam à esquerda de toda fileira como
  abas fixas só com o ícone, e a barra do topo continua mostrando o último host usado enquanto uma
  delas está aberta. `Ctrl+Tab` percorre as abas compartilhadas e depois as do host atual.

- **Títulos e nomes das abas:** a aba de um host não repete o nome do host no título: a aba da
  Visão geral diz **Visão geral** e a do Histórico diz **Histórico**. Um leitor de tela ainda ouve o
  host: cada aba do host tem um nome como "Board, host alfa", e escolher um host diz "alfa: 5 abas"
  uma vez, sem interromper.

- **Janelas estreitas:** com menos de 640 px de largura a fileira é um botão só, não uma faixa para
  rolar. Ele mostra a aba atual (o ícone, o título e o ponto do host) e quantas abas estão abertas; abre
  a lista de todas as abas na largura da janela, onde um toque vai até a aba. O **+** ainda abre uma
  aba nova; os botões de dividir não são oferecidos. Um leitor de tela ouve "Todas as abas (5), atual:
  Board, host alfa".

- **Abas de todos os hosts:** o seletor de host tem uma entrada, **Abas de todos os hosts**, para quem
  trabalha em vários hosts ao mesmo tempo. Marcada, a fileira lista as abas de todos os hosts depois
  das compartilhadas, em um grupo com o nome e o ponto do host, cada aba na cor do seu host. Escolher
  uma aba de outro host troca para esse host, e o seletor acompanha. Desmarcada, a fileira volta a ser
  a do host atual. A escolha é guardada. A entrada aparece com dois hosts ou mais.

- **Cores dos hosts:** cada host tem uma de oito cores, a mesma em todo lugar em que ele aparece. É
  um ponto ao lado do nome do host no seletor da barra do topo e na lista de todas as abas, e uma
  linha de 2 px no alto de cada aba do host. A cor nunca é o único sinal: o nome do host fica ao lado
  de cada ponto, e as cores mantêm 3:1 contra as superfícies no tema claro e no escuro.

- **Abrir:** o clique normal troca a aba atual. `Ctrl+clique`, o botão do meio do mouse ou **Abrir
  em nova aba** (no menu do host e no menu de uma linha de sessão) abre uma nova. O botão **+** no
  fim da barra abre uma aba nova na paleta `Ctrl+K`. Uma tela tem uma aba só: um link para uma
  tela que outra aba já mostra (uma trilha, um link da página, reabrir um terminal rodando) vai
  para essa aba em vez de abrir uma segunda.
- **Todas as abas:** passando de oito abas, a seta no fim da barra abre a lista de todas: cada
  linha tem o ícone da aba, o título numa linha só (o título inteiro na dica), o host e um botão
  de fechar ao passar o mouse. A aba na tela tem uma barra à esquerda. Digite para filtrar; as
  setas, `Home` e `End` movem o destaque, `Enter` vai para a aba e `Delete` a fecha. `Esc` ou um
  clique fora fecha a lista.
- **A barra:** cada aba mostra o ícone do tipo e o título, e um selo quando uma sessão nela
  precisa de você, está rodando ou respondeu sem nenhuma aba mostrando (**Não lida**). **Fixar**
  deixa a aba à esquerda, só com o ícone. Os botões de fixar, mover e fechar, depois das abas,
  agem na aba ativa; o botão do meio fecha qualquer aba. Arraste uma aba sobre outra para reordenar. Durante o arrasto, uma barra marca onde a aba vai cair. A ordem fica guardada entre as sessões.
- **Atalhos:**

  | Atalho | Ação |
  | --- | --- |
  | `Ctrl+T` | aba nova, na paleta |
  | `Ctrl+W` | fecha a aba |
  | `Ctrl+Shift+T` | reabre a última fechada (guarda as últimas 20) |
  | `Ctrl+Tab` (segure `Ctrl` e aperte `Tab` de novo para descer) / `Ctrl+Shift+Tab` (subir) | abre o seletor com as abas mais recentes da área com o foco, na anterior; solte o `Ctrl` para ir à selecionada, `Esc` ou sair da janela cancela. Um toque rápido vai à aba anterior, e outro toque volta |
  | `Ctrl+1`…`Ctrl+9` | vai para aquela aba (`Ctrl+9` é a última) |
  | `Ctrl+Shift+PageUp` / `PageDown` | move a aba ativa para a esquerda ou a direita |
  | `Ctrl+Shift+←` / `→` (numa aba com o foco) | move essa aba para a esquerda ou a direita; o leitor de tela ouve a nova posição |
  | `Ctrl+\` | divide a tela ou junta as áreas |

  Em Configurações, Aparência, **Ordem do Ctrl+Tab** escolhe **Mais recente primeiro** (o padrão)
  ou **Ordem das abas**, em que `Ctrl+Tab` e `Ctrl+Shift+Tab` vão para a próxima e a anterior como
  antes. O seletor é uma lista para leitores de tela (a aba selecionada é anunciada); a lista não é
  guardada entre execuções.

  Na entrada web do demo, o Chromium fica com `Ctrl+T`, `Ctrl+W`, `Ctrl+Shift+T` e `Ctrl+Tab`:
  lá, use os botões.
- **Guardadas entre aberturas:** as abas, quais estão fixas, a aba ativa, a divisão e o divisor
  voltam quando o app abre de novo. Cada aba volta na sua tela, sem o histórico. O formulário de
  host nunca é guardado, porque pode ter um token. A aba de um host que ainda não conectou mostra
  **Conectando a <host>…** até conectar.

## Tela dividida

`Ctrl+\` ou **Dividir a tela** (no fim da primeira barra de abas) divide a janela em duas áreas,
lado a lado; **Dividir na horizontal** as empilha, e **Juntar as áreas** devolve todas as abas a
uma só. Cada área tem a sua barra de abas.

- A área nova começa na tela da aba ativa.
- Um clique numa área a deixa em foco: o que você abre pela barra lateral, pela paleta ou por um
  link vai para ela.
- Arraste o divisor, ou dê foco a ele e use as setas, para dar a uma área de 20% a 80% da janela.
- **Mover a aba para a outra área** leva a aba para o outro lado; a área que fica vazia fecha.

## Terminal embutido

O daemon a partir da versão 0.14 abre terminais de verdade (um PTY) no host, e o app os mostra
numa aba, sem SSH.

- **Ligado ou desligado:** um terminal é um shell completo no host, com o usuário do daemon. Ele
  vem ligado só quando o daemon escuta em loopback; com `bind` aberto a outras redes, vem
  desligado. O painel **Terminal** da página do host liga (pergunta antes) ou desliga (encerra os
  terminais abertos); o daemon grava a escolha em `terminal.enabled` da config.
- **Abrir:** **Novo terminal** na página do host, ou **Novo terminal em <host>** na paleta, abre o
  shell padrão do host (`pwsh` ou `powershell` no Windows; `$SHELL`, `bash` ou `sh` no Linux) na
  primeira pasta permitida. O painel também lista os terminais vivos, cada um com **Abrir**.
- **Na aba:** copiar e colar com `Ctrl+Shift+C` / `Ctrl+Shift+V` ou com o menu do botão direito
  (**Copiar**, que precisa de uma seleção, **Colar** e **Selecionar tudo**). No Windows `Ctrl+C`
  também copia enquanto há algo selecionado, e vai para o processo (a interrupção) quando não há;
  nos outros sistemas `Ctrl+C` sempre vai para o processo. Um programa que redesenha a tela (o
  Claude Code) pode soltar uma seleção antes de você chegar em **Copiar**: a última seleção
  continua copiável até você digitar. Quando o programa toma o mouse para si, segure `Shift` ao
  arrastar para selecionar. `Shift+Enter` adiciona uma nova linha no prompt do Claude Code em vez
  de enviá-lo (o mesmo que `Alt+Enter`). Se blocos cinza de uma tela antiga ficarem no painel
  lateral do Claude Code, é o Claude Code deixando células sem limpar (acontece também em outros
  terminais): `Ctrl+L` ou redimensionar o painel faz ele redesenhar. Colar várias linhas num programa que não pediu que o texto colado venha
  marcado (bracketed paste; um prompt de shell comum, por exemplo) pergunta antes, já que cada linha
  pode rodar como comando assim que chega; Cancelar fica com o foco. O Claude Code pede a marcação,
  então colar nele entra direto. Buscar com `Ctrl+Shift+F`: os resultados ficam destacados enquanto você digita, o
  atual em outra cor e sua posição ("2 de 5") ao lado da caixa; Enter ou **Próximo resultado**
  vai para o próximo, Shift+Enter ou **Resultado anterior** para o anterior, Esc ou **Fechar
  busca** fecha. Ao lado da caixa, **Diferenciar maiúsculas e minúsculas** (`Alt+C`), **Palavra
  inteira** (`Alt+W`) e **Usar expressão regular** (`Alt+R`) estreitam a busca; uma expressão que
  não se lê, ou que casa com texto vazio, avisa em vez de buscar. Links na saída abrem no navegador
  (só `http` e `https`). Caminhos de arquivo na saída também são links: os absolutos
  (`C:\repo\a.md`, `/home/ana/x.log`) e os relativos com pasta e extensão (`src/app.ts:12`), lidos a
  partir da pasta do terminal. Um arquivo dentro da pasta do terminal abre embaixo dele no
  visualizador de Arquivos, só leitura, na linha que o caminho diz (`src/app.ts:12` abre na linha
  12); **Fechar** o guarda. Um caminho fora dessa pasta, ou num host com daemon antigo demais para lê-lo, é mostrado na
  pasta num host deste computador (nunca aberto nem executado) e copiado em outro host. A fonte é a
  monoespaçada do sistema; o tamanho fica nas Configurações (**Tamanho da fonte do terminal**, de
  10 a 24). Na aba, `Ctrl+=` (ou `Ctrl++`) e `Ctrl+-`, ou `Ctrl` com a roda do mouse, aumentam ou
  diminuem um ponto, e `Ctrl+0` volta para 13; o tamanho é a mesma configuração e fica guardado. Para
  um leitor de tela (NVDA, Narrador), ligue **Suporte a leitor de tela no terminal** nas
  Configurações: o terminal passa a manter uma cópia da saída que o leitor acompanha (saída longa
  demora mais para aparecer, por isso começa desligado). A
  aba guarda as últimas 10.000 linhas para rolar e buscar.
- **Desanexar e reabrir:** o terminal sobrevive ao app: guarda os últimos 2 MB de saída, e anexar
  de novo os mostra. Fechar a aba de um terminal pergunta: **Desanexar** (o padrão; o processo
  continua no host) ou **Encerrar processo**. Um terminal desanexado ou encerrado tem **Reabrir**.
- **Limites:** 10 terminais vivos por host (`terminal.max`), e um terminal sem ninguém anexado é
  encerrado depois de 120 minutos (`terminal.idleMinutes`). Os terminais não sobrevivem a
  reiniciar ou atualizar o daemon. O conteúdo nunca vai para o log nem para o banco.
- **Rolar o Claude Code:** no modo tela cheia do Claude Code a roda do mouse vai para o Claude Code,
  que anda conforme o próprio `CLAUDE_CODE_SCROLL_SPEED`. Os terminais abertos pelo app o põem em 3
  linhas por clique da roda, como no Windows Terminal e no VS Code, a menos que o ambiente do host ou
  as configurações do Claude Code (onde o `/scroll-speed` a guarda) já definam uma velocidade: aí
  vale essa.

## Claude aqui

Com os terminais do host ligados, todo botão **Abrir no terminal** (sessão, card, projeto,
checkpoint) ganha um companheiro:

- **Abrir Claude aqui (terminal)** abre o `flightdeckd claude` na pasta (a worktree, num card)
  numa aba de terminal. A sessão nasce na central, controlável: você aprova e manda mensagens pelo
  app enquanto vê o terminal.
- **Continuar no terminal** retoma uma sessão com `flightdeckd claude --resume <id>`; as sessões
  do terminal encerradas e as do histórico o têm no leitor.
- A aba de terminal dessa sessão tem **Ver como sessão**, e a sessão tem **Ver terminal**: as duas
  são o mesmo Claude, ligadas pelo id do lançamento.

O terminal de fora ([Abrir no terminal](daily-use.md#abrir-no-terminal)) continua ao lado.

Quando a sessão já está ao vivo em outro terminal (o do VS Code, por exemplo), **Continuar no
terminal** e o terminal de fora perguntam antes: um segundo `claude` na mesma sessão não seria
visto pelo primeiro. Cada um mostra só os próprios turnos, e os dois escrevem no mesmo histórico.
**Ver ao vivo aqui** (o padrão) abre a visão ao vivo da sessão, que segue a transcrição daquele
terminal; **Abrir outra cópia mesmo assim** abre aqui do mesmo jeito.
