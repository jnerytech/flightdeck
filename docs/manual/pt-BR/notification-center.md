# Central de notificações

[Voltar ao manual](../pt-BR.md) · [English](../en/notification-center.md)

O sino à direita da barra superior guarda toda notificação que o app envia: um pedido que
precisa de você, uma sessão que terminou, um alerta de orçamento ou de cota, o resultado de um
PR vigiado, um card desbloqueado. Um selo no sino conta as não lidas.

- Clique no sino para abrir o painel: as não lidas primeiro, depois as mais recentes, em dois
  grupos (Hoje e Antes). Abrir o painel não marca nada como lido.
- Uma linha não lida tem um ponto, o título em negrito e a palavra "não lida" para o leitor de
  tela; uma lida não tem nada disso. O selo conta os pontos. Cada linha diz a sessão, o card ou o
  time e o host, e diz o que pede em palavras ("Pergunta: qual banco usar?"), não o nome da
  ferramenta. Os pedidos repetidos de uma sessão viram uma linha só com a contagem ("3 vezes").
  Uma linha cujo card ou pedido não existe mais avisa e tem **Descartar**.
- Um pedido que ainda espera é respondido na própria linha: o selo de risco, depois **Aprovar** e
  **Negar** (com a linha focada, **A** aprova e **N** nega, como em Precisa de você). Um pedido de
  risco alto é aprovado segurando o botão, nunca por uma tecla. Uma pergunta, um plano, um portão de
  workflow e um pedido de segredo não têm botões: clique na linha para abri-lo. Um pedido respondido
  sai do sino, também o respondido em outro lugar (com o host offline a linha fica, pois nada diz que
  foi respondido). Depois de uma resposta o foco vai para a linha que ocupou o lugar, ou para o título
  do painel.
- Passe o mouse numa linha (ou foque nela) para ver o controle **Marcar como lida**: ele marca
  aquela linha e não abre nada.
- Clique numa entrada para marcar só ela como lida e abrir a tela dela (um pedido abre no card dele;
  um alerta de cota abre o host). Um alerta de orçamento abre os Custos já filtrados pelo host e
  pelo projeto dele, ou pelo cliente; um alerta de time abre Times com esse time em primeiro e
  destacado. A entrada de um card (resultado de um PR vigiado, card desbloqueado) abre o PR no
  navegador quando o card não existe mais.
- No Windows a contagem de não lidas também aparece no botão do app na barra de tarefas, como um
  selo vermelho com o número (`9+` acima de nove). É a contagem do sino, linha por linha: cai
  conforme você lê e some quando a lista está limpa; uma fonte silenciada não gera entrada e não
  soma nada. Ela volta com a contagem na próxima vez que o app abre.
- **Marcar todas como lidas** mantém a lista; **Limpar** esvazia. A lista fica neste computador
  (as 500 mais recentes) e sobrevive a um reinício. Esc fecha o painel.
- Uma linha lida tem **Marcar como não lida** (passe o mouse ou foque nela) para voltar a ela depois.
- As notificações do sistema saem como antes, a menos que você as ajuste (abaixo). A central só
  guarda uma cópia: uma que nunca é enviada (a janela estava em foco) também não entra nela.
- Clique na notificação do sistema de um pedido e o app vem à frente nesse pedido: a sessão abre
  com o foco nele, com a janela minimizada, atrás de outras ou na bandeja. Uma notificação que não
  é de um pedido não abre nada.

## Ajustar as notificações

**Configurações, Notificações** (guardadas neste computador, valem depois de reiniciar):

- **Mostrar notificações** é a chave geral das notificações do sistema e do som; o sino mantém suas
  entradas. Abaixo, uma chave por evento: **Precisa de você** (uma permissão ou uma pergunta),
  **Turno concluído**, **Sessão com erro** (um turno que termina em erro), **Vigia de PR** e
  **Orçamento e cota**. Um evento desligado não envia nada, nem entrada no sino.
- **Silenciar** um host, um projeto ou uma sessão (o menu de uma linha da lista de Sessões:
  **Silenciar notificações** ou **Adiar notificações por 1 hora**). Uma fonte silenciada não envia
  notificação do sistema, som nem entrada no sino. Ela continua em **Precisa de você** e no contador
  da barra lateral: uma permissão bloqueada é estado, não uma interrupção. As sessões silenciadas
  aparecem na lista com um botão para reativá-las; o adiamento termina sozinho.
- **Juntar os workers de um time que terminaram em uma só mensagem** (ligado por padrão): workers
  de um time que terminam em até dez segundos enviam uma notificação, "Time Alpha: 3 workers
  terminaram". O pedido de permissão de um worker ainda notifica na hora, pois alguém precisa
  responder; o coordenador notifica como qualquer sessão.
- **Som**: desligado, o padrão do sistema (um tom curto feito pelo app) ou um arquivo que você
  escolhe (MP3, WAV, OGG, M4A, AAC ou FLAC, até uns 400 KB), com um volume. Toca no app, nunca num
  host.
- **Enviar notificação de teste** mostra uma e diz **Entregue** ou **Não exibida**; quando o
  sistema não a mostrou, cita a configuração do Windows (Configurações, Sistema, Notificações,
  Flightdeck).
- O modo simples mantém sua única chave e nenhum desses controles.
