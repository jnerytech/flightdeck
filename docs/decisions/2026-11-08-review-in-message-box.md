# Commenting on diff lines: discoverability and the message box (issue #1146)

Proposal 6 of #1126 (round 4 of #168), narrowed after reading main: commenting on a diff line and
sending the drafts as one review already existed (phase 11, `ReviewComments`, the daemon's
`reviewMessage`). The gap was finding it and using it by keyboard.

- **Keyboard.** Picking a line puts the focus in the comment box; Ctrl+Enter (Cmd+Enter) adds the
  comment and Esc closes the box, dropping what was typed. The line number was already a focusable
  button, so Enter or Space picks it.
- **Affordance.** The line-number button swaps its number for a Comment mark on hover and on
  keyboard focus, and carries the label as its title.
- **Review in the message box.** A second action beside **Send review**, for a session target only
  (a card has its own message flow): the app builds the same message the daemon would send and puts it
  in the session's message box after what was typed, then opens the Conversation view. The builder
  moved from the daemon to `packages/protocol/src/review-message.ts` so both sides share one format
  and one test; the daemon's `review.send` is unchanged on the wire.
- **The drafts stay drafts.** The message box is a place to edit, not a delivery: the app cannot
  know when, or whether, the person sends it, so nothing is marked sent. Marking them sent without a
  send would lose them if the text is discarded; the cost is that using both actions sends the
  review twice. The manual says to use one or the other.
- **The fill is a store field**, `composerFill` by session key, taken once by the session page (it
  survives the Changes view replacing the Conversation, which unmounts the message box).
