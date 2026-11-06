# Board: many cards at once (issue #161)

Rebuilt on today's `main` from the stranded branch `board-multi` (9 commits, far behind `main`);
the work was redone from the branch, not merged.

- **Selection is the board's, not the host's.** `lib/board-select.ts` keeps it as ids: Ctrl/Cmd-click
  toggles, Shift-click selects the range from the last card picked within the clicked card's column,
  Esc clears. The ids that no card has any more are dropped when the cards change. A filter does not
  drop anything, but every gesture and action uses only the selected cards that are shown (the bar
  says how many are hidden), so a filter can never make an action reach a card the person cannot see.
- **A keyboard way to select.** Ctrl-click has no keyboard form, so the card's menu has Select card /
  Deselect card.
- **Bulk moves ask the host one card at a time, in the board's order**, through the quiet request
  (`hostRequest`), so a refusal is data and not a toast per card. The rules stay the host's: a card
  it refuses stays where it was, stays selected, and is named with the host's reason in a notice.
  Nothing in the app decides what a drag may do.
- **Dragging a selected card moves the whole selection** to the column it is dropped on. Dropped on a
  card, the group lands before it (`positionsBefore` gives each card its own position between the
  card above the target and the target, in the board's order); dropped on the column, it goes to the
  bottom.
- **Bulk discard is one dialog** listing each card with what goes with it: a worktree or branch loses
  uncommitted changes and unpushed commits (the host removes the worktree with `--force` and deletes
  the branch with `-D`); a session-only card just has its session closed; the dialog counts the
  cards with work started. Never-started cards are deleted and started ones discarded, as the single
  Delete does. The issue's per-card "unpushed warning" is still not shown: the host does not say
  what is unpushed before a discard.
- **A discard that fails is not "stayed where it was".** The host's discard is not atomic (sessions
  closed, worktree removed, then the branch), so a refused card may be partly cleaned up. The notice
  says so, the card is not left selected for a retry that would fail on what is gone, and a refusal
  is shown with the host's reason in the app's language (`reasonText`), moves included.
- **A batch in flight is guarded** (`busy`): the bar, the drag and a second dialog are off while moves
  or discards run.
  The guard is React state, not a ref: two calls in the same tick before a re-render could both pass,
  but the UI cannot make them (a drop clears what was dragged on its first call, and the dialog closes
  before it sends), and the host refuses a card that is already gone.
- **Esc and focus.** Esc clears the selection from the board or the bar, not from a card's open menu.
  When the bar goes away the focus goes to the board. One live region (`role=status`) speaks the
  selection count and what a refusal left; the bar keeps its place (`selection-slot`) so the first
  Ctrl-click moves no card. The bar is a group, not a toolbar (it has no arrow-key roving).
- **Arena variants are not on the board**, so a parent and its variant cannot both be selected: the
  review's "variant fails after the parent was discarded" cannot happen from the board and is not
  handled.
- **Column width is one value for every column** (default 260, 220 to 520, 20 px a step), with a
  handle on each column's right edge (a separator that a mouse drags and the arrows, Home and End
  move), kept per computer. The drag shares the distance among the columns to its left (the handle
  on column k follows the pointer), a cancelled touch ends it, the width is whole pixels and is
  written when the drag ends, and a storage that refuses does not stop the width. The handles are one
  control, so only the last takes a tab stop. Columns have a fixed width and the board scrolls inside
  itself.
- **Counts** read `n / total` only while a filter is on and the column has cards; a column that never
  had one stays `0`, and a column the filter emptied says "No matches" instead of offering a new
  card. The count pill is the one the status tints of #115 brought to the column header
  (`.column-count`); it now also carries the count in words as its accessible name ("1 of 3 cards"),
  so a screen reader does not read a slash.
- **New card at the bottom of a lane** uses what `main` has since the branch was written: `card.create`
  takes the column, so the card is made in that lane in one step, with no move afterwards (the
  branch created it in Backlog and moved it). The button is hidden until the lane is hovered or
  focused where there is a pointer, and always shown where there is none. The header's + and the
  empty lane's box ("Empty, Add card") create in their lane the same way. Only a card just selected
  anchors the next Shift-click.
- **Not built:** the marquee selection (the issue marks it optional, after the rest) and moving a
  selection with the keyboard other than through the bar.
