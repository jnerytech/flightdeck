# BDD: Update N from the base (issue #1463, for #1406)

## Context

Update N from the base (#1406, PR #1453) rebases the selected cards one at a time and names each
outcome. Its unit and component tests hold the rules; no journey ran it against real worktrees.

## Decision

`update-many.feature`, one scenario (en and pt-BR, 39 to 49 s on the Pi), on a project of the
scenario's own, no seed change:

- Two cards start and finish: the first commits `fake-1.txt` (`[commit]` in the description), the second
  changes nothing. The base branch then gets its own `fake-1.txt` with other text, and a third card
  starts on the new base.
- The three are selected (Ctrl-click) and "Update 3 from the base" is pressed. The summary names the
  second card as updated, the third as already current, and the first as a conflict.
- The conflicted card is left as it was, checked in its worktree with git: the same commit, a clean
  tree, no rebase left open, and the base commit not in its history. The updated card holds the base
  commit.

Mutations, each red for the right reason: `updateFromBase` doing nothing (the summary never names the
conflict); the rebase not aborted after a conflict (the card's branch moved).

## Not covered

A card with no branch yet, a card that is running (not offered), a failed request that is not a
conflict ("Not updated"), progress text while the run goes, and the narrow bar where the action sits
under the more menu: `board-bulk-ui` holds them.
