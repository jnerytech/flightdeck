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
