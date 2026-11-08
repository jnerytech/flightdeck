# BDD: Merge PR held for a review (issue #1196)

## Context

fd-coordinator asked for `.feature` files for what shipped after round 4. The demo seed (#1247)
gives the In review card an open pull request whose merge the fake `gh` refuses, as GitHub does for a
branch that needs a review.

## Decision

- `merge-pr.feature`, two scenarios (en and pt-BR, 6 to 17 s each on the Pi):
  - asking to merge the card's pull request as Squash and merge shows the PR in the dialog; the card
    then says the PR needs a review, links to the PR, and offers Merge PR again;
  - cancelling the dialog leaves the card offering Merge PR.
- Own state: none to make. Nothing is merged, so the seeded card is the same in the English and the
  Portuguese run, and the scenarios leave it as they found it.
- It goes red when the confirm click is cut: the refusal never appears.

## Not covered

A merge that succeeds (the card moving to Done, "The PR was merged.") and the Merge commit choice:
the demo's `gh` has no PR it would merge, and a merged PR would change shared state for the next
language run. `card-merge-pr-ui` and `card-merge-pr-wire-ui` hold both.
