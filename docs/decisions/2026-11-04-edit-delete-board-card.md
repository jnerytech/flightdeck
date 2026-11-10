# Edit and delete a board card (issue #104)

- **Delete is only for a card that never started.** `card.delete { cardId, confirm }` refuses with `delete_confirm` without
  `confirm`, and with `card_delete_started` (not `card_started`, which already means "an arena starts from a new card") when
  the card has a worktree, a branch, a session or any run. A started card has work to clean up, so the app's dialog says why
  and offers the existing `card.discard` instead.
- **No separate `card.deleted` event.** A discarded card already leaves every board through its last `card.updated` marked
  `discarded: true`, and the app already drops cards on that flag. Delete reuses it (both go through `removeFromBoard`), so an
  older app version also drops a deleted card correctly and the wire gains no new frame.
- **Dependents.** The cards that waited for the deleted card are freed of it, exactly as for a discard: the blocker row goes,
  the card gets the notice `Blocker "<title>" was deleted and no longer blocks this card.`, and its wait ends (auto-start
  included). The alternative, keeping a dangling `dependsOn` to a card that can never be done, would hold them forever.
- **Edit.** The card page has an editable title (Save title) next to the description it already edited; the estimate stays in
  the ROI hours field. **Edit…** in the card menu opens the card with the title focused (the route carries `edit: true`, never
  saved in the address). All of it goes through the existing `card.update`.
