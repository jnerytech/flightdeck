# The knowledge panel says what it is doing (issue #1091)

Four silences in the project's knowledge panel: "Make a card" was `disabled` while the card was made
(so the focused button lost the focus to the page) and its only feedback was a toast; while the
library loaded the panel drew nothing, and when it failed it said so with no next step; and the
index switch's result was not announced and its failure line was not an alert.

## Decision

- "Make a card" is `aria-disabled` while the card is made, not `disabled`: it keeps the focus, and a
  second press does nothing (the guard was already there).
- The made card is said in the panel, in a status region that stays mounted, with an **Open** button
  (named "Open the card {title}"). The toast is gone: two announcements of one event read twice.
- A loading panel shows the loading state; a failed one is an alert with a hint (is the host online,
  does the folder still exist) and **Try again**.
- The index switch's words are a live region from their first draw, and its failure is an alert.
- Three new strings (`loading`, `failedHint`, `retry`) and `openMade`, in both languages.
