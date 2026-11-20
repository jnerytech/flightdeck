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
alto, e antes de qualquer aprovação que grave uma regra ("sempre permitir"). Fica desligado até você
cadastrar um dispositivo: até lá, segurar o botão Aprovar é a única conferência, como antes.

- **Cadastrar.** Abra a página do host e procure **Dispositivos que aprovam**. No terminal do host rode
  `flightdeckd approvers enroll`, digite o **nome** deste dispositivo e o **código de uso único** que ele
  imprime, e aperte **Cadastrar**. O código vale uma vez, por dez minutos. O app cria uma chave que nunca sai
  deste dispositivo e entrega ao host só a metade pública.
- **Aprovar.** Com a proteção do host ligada, **Segurar para aprovar** (e a aprovação de uma regra salva)
  pergunta mais uma vez numa janela do sistema, dizendo qual é o pedido e avisando quando a aprovação também salva uma regra. Cancele e nada é enviado;
  o pedido continua aberto. A janela é do sistema, não do app, então uma página mostrada dentro de uma sessão
  não consegue apertá-la.
- **Ver e revogar.** O painel lista cada dispositivo cadastrado com o nome, o app e o endereço de onde
  se cadastrou e a data. **Este dispositivo** marca o que guarda a chave que você usa. **Revogar** tira outro
  dispositivo (ou este, mas nunca o último: só `flightdeckd approvers reset` no host faz isso).
  **Remover a chave deste dispositivo** apaga a chave guardada aqui; o host segue listando o dispositivo até
  que outro o revogue.
- **Um aviso.** Se a proteção estava ligada e o host agora não lista nenhum dispositivo, o painel avisa. Se
  você não zerou no host, alguém com acesso a ele zerou.
- **O que não cobre.** Protege as aprovações feitas pelo app. Quem tem um terminal no host ainda consegue
  zerar, e um pedido de risco médio não pede prova. Um segundo dispositivo é cadastrado com uma chave já
  cadastrada; o app ainda não faz isso, então por ora zere no host e cadastre de novo.
