# E2E for Finish… and the card menu's Start (issue #188)

- **Done.** The journey `finalizar-card` creates a card, opens the menu's Start dialog and cancels it, opens Finish… (three outcomes, the merge off with its reason), closes it with Esc, moves the card to Done and sees "already in Done". The palette click of `segundo-host` is scoped to the palette's dialog and option, the header button of `nova-sessao-host` to `<main>`, the second host's name is a constant, and the creation toast of `card-diff` is looked for before the tile (it is short-lived).
- **Proof.** Not run on the Pi: the PR's e2e job is the proof.
- **Not done.** `segundo-host` still does not add a real second host (the demo has no third daemon to point the form at), and the real first run (empty window) has no e2e.
