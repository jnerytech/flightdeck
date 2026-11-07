# The watch alone fixes a watched PR, the Needs you hand-over, and the drift gate (issue #77)

## Context

Bots that review a PR, and the fixes they trigger, can loop: each round asks for more, and the
feature drifts from what was asked. Flightdeck had two paths that change a card after its PR
opens:
- PR watch-and-fix (`watch/fix.ts`), which runs rounds under `maxRounds` (3 by default) and
  pushes them itself after the local checks;
- the automations' `send_to_card` on `ci_failed` and `pr_comment`, which had no cap at all.

On a watched card both paths fire for the same failure. Both reach the same card session: the
watch through `fixCard`, the automation through `board.message`. So one failure ran twice, and the
automation's send went around the watch's cap.

## Decision

- **While a card's PR is watched, the watch alone fixes it.** An automation's `send_to_card` for
  that card is skipped, and its run records why: "the PR watch fixes this card", or the watch's
  reason when the card needs you. Nothing is written for a skipped send. A watched card the watch
  cannot fix (no worktree of its own, or its branch is the base) gets nothing either: the watch
  hands it to the person at once, with that reason.
- **A card whose PR is not watched gets the automation's send as before,** with no cap. Turning
  Vigiar on is how a person bounds the automatic fixes of a card.
- **The cap stays a project setting** (`maxRounds`), counted per card since the watch was last
  turned on (`round_base`).
- **More rounds (slice D2):** `watch.extend { cardId, rounds }` adds to the card's own
  `extra_rounds`, so its limit is `maxRounds + extra_rounds`. It does not move `round_base`: that
  would also forget the turns and the money of the older rounds, and more rounds must never
  forgive spent money. It is refused for a card whose PR is not watched, and for one that another
  limit (turns, money, its branch) would stop anyway. A card the watch handed over is watched
  again and goes from "Needs you" back to review; on any other card only the limit changes.
  Turning the watch on again resets both.
- **The hand-over:** the card needs you when its rounds run out, or when enough rounds in a row
  fail. The watch keeps `needs_you` with the reason, which lists each round. A card in `review`
  then moves to the `waiting` column, which the board shows as "Needs you". A card in any other
  column stays: done is done, and a running card belongs to its session.
- **Drift is measured at the push gate (slice D3),** deterministically, with git only, against
  what is pushed:
  - the footprint is the PR as it stands: `merge-base(origin/<base>, origin/<branch>)..origin/<branch>`;
  - the round is `origin/<branch>..HEAD`, over the files the PR changes after it, so a merge of the
    base into the branch adds nothing;
  - a round drifts when it touches a file outside the footprint that its review comments do not
    name, or when its churn passes `max(200, the footprint's churn)`. Files matching the project's
    `driftAllow` globs (lockfiles and `*.snap` by default) never count.

  This differs from the design posted on #77, which recorded a `round_start` per round and kept
  the first round's footprint. Measuring against what is pushed needs no new column, includes
  every unpushed commit (a held round's commits cannot slip out with the next round), and is
  right after a merge of the base. A held round the person pushes widens the footprint: pushing
  it is how the person accepts it.
- **A held round** keeps its commits and the HEAD it was held at (`held_sha`). The card goes to
  "Needs you" with the files and the churn. A round git cannot measure is held too (fail closed),
  with git's first error line. `watch.resolveHeld` pushes exactly the held commit (never forced)
  or resets the branch with `--keep` to the HEAD the round started from (`base_sha`), so work
  committed before the round stays. It is refused when the branch moved
  since the hold, so neither unmeasured commits are pushed nor later work dropped.
- **More rounds while a round is held** start a new round on top of the held commits. That round
  is measured with them, so it is held again. This is safe, but it spends a session: resolve the
  held round first.

## Discarded alternatives

- **One budget shared by the watch and the automations** (the first version of #817): it capped
  cards whose project never turned the watch on. It also still fixed one failure twice on a
  watched card, so a single failure cost two of its rounds.
- **A separate cap per automation:** a watched card would still be fixed twice per failure.
- **An LLM judge of drift against the card's description:** it is not deterministic, it costs a
  turn per round, and the reviewer's text it reads could steer it. It may come later as a second
  signal, never as the only one.

## Consequences

- On a watched card, an automation that sends failures or comments to the card stops sending; the
  watch's rounds do that work. Its run history says so.
- Out of rounds, the person allows more rounds (`watch.extend`, slice D2) or takes over.
