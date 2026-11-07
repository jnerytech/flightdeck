# Board stage contracts, slice 3a: a validation note and the question before Start (issue #78)

Slice 2 (`2026-11-07-board-contracts-daemon.md`) moved the contracts to the host. This slice adds
the first artifact a column can ask for and makes starting a card ask about criteria. Spec files,
reads of the worktree and templates stay for later: they read the project's files and need the
security review.

- **A validation note on the card.** `Card.validationNote` (additive, `null` by default,
  `cards.validation_note`), set with `card.update` (blank or `null` clears it; at most 4000
  characters; the host keeps it trimmed). It is plain text the person writes: nothing reads a file
  or runs anything.
- **A new check.** `validation` joins `criteria`, `pr` and `checks`: a card lacks it when its note
  is empty or blank (need `validation`, "a validation note"). Any column can ask for it, in a
  project's contract. No default asks for it: this slice adds the ability, not a new gate.
- **Edited on the card page.** A labelled field with its own Save in the Details section, built on
  the same draft field as the title and the description, without a wand.
- **Start follows In progress's contract.** The approved design makes In progress a hint, and an
  always-ask Start broke nine tests and three journeys, so it was dropped. Start asks only where
  the project's In progress contract is `confirm` and has the `criteria` check, and only about
  criteria (whatever more the project asks of In progress). The default is a hint, so Start asks
  nothing. The question is the same dialog as a move's, with **Start anyway**. It is in the app
  only: the board's card menu, the card page's Start and Start in the background, and the
  command palette's Start card. The host's `card.start` is unchanged, so what starts cards on its
  own (dependencies, the queue, the manager) is never asked and never refused.
- **Not covered.** A move to In progress by hand still never asks, even where the contract
  confirms: only Start does.
