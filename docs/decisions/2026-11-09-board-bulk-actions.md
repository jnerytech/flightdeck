# Acting on several board cards at once: the keys, the pointer, the bar and the confirms (issue #1354)

- **Problem.** Planning a sprint, or a host that needs its runs stopped, means starting, moving or stopping
  ten cards. Today that is ten round trips through each card's menu. The board already has a selection
  (#161, #760):
  - Ctrl-click (Cmd on a Mac) toggles a card, and Shift-click adds the range from the last card picked.
  - The card's menu has **Select card** and **Deselect card**.
  - A bar above the columns says "3 selected", with **Move to…**, **Discard…** and **Clear selection**.

  The selection has no keyboard path inside #1198's roving Tab stop, no Start or Stop, and no
  control a touch screen or a person without a Ctrl key can reach.
- **Decision.** The existing selection grows. There is no separate "select mode": a selection exists
  while one card or more is selected, and the board looks and acts as it does today when none is.
  Slice 2 (fd-frontend, after #1345) builds it from this file.

## Keys (on a card's title, the column's Tab stop)

These go in `boardKey` (`apps/desktop/src/lib/board-keys.ts`). The arrows, Home, End, Enter and the `g`
chord stay as they are.

| Key | Does |
|---|---|
| `x` | Toggles the focused card in the selection. A card just selected becomes the anchor of a range. |
| Shift+↑ ↓ ← → | Moves the focus as the arrow does, and selects from the anchor to the new card in the board's order (`rangeSelection`). With no anchor, the card left becomes the anchor. |
| `s` | With a selection: opens **Start N?** for the selection, wherever the focus is. With none, it starts the focused card, as today. |
| `m` | With a selection: opens the bar's **Move to…** menu. With none, it opens the card's menu, as today. |
| `Esc` | An open menu or dialog closes first. Then, with a selection, it clears it and the focus stays on the card. With none, the board does nothing and Esc goes on as today (a split view closes). |

- **One scope per key.** While a selection exists, `s` and `m` always act on the selection, never on a
  card outside it. A stray `s` on an unselected card then opens the confirm, rather than starting a
  card the person did not pick. To act on one card, Esc first. One card selected is a selection of one.
- **Esc must stop the event.** It must stop it only when it cleared a selection. `split-view.tsx` closes
  the split on any Escape from inside a pane and does not check `defaultPrevented`. Today the bar's Esc
  also reaches it. Slice 2 stops propagation in both places.
- **Shift+F10 and the context-menu key** still open the card's menu, so Shift+arrows are the only new
  Shift keys.
- **Announced.** `aria-keyshortcuts` becomes `S M X`. The hint (`board.keysHint`) gains the new keys. A
  polite live region says the count after each change ("4 selected", from the existing
  `board.selectedCount`). Both manuals list the keys.

## Pointer

- **Ctrl-click and Shift-click** stay as they are.
- **A check on each card**, at the start of its title line. It shows on every card while a selection
  exists. With none, it does not show. Slice 2 changed this from "on the card under the pointer or
  with the focus": a check that appears there reflows the title and moves the cards under the pointer
  as it passes. Ctrl-click, `x` and the card menu's **Select card** start a selection.
  - The box is 16 px inside a 24 px target (`hit-control`): axe's target-size failed #1349 on bare radios.
  - It is not a Tab stop (`tabIndex -1`). `x` is its keyboard path, so each column stays one Tab stop.
  - Its name is "Select {title}" ("Selecionar {title}"). It replaces the `sr-only` "selected" span, so
    the state is said once, by the checkbox. Slice 2 deletes the `board.selectedCard` key ("selected"),
    in en and pt-BR, with the span.
  - Clicking it toggles the card. A plain click on the card still opens it.
- **Touch, or no Ctrl key.** The card's menu (**Select card**) starts a selection. From then on every
  card shows its check.

## The bar

It stays in `SelectionSlot` (#760): it covers the toolbar's row, so the columns never move.


- **Order.** The count, **Start N**, **Stop N**, **Move to…**, **Discard…** and **Clear selection**.
- **Counts.** N counts only the cards each action can take:
  - **Start:** the cards `cardStartBlock` lets start.
  - **Stop:** the cards that are running or queued.
- **Disabled buttons.** Start with no card to take is disabled, and says "None of the selected cards
  can start" on a line of the bar, in the flow (a `FieldRow`, #732). Stop shows only while a selected
  card is running or queued: most selections have none, and a reason hung under a disabled Stop was
  drawn over the cards at 1024 and past the window at 390 (the narrow guard of the prints caught it).
- **One primary (#1197).** **Start N** is the primary while it has a card. Otherwise there is none.
- **640 (the column switcher shows).** The count gains "1 in another column" ("{n} in other
  columns"), because the actions take the whole selection, not just the column on screen. The row
  wraps, and **Clear selection** may take a line of its own.

- **390.** **Move to…** and **Discard…** go under a ⋯ menu ("More actions for the selection"), and
  **Clear selection** becomes **Clear**. The bar wraps to two lines at most. It stays at the top, not
  in a sticky bottom bar, which would bring back the covered-content problem of #1271.


## The confirms

They use the existing `ConfirmDialog`, like **Discard…**. **Move to…** keeps today's flow, with no
confirm, only the column contract's question (#78).

- **Start N.**
  - **Title:** "Start 3 cards?"
  - **Queue:** "1 starts now and 2 wait in the board's queue (at most 2 at once)."
  - **Quota:** "alfa: 42% of the 5-hour window used, resets in 2h 54m."
  - **List:** every selected card. A card that can't start stays in the list, dimmed, with "skipped:
    {reason}" (the `startOffText` reason).
  - **Button:** **Start 3** (primary), next to **Cancel**.

- **Stop N.** Stopping one card asks nothing today. Stopping several ends several sessions at once, so
  it asks.
  - **Title:** "Stop 1 card?"
  - **Body:** "A running card's turn is cut off and the card waits in Needs you; a queued card goes back
    to Backlog. Worktrees, branches and commits stay." This is what `stopCard` does on the host: an
    interrupted turn sends the card to Needs you (`board.ts`, `stopCard`).
  - **List:** the selection, the cards that aren't running dimmed with "skipped: not running".
  - **Button:** **Stop 1**. It isn't marked destructive: the turn's unfinished work is cut off, but the
    worktrees, branches and commits stay.


### Where each fact comes from (no daemon change)

| Fact | Source | When it is not known |
|---|---|---|
| Can start, and why not | `cardStartBlock` per card | — |
| At most N at once | `board.settings` (`maxParallelRuns`), read once when the confirm opens | "They join the board's queue." with no split |
| Running now | the board's cards (running or queued) | as above |
| Quota | `state.quota[hostId]`, only when `onSubscription` holds | no quota line (a host on an API key) |
| A budget holds new cards | the host's budgets with "hold new cards" at or over the limit | no line |
| Short of memory (#1343) | the host's queued reason, when the host reports it | no line: it fails open |

The board is one host's (`BoardView` takes one `hostId`), so the confirm names one host.

## What runs (slice 2)

- **One card at a time.** The existing commands run one after another, as **Move to…** and **Discard…**
  do today: `card.start` and `card.stop`. Start goes through the board's `maxParallelRuns` queue and,
  once #1343 lands, its memory hold.
- **Refusals.** The host's refusals are named afterwards in the bar's notice, the same way `board.stayed`
  does it. A refused card stays selected for another try; a card that started or stopped leaves the
  selection.
- **Cut short.** The batch runs from the app. If the app closes midway, the cards done so far are done,
  and the rest are untouched and stay as they were. Nothing is half-applied to one card.
- **Busy.** While a batch runs, the bar's buttons are off (`busy`), as today.

## New strings (en / pt-BR)

| Key | en | pt-BR |
|---|---|---|
| `board.startSelected` | Start {n} | Iniciar {n} |
| `board.stopSelected` | Stop {n} | Parar {n} |
| `board.noneCanStart` | None of the selected cards can start | Nenhum card selecionado pode iniciar |
| `board.selectCardNamed` | Select {title} | Selecionar {title} |
| `board.otherColumnOne` | 1 in another column | 1 em outra coluna |
| `board.otherColumns` | {n} in other columns | {n} em outras colunas |
| `board.moreSelected` | More actions for the selection | Mais ações da seleção |
| `board.clearShort` | Clear | Limpar |
| `board.startTitleOne` / `board.startTitle` | Start 1 card? / Start {n} cards? | Iniciar 1 card? / Iniciar {n} cards? |
| `board.startNowOne` / `board.startNow` | 1 starts now / {n} start now | 1 inicia agora / {n} iniciam agora |
| `board.waitOne` / `board.wait` | 1 waits in the board's queue / {n} wait in the board's queue | 1 espera na fila do board / {n} esperam na fila do board |
| `board.startSplit` | {started} and {waiting} (at most {max} at once). | {started} e {waiting} (no máximo {max} ao mesmo tempo). |
| `board.startAllNow` | All of them start now. | Todos iniciam agora. |
| `board.startQueue` | They join the board's queue. | Eles entram na fila do board. |
| `board.startQuota` | {host}: {percent}% of the 5-hour window used, {reset}. | {host}: {percent}% da janela de 5 horas usados, {reset}. |
| `board.startQuotaHold` | {host} is over its pause limit: new cards wait until the window resets. | {host} passou do limite de pausa: os cards novos esperam a janela renovar. |
| `board.noCriteriaOne` / `board.noCriteria` | 1 of them has no acceptance criteria; it starts anyway. / {n} of them have no acceptance criteria; they start anyway. | 1 deles não tem critérios de aceite; ele inicia mesmo assim. / {n} deles não têm critérios de aceite; eles iniciam mesmo assim. |
| `board.startFailedOne` / `board.startFailed` | 1 card did not start: {names} / {count} cards did not start: {names} | 1 card não iniciou: {names} / {count} cards não iniciaram: {names} |
| `board.stopFailedOne` / `board.stopFailed` | 1 card did not stop: {names} / {count} cards did not stop: {names} | 1 card não parou: {names} / {count} cards não pararam: {names} |
| `board.skipped` | skipped: {reason} | fica de fora: {reason} |
| `board.stopTitleOne` / `board.stopTitle` | Stop 1 card? / Stop {n} cards? | Parar 1 card? / Parar {n} cards? |
| `board.stopBody` | A running card's turn is cut off and the card waits in Needs you; a queued card goes back to Backlog. Worktrees, branches and commits stay. | O turno de um card rodando é interrompido e o card espera em Esperando você; um card na fila volta para o Backlog. Worktrees, branches e commits ficam. |
| `board.notRunning` | not running | não está rodando |
| `board.keysHint` (new text) | Arrows move between the cards, Enter opens one, S starts it, M shows its actions, X selects it and Shift with an arrow selects a range. Esc clears the selection. | As setas passam de um card a outro, Enter abre, S inicia, M mostra as ações, X seleciona e Shift com uma seta seleciona um trecho. Esc limpa a seleção. |

Which line the Start confirm shows: with nothing left to wait, `board.startAllNow`; with nothing starting
now, `board.startQueue`; otherwise `board.startSplit`, built from the one-or-many forms of
`board.startNow` and `board.wait`.

## The prints

Slice 1 drew mocks; slice 2 replaced them with real prints of `demo:shots`, both themes and both
languages, re-measured at 1024, 640 and 390 by the narrow guard:

- `board-selecao`: four cards selected, three to start and one at a gate. The bar, the checks, and at
  390 the compact bar with Move to and Discard under ⋯ and "1 in another column".
- `board-selecao-iniciar`: Start N's confirm on the same selection, with the host's queue and quota.

## Built in slice 2, and what waits

- **Shown:** the count, Start N, Stop N while something runs, the queue line (from `project.list`'s
  `maxParallelRuns` and the host's running cards), the 5-hour quota line and the pause-limit line on a
  subscription, the cards with no acceptance criteria, and the skipped cards with their reason.
- **Waits:** the budget line (`board.startBudgetHold`) needs the host's budgets with "hold new cards"
  in the board's store, and the memory line (`board.startMemoryHold`) needs #1343's queued reason.
  Neither is in the strings yet; each comes with its source.

## Out of scope

- Selecting every card in a column (Ctrl+A).
- A selection that spans boards or hosts. The Pull requests page of #1345 is the cross-host view.
- Arena starts from a selection.

## How slice 2 is checked

- **Unit tests** of `boardKey` for `x`, Shift+arrows, and `s` and `m` with a selection.
- **A journey:** keyboard only, select 3 cards with `x` and Shift+↓, start them, and see the confirm's
  count and quota.
- **Prints** of the bar, the Start confirm and the Stop confirm, each at 1280/640/390, in both themes
  and both languages (the `demo:shots` matrix), with axe and the narrow guard.
