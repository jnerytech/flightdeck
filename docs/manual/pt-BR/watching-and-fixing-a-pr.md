# Vigiar e consertar um PR

[Voltar ao manual](../pt-BR.md) · [English](../en/watching-and-fixing-a-pr.md)

Um card com PR aberto tem **Vigiar e consertar**. Vem desligado: ligue no card, ou faça dele o
padrão de um projeto em **Configurações**. Os hosts que oferecem isso (`watch` na página do host)
vigiam o PR a cada `board.prPollIntervalMs`:

- os **builds** e a **avaliação das políticas** (Azure DevOps, por `az devops invoke`; GitHub, por
  `gh pr checks`), os **conflitos** com a branch de destino e os **comentários novos** de quem você
  confia (a identidade do card, ou donos, membros e colaboradores);
- só o que **piorou** começa uma rodada: um build que falha, um conflito novo, um comentário novo. A
  primeira olhada conta tudo como novo.

Uma **rodada** abre a sessão do card com a persona `revisor`, com os nomes dos checks que falharam,
o fim do log do build (16 KB), o conflito e os comentários. O log e os comentários chegam à sessão
como dado citado, nunca como instrução. A sessão corrige e faz o commit, os **checks locais** do
projeto rodam na worktree do card e, só se todos passarem, o host faz o push, para a branch do
próprio card, nunca forçado e nunca para a base. O merge continua com você. O card mostra
**Vigiando o PR**, cada rodada com o resultado (**Rodada 2 · falhou**) e por que ele pede você.

A rodada para, e o card vai para **Precisa de você** com o resumo, quando bate num limite: 3
rodadas por PR, US$ 5 por PR, 30 turnos, US$ 20 por dia e projeto, duas rodadas seguidas que
falham, ou a fila por cota. Para sozinha quando o PR é concluído ou fechado, ou quando você desliga
a vigia. **Voltar a vigiar** a liga de novo.

O card mostra **Rodadas usadas: 2 de 3**. Quando as rodadas acabam, **Permitir mais 2 rodadas** dá ao
card mais duas sem esquecer o que ele já gastou; o host recusa quando outro limite (turnos, custo, a
branch do card) pararia a próxima rodada de qualquer jeito. Enquanto o PR de um card é vigiado, uma
automação que manda checks com falha ou comentários de revisão ao card deixa isso para a vigia.

Antes do push, o host confere se a rodada ficou dentro do PR: uma rodada que mexe num arquivo que o
PR não muda (e que nenhum comentário de revisão cita), ou que muda mais linhas que
`max(200, as do PR)`, fica **retida para você** em vez de ir. A rodada lista os arquivos fora do PR e
as linhas que mudou. **Enviar assim mesmo** envia esses commits como estão; **Descartar a rodada** os
desfaz, mantendo o que havia antes da rodada. Lockfiles e `*.snap` nunca contam.

**Configurações** tem **Vigiar e consertar PRs · <host>**, um bloco por projeto: vigiar por padrão,
rodadas por PR, limite de custo por PR e por dia (vazio é sem limite), o tempo limite por check (1 a
60 minutos, 10 por padrão) e os **checks locais**, um por linha. Um check é um comando com os seus
argumentos, sem aspas, pipes, `;`, `&`, `$` nem redirecionamentos: qualquer outra coisa é recusada.
Um check que estoura o tempo é morto com tudo o que ele iniciou, e a rodada diz isso. Uma rodada
enviada lista os checks que passaram.

Mais duas coisas vêm junto:

- **Abrir PR** num card mostra antes a **Descrição do PR**, feita das sessões do card, para você
  editar. As linhas que parecem segredo são tiradas e contadas. Nada é aberto até você clicar em
  **Abrir o PR com este texto**. O **Título do PR** começa com o título do card; o título e a
  descrição têm cada um a varinha, que escreve a partir do repositório do card.
- **Ctrl+K**: cole o link de um PR (Azure DevOps ou GitHub) e escolha **Abrir o PR do link**. Os
  hosts são consultados: abre o card, se o PR é de um; senão, a conversa da primeira sessão que o
  histórico conhece para ele; senão, uma mensagem diz que nada tem esse PR.
