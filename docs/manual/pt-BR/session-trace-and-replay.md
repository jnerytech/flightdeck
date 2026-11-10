# Rastro e replay da sessão

[Voltar ao manual](../pt-BR.md) · [English](../en/session-trace-and-replay.md)

O histórico diz o que foi falado; o **rastro** diz por que uma execução foi lenta ou cara. Ele é
montado dos transcripts que o host já lê (o da sessão e os dos subagentes, em
`<sessão>/subagents/`), então vale para qualquer sessão do host, inclusive as antigas.

- **Abrir:** a aba **Rastro** de uma sessão, num host que anuncia `trace`.
- **A árvore:** cada turno (um por prompt) com, em ordem, os pensamentos, as chamadas de
  ferramenta e os subagentes que ele iniciou; um subagente mostra, abaixo dele, as suas ferramentas
  e os seus subagentes. Todo nó tem o tempo, o custo e os tokens (os de um turno e de um subagente
  incluem tudo o que está abaixo) e uma barra do tempo contra a chamada mais longa do turno. O
  turno ou subagente que mais custou é marcado como **mais caro**, e a chamada que mais demorou,
  como **mais lento**. O filtro **Ferramenta** mantém as chamadas a uma ferramenta e os turnos e
  subagentes em que estão.
- **De onde vêm os números:** o tempo de uma chamada é o intervalo entre a linha do assistente que
  a pediu e a linha com o resultado, ou o tempo real que a telemetria informou quando o host a
  recebe (veja Tempo das sessões). Custo e tokens são os que Custos já calcula, uma vez por
  mensagem. Uma chamada à ferramenta `Task` ou `Agent` vira um subagente quando o transcript dele é
  achado, pelo id do agente no resultado ou pela linha pai do primeiro registro do subagente; se
  não, continua uma chamada comum.
- **Replay:** **Replay** percorre o rastro um nó por vez: **Anterior**, **Próximo**, **Tocar** e
  **Pausar** a 1x, 2x ou 4x. Num host que guarda checkpoints, cada passo também lista os arquivos
  que o turno mudou, com as linhas acrescentadas e removidas.
- **Exportar:** **Exportar rastro** salva um JSON só com a estrutura e os números: sem prompt,
  entrada de ferramenta, resultado nem pensamento. Com **Incluir conteúdo** o texto vai junto, e
  cada campo passa antes pela varredura de segredos: um campo com um segredo vira
  `[redacted: ...]` e mostra-se quantos foram.
- **Limites:** o formato do transcript é do Claude Code e muda, então uma linha ou campo que isto
  não conhece é pulado; um pensamento só aparece quando o transcript o traz em texto.
