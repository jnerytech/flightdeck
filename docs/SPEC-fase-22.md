# Flightdeck — Spec da Fase 22 (PR: vigiar e consertar, e rastro até o item de trabalho)

## Objetivo

O laço que mais toma tempo no trabalho do usuário é PR aberto → build ou política vermelha → corrigir → de novo. A fase faz o Flightdeck **vigiar o PR de um card e consertá-lo sozinho**, dentro de limites, começando pelo **Azure DevOps**, que nenhuma ferramenta do espaço cobre, e com o GitHub em seguida. Também liga **PR ↔ sessões ↔ item de trabalho** nos dois sentidos.

Origem: pesquisa de 30/10/2026. O Codex tem "Watch and fix", o Devin conserta comentários de revisão e há uma skill da comunidade (ado-babysit-pr). Pré-requisitos: Fases 4 (PR), 6 (workflows), 8 (custos), 11 (comentários do PR), 13 (risco, aprovação, issues) e 19 (regras).

**Fora:** dar merge sozinho, que continua com você; e consertar PRs que não vieram de um card do Flightdeck.

## Vigiar

- **Ligar:** "Vigiar e consertar" fica no card com PR aberto. Liga por card, ou por projeto como padrão. Vem **desligado**.
- **A cada `board.prPollIntervalMs`**, o daemon confere:
  - no Azure DevOps, os builds do PR e a avaliação das políticas, por `az devops invoke` na rota `policy/evaluations` (em preview);
  - os conflitos com a branch de destino;
  - os comentários novos, só de autores de confiança (Fase 13), pela Fase 11;
  - no GitHub, o equivalente pelo `gh pr checks` e pelos comentários.

  O resultado é guardado por rodada.
- **Gatilho:** algo que piorou. Um check que passou para falha, um conflito novo ou um comentário novo de revisão.

## Consertar

- **Rodada de conserto:**
  - abre (ou retoma) a sessão do card, com a persona `revisor` (Fase 20) por padrão;
  - manda um prompt com o que falhou: os nomes dos checks, o fim do log de build (até 16 KB, buscado pelo `az pipelines runs` e pelo log do build), os conflitos e os comentários;
  - a sessão corrige, roda os checks locais do projeto (`check` da Fase 6) e faz o commit;
  - o daemon faz o **push** só se os checks locais passarem.
- **Limites:**
  - `maxRounds` por PR, com padrão 3;
  - orçamento por PR, em custo e turnos (Fase 6);
  - a fila por cota (Fase 7);
  - a aprovação por risco (Fase 13) vale dentro da sessão.

  Estourou um limite, o card vai para "Precisa de você", com o resumo das rodadas.
- **Para sozinho** quando o PR é concluído ou abandonado, ou quando "Vigiar" é desligado.
- **Conflito:** rebase na branch de destino feito pela sessão, com os checks locais antes do push. Ninguém faz push forçado sem aprovação: é risco alto (Fase 13).

## Rastro

- **No card e no PR:**
  - as sessões que o produziram, com o custo (Fase 8) e os checkpoints (Fase 12);
  - as rodadas de conserto;
  - o item de trabalho (Fase 13: `AB#id` ou issue).
- **A partir de um link:** colar a URL de um PR na paleta abre o card, as sessões e o item, mesmo de PR antigo, pelo índice de histórico.
- **Descrição do PR:** pode ser gerada do resumo das sessões do card, com a opção "Gerar descrição" ao abrir o PR. No Azure, ela passa pelo saneamento do az-cmd (Fase 13).

## Testes e critérios

| Área | O que precisa passar |
| --- | --- |
| `vigiar-ado` | builds, políticas e conflito pelo az falso; só dispara no que piorou; desligado por padrão |
| `vigiar-github` | `gh pr checks` e comentários pelo gh falso |
| `consertar` | prompt com falha, log cortado e comentários de confiança; push só com check local verde; `maxRounds`, orçamento e cota; para no PR concluído; push forçado nunca automático |
| `rastro` | sessões, custo, checkpoints e item ligados ao card e ao PR; abrir por URL na paleta; descrição gerada passa pelo saneamento do az |
| `vigiar-ui` | ligar e desligar, rodadas com o resultado, e o motivo do "Precisa de você" |

**Smoke (`smoke:watch`):** um PR falso com o build vermelho dispara uma rodada. O runtime falso corrige, o check local passa e o push vai para o remoto local. O build falso fica verde, e o vigia para quando o PR é concluído.

**Critérios de aceite:** os de sempre e a versão `0.22.0`. Mais uma conferência real com o usuário: um PR de teste no Azure DevOps com o build quebrado de propósito.
