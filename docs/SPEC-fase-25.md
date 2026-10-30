# Flightdeck — Spec da Fase 25 (Rastro e replay da sessão)

## Objetivo

O histórico mostra o que foi dito, mas não **por que uma execução foi lenta ou cara**. Com personas e times (Fases 20 e 21), as sessões passam a ter subagentes em cascata. A fase traz uma **visão de rastro**: cada turno com as ferramentas, a duração, os tokens e o custo; a **árvore de subagentes** aninhada; e um **replay passo a passo**.

Origem: pesquisa de 30/10/2026 (claude-devtools, claude-trace-replay, june). Os transcripts de subagentes ficam em `<sessão>/subagents/agent-<id>.jsonl`. Pré-requisitos: Fases 3 (histórico), 8 (custo por mensagem) e, quando existir, 23 (telemetria com duração).

## Desenho

- **Modelo:** montado a partir dos transcripts que o indexador já lê:
  - turnos;
  - chamadas de ferramenta com entrada resumida, resultado resumido e erro;
  - mensagens do assistente com tokens e custo (Fase 8);
  - pensamento, quando o transcript o tiver em texto;
  - e os subagentes, ligados pela chamada que os iniciou (Task e Agent).

  A duração vem dos timestamps, ou da telemetria quando houver. O formato do transcript não é contrato, então o leitor é tolerante, e um campo desconhecido não quebra nada.
- **Visão:**
  - **Rastro:** uma árvore de turno → ferramentas e subagentes → as ferramentas deles, com barras de duração no estilo flame chart, custo e tokens por nó e filtro por ferramenta. Os nós mais caros e mais lentos aparecem em destaque.
  - **Replay:** avança mensagem a mensagem, com o diff de arquivos em cada passo (snapshots da Fase 12, quando houver) e controles de play, pause e velocidade.
- **Exportar:** um JSON do rastro para anexar a um bug, sem conteúdo de ferramentas, só a estrutura e os números, a menos que você marque "incluir conteúdo". Nesse caso, a exportação passa pela varredura de segredos (Fase 18).

## Testes e critérios

| Área | O que precisa passar |
| --- | --- |
| `rastro-modelo` | turnos, ferramentas, subagentes aninhados (fixtures com `subagents/`), custo e duração; campo desconhecido tolerado |
| `rastro-ui` | árvore com barras; destaque do mais caro e do mais lento; filtro |
| `replay` | passo a passo com diff quando há snapshot; controles |
| `rastro-export` | estrutura sem conteúdo por padrão; com conteúdo passa pela varredura |

**Critérios de aceite:** os de sempre, a versão `0.25.0` e os prints.
