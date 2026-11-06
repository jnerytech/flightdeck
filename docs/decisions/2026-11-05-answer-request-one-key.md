# Answering a request with one key, journey J4 (issue #187)

- **The card takes the focus where the request is announced.** A notification opens the session
  with `focus` on the request; `SessionView` scrolls to the card and focuses it once, so a card that
  arrives later never takes the focus from the message box. In Needs you the chosen request's card
  is focused, so A and N answer it with no click first. The hold of a high-risk request and the
  plain-key rule (#244, #245) still apply.
- **Needs you goes on by itself.** Once the chosen request is answered, the one now in its place is
  chosen and focused, and the detail says how many are left ("2 left"). A chosen alert that goes
  leaves nothing chosen, as before.
- **The bell's entry of an answered request opens its session at that request.** A managed
  session's request notification now keeps the session route (`focus` on the request) beside its
  link; the link still wins while the request waits. External sessions keep the link only.
- **The palette's "Approve the oldest"** was already handled by #187's first part and #245 (L4): the
  command names the request, and a request gone in between is opened, not answered.
- **e2e:** the journey `responder-sem-clique` answers two requests with A alone.
