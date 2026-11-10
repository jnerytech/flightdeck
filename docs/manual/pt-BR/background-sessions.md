# Sessões em segundo plano

[Voltar ao manual](../pt-BR.md) · [English](../en/background-sessions.md)

O Claude Code roda uma sessão sem terminal (`claude --bg`), sob um supervisor próprio, e lista as
sessões com `claude agents`. O Flightdeck mostra essas sessões do host e deixa você agir sobre
elas. Precisa de um `claude` que tenha o comando (2.1.139 ou mais novo); num host cujo `claude`
não tem, o app não mostra nem pergunta nada.

- **Em Sessões:** uma sessão em segundo plano é uma linha da origem **Segundo plano** (o filtro
  **Origem** a tem). O estado vem de `claude agents --json`: trabalhando é rodando, bloqueada (uma
  pergunta, uma permissão, um erro que só você resolve) precisa de você, pronta é ociosa, falhou e
  parada são encerradas. O hub pergunta ao host de novo a cada 10 segundos enquanto está aberto.
  Uma sessão que o host já mostra como sessão do Flightdeck ou do terminal fica lá.
- **A tela dela:** uma linha que tem sessão do Claude abre a tela dela, com o painel **Sessão em
  segundo plano**: o estado, o que ela espera, o custo (do uso dos transcripts, porque a listagem
  não tem custo) e
  - **Parar** e **Reiniciar** (`claude stop` e `claude respawn`, que retoma a conversa salva e
    pega o Claude Code atual);
  - **Trazer para o terminal** (com os terminais do host ligados): abre `claude attach <id>` numa
    aba de terminal, onde dá para responder um diálogo de permissão;
  - **Mensagem**: pelo canal do Flightdeck quando a sessão foi iniciada com `flightdeckd claude`,
    ou, para uma sessão sem processo, continuando-a com a mensagem como prompt. Uma sessão em
    segundo plano que está rodando e não tem canal não recebe mensagem: o Claude Code não tem
    comando para isso, e o app diz.
- **Aprovar:** uma permissão pedida por uma sessão em segundo plano deve ser respondida como a de
  uma sessão do terminal quando os hooks do Flightdeck do Claude Code estão instalados, mas isso
  ainda não foi confirmado numa sessão real em segundo plano (veja DECISIONS); o caminho seguro é
  **Trazer para o terminal** e responder lá.
- **Iniciar uma:** marque **Iniciar em segundo plano** no formulário de nova sessão (o host precisa
  oferecer), aperte **Iniciar em segundo plano** num card que ainda não tem sessão (o Claude Code o
  põe num worktree próprio; o texto do card é o prompt), ou rode `flightdeckd claude --bg "prompt"`. A sessão roda com o canal do Flightdeck e
  a persona, e aparece em Sessões.
- **Bom saber:** o Claude Code move uma sessão em segundo plano que edita arquivos para um git
  worktree próprio em `.claude/worktrees/`. Desligar ou reiniciar a máquina as para (aparecem
  falhou, depois parada); suspender não. Os arquivos que `flightdeckd claude --bg` grava para o
  canal e a persona ficam, porque a sessão continua lendo.
