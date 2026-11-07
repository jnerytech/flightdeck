# Board stage contracts, first slice: a checkpoint in the app (issue #78)

The design is in the issue's comment. This records what the first slice does and where it holds
back. The slice is app-only: no daemon, protocol or setting.

- **Contracts.** A column can ask for a closed set of checks on fields a card already has
  (`lib/board-contracts.ts`): `criteria` (a checklist item in the description), `pr` (a PR link)
  and `checks` (the PR's checks are not running or failing). Defaults are constants: In review asks
  for `pr` and `checks` and confirms; In progress asks for `criteria` and only shows a hint.
  Backlog, Waiting and Done ask nothing: many cards finish with no PR, and there is no field yet
  for a validation note.
- **Checks with no state.** A PR whose repository reports no checks has no `checksState`. That is
  not counted as a lack, or a repository without CI could never move a card by hand without an
  override.
- **A checkpoint, not a lock.** The app asks only for a person's manual moves (drag, the card's
  menu, the selection bar). Moves the daemon makes from facts (a session starts, a PR opens or
  merges) are not asked about, and the daemon refuses nothing. **Move anyway** is always offered
  and nothing is recorded; recording the override needs the daemon.
- **In progress never asks**, by the coordinator's call: starting work stays one move. Its hint
  is on the card and on the column while a card is dragged.
- **One question for many cards.** A bulk move to a confirmed column opens one dialog that lists
  every card that lacks something and what, and offers Move anyway, Move only the ones that
  qualify, and Cancel. Cards that already qualify are never listed.
- **A card says what it lacks, where it sits.** A card in a column it does not satisfy wears
  "Needs: ..." (words and an icon). So a card that was moved anyway keeps saying what is missing.
- **Focus.** The dialog gives the focus back to the card it asked about (the menu it came from is
  gone by then), and a close that follows an action is not reported as a cancel.

Left for later slices: contracts per project, the daemon guard with a refusal code and a recorded
override (automatic callers exempt), a spec or validation artifact, and templates.
