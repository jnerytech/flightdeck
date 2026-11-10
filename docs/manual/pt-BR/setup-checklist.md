# Lista de configuração inicial

[Voltar ao manual](../pt-BR.md) · [English](../en/setup-checklist.md)

Uma linha **Configuração inicial** no topo do grupo Trabalho da barra lateral mostra um anel e uma
contagem (por exemplo `1/4`) enquanto os passos para começar não estão todos feitos. Ela abre a
tela de **Configuração inicial**: uma lista de passos, cada um com uma frase e um botão que abre a
tela onde ele se resolve. Um passo está feito quando o app consegue ver que está: é lido dos seus
hosts e do app, nunca marcado à mão; conectar um host move o anel na hora e remover o host o move
de volta.

- **Para começar:** conectar um host (um online); instalar os hooks do Claude Code nele (a página
  do host diz instalados); adicionar um projeto com um branch base; iniciar uma primeira sessão ou
  card. O passo que a tela marca como atual (o primeiro não feito) tem o botão cheio.
- **Vale a pena:** entrar no GitHub no host, conferir se as notificações funcionam (uma notificação
  de teste chegou ao sistema uma vez), definir um orçamento e adicionar um `.worktreeinclude` a um
  projeto. A linha não espera por esses.
- Um passo que o host não pode fazer (ele não anuncia o recurso) fica de fora, não pendente.
- A linha sai sozinha quando os quatro passos para começar estão feitos. **Esconder** (o botão de
  olho que aparece ao lado da linha, ou na tela) a remove de vez; Configurações, Janela, **Mostrar a
  lista de configuração inicial** a traz de volta. O modo simples não mostra nada disso.
- Uma ferramenta que falta num host (a CLI do GitHub, o `claude`) ganha um cartão discreto na tela
  inicial, não um banner vermelho, com um link de como instalar e **Dispensar**.
