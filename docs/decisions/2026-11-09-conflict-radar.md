# The conflict radar: which cards edit the same files (issue #1405)

## Context

Two cards in flight that edit the same file end in a conflict, found when the PR is merged. The
daemon already knows each card's worktree, so it can tell early.

## Decision

- **What counts as a card's files.** Its commits since the base (`git diff --name-only <base>...HEAD`),
  read again only when its HEAD moves, plus what it edits now (tracked changes and untracked files).
  The uncommitted part is read each time: an agent's work is mostly uncommitted until it ends.
- **Who is compared.** Cards of one project with a worktree that are not done. The variants of an
  arena are never flagged against each other: they edit the same files by design.
- **When.** A card is read when its turn ends and, once, for every card with a worktree when the board
  starts. A card that finishes, loses its worktree or leaves the board is dropped, and the cards that
  were flagged with it are announced again.
- **Scale (#1191).** An index from file to cards answers who shares a file without scanning the other
  cards. A load of 200 cards costs 4 git calls per card on the first read and 3 when its HEAD has not
  moved (`conflict-radar.test.ts`); the overlap lookup touches only the files of the card.
- **Safe git.** Every call turns `core.fsmonitor` off (a repository's config could name a program),
  reads at most 1 MB and runs for at most 10 s; a cut-off read is a failure and drops the card's flags.
  One read per card at a time; a read the card has moved on from keeps nothing.
- **On the wire.** `Card.mayConflict` (optional): the other cards' id and title, and the shared files
  (20 at most, 10 cards at most). The host announces `conflictRadar`. Read-only: nothing is merged,
  moved or blocked.
