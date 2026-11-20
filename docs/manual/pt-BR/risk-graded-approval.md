# Aprovação graduada por risco

[Voltar ao manual](../pt-BR.md) · [English](../en/risk-graded-approval.md)

Todo pedido de permissão leva um **selo de risco**, definido por uma lista fixa de regras no daemon (sem IA):
**Risco baixo** (leituras dentro do projeto), **Risco médio** (a maioria dos comandos, escritas dentro do
projeto, tudo que acessa a rede, ferramentas desconhecidas e MCP) e **Risco alto** (por exemplo `rm -rf`,
`git push --force`, `sudo`, substituição de comando, pipe para um shell ou qualquer acesso a caminhos de
credencial). Você pode acrescentar padrões na configuração do host (`risk.extraHigh`); os embutidos não
podem ser rebaixados.

- Um pedido de **Risco alto** fica vermelho e **Aprovar** vira **Segurar para aprovar**: segure o botão por
  2 segundos. O motivo fica escrito sob o botão (não só numa dica). A tecla A não o aprova; N continua negando. O host também confere a espera: recusa a
  aprovação de um pedido de risco alto que não a traga ("Um pedido de risco alto só é aprovado
  segurando o botão."), então nenhum outro cliente consegue pulá-la.
- A bandeja nunca aprova um pedido de risco alto: oferece **Negar** e **Abrir**.
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

## Dispositivos que aprovam

Um host também pode pedir a **prova assinada de um dos seus dispositivos** antes de aprovar um pedido de risco
alto, e antes de qualquer aprovação que grave uma regra ("sempre permitir") e antes de fazer merge de um PR a partir de um cartão. Fica desligado até você
cadastrar um dispositivo: até lá, segurar o botão Aprovar é a única conferência, como antes.

- **Cadastrar.** Abra a página do host e procure **Dispositivos que aprovam**. No terminal do host rode
  `flightdeckd approvers enroll`, digite o **nome** deste dispositivo e o **código de uso único** que ele
  imprime, e aperte **Cadastrar**. O código vale uma vez, por dez minutos. O app cria uma chave que nunca sai
  deste dispositivo e entrega ao host só a metade pública.
- **Adicionar um segundo dispositivo.** Com a proteção ligada, um dispositivo novo é adicionado por um que já
  está cadastrado. No dispositivo novo abra a página do host, digite um **nome** e aperte **Mostrar o texto**:
  ele cria a chave e mostra um texto e um **código** de quatro grupos de quatro caracteres. Copie o texto para
  o dispositivo cadastrado, cole em **Adicionar outro dispositivo** na página do mesmo host e aperte **Ler**.
  O painel mostra o nome, o host e o código. Adicione só se o **código for o mesmo** nas duas telas: o nome é
  só um rótulo. Aperte **Adicionar este dispositivo** e concorde na janela do sistema, que cita de novo o
  código e o host. Cancele a janela e nada muda. O dispositivo novo se lista quando o host o tem;
  **Cancelar** nele apaga a chave.
- **Aprovar.** Com a proteção do host ligada, **Segurar para aprovar** (e a aprovação de uma regra salva)
  pergunta mais uma vez numa janela do sistema, dizendo qual é o pedido e avisando quando a aprovação também salva uma regra. Cancele e nada é enviado;
  o pedido continua aberto. A janela é do sistema, não do app, então uma página mostrada dentro de uma sessão
  não consegue apertá-la.
- **Ver e revogar.** O painel lista cada dispositivo cadastrado com o nome, o app e o endereço de onde
  se cadastrou e a data. **Este dispositivo** marca o que guarda a chave que você usa. **Revogar** tira outro
  dispositivo (ou este, mas nunca o último: só `flightdeckd approvers reset` no host faz isso).
  **Remover a chave deste dispositivo** apaga a chave guardada aqui; o host segue listando o dispositivo até
  que outro o revogue.
- **Um aviso de mudança.** Quando um dispositivo é cadastrado ou revogado em um host, o app avisa. Um
  dispositivo que você não cadastrou daqui vira um alerta com o nome dele: se não foi você, revogue-o na
  página do host. O seu próprio cadastro, e uma revogação que você faz aqui, não são anunciados. Se outro
  dispositivo revoga a chave deste, o aviso diz isso, e este dispositivo não aprova mais lá até ser
  cadastrado de novo. Com a página do host aberta, o aviso aparece nela, com **Dispensar**; senão, é um
  aviso temporário. Um terminal vê as mesmas mudanças: `flightdeckd approvers watch --follow` imprime uma
  linha a cada uma. Hosts mais antigos que este anúncio só são lidos quando você abre a página.
- **Merge de um PR.** Com um dispositivo cadastrado, **Fazer merge do PR** em um cartão pede mais uma
  confirmação em uma janela do sistema. A janela nomeia o PR, o commit da ponta (curto) e a forma (merge
  commit ou squash). Cancele e nada é enviado. Se alguém enviar commits ao PR depois que o app o leu, o host
  recusa o merge e diz que o PR mudou: olhe-o de novo. Um host que ainda não pede o dispositivo no merge mostra
  um aviso na própria página: atualize-o.
- **Ignorar permissões.** Com um dispositivo cadastrado, **Permitir sessões sem pedidos** na página do host pede
  mais uma confirmação em uma janela do sistema, e a janela nomeia o host. Cancele e nada é enviado.
  **Desligar** não pede nada. Em um host que confere isso, uma sessão não consegue mais religar o Ignorar permissões sozinha, porque
  não tem um dispositivo para assinar. Um host que ainda não pede o dispositivo aí mostra um aviso na própria
  página: atualize-o.
- **Pastas permitidas.** Com um dispositivo cadastrado, adicionar uma pasta em **Pastas permitidas** pede mais
  uma confirmação em uma janela do sistema. A janela nomeia a pasta e diz que as sessões poderão rodar nela e em
  tudo o que há dentro dela. Cancele e nada é enviado. Se a pasta digitada for um atalho ou um caminho que aponta
  para outro lugar, o host recusa e diz qual é a pasta de verdade: adicione essa. Um host que ainda não pede o
  dispositivo aí mostra um aviso na própria página: atualize-o.
- **Confiar em um projeto.** Com um dispositivo cadastrado, **Confiar neste projeto** pede mais uma confirmação
  em uma janela do sistema. A janela nomeia a pasta e diz que os hooks e os servidores dela vão rodar sem pedir
  confirmação. Cancele e nada é enviado. Revogar a confiança não pede nada. Um host que ainda não pede o
  dispositivo ao confiar em um projeto mostra um aviso na própria página: atualize-o.
- **Reativar a aprovação automática.** Com um dispositivo cadastrado, **Reativar** em uma sessão suspensa, em
  Aprovações automáticas, pede mais uma confirmação em uma janela do sistema. A janela nomeia a sessão e diz
  que ela volta a aprovar pedidos sem que nenhuma pessoa os veja. Cancele e nada é enviado. O comando
  `flightdeckd autoapprove resume` do terminal é recusado em um host assim e manda fazer isso no app. Um host
  que ainda não pede o dispositivo mostra um aviso na própria página: atualize-o.
- **Um aviso.** Se a proteção estava ligada e o host agora não lista nenhum dispositivo, o painel avisa. Se
  você não zerou no host, alguém com acesso a ele zerou.
- **O que não cobre.** Protege as aprovações feitas pelo app. Quem tem um terminal no host ainda consegue
  zerar, e um pedido de risco médio não pede prova. Um dispositivo que você não
  consegue assinar (por exemplo, o único cadastrado se perdeu) só volta zerando no host e cadastrando de novo.
