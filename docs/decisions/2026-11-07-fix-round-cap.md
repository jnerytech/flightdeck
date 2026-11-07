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
  reason when the card needs you. Nothing is written for a skipped send.
- **A card whose PR is not watched gets the automation's send as before,** with no cap. Turning
  Vigiar on is how a person bounds the automatic fixes of a card.
- **The cap stays a project setting** (`maxRounds`), counted per card since the watch was last
  turned on (`round_base`).
- **The hand-over:** the card needs you when its rounds run out, or when enough rounds in a row
  fail. The watch keeps `needs_you` with the reason, which lists each round. A card in `review`
  then moves to the `waiting` column, which the board shows as "Needs you". A card in any other
  column stays: done is done, and a running card belongs to its session.
- **Drift is measured at the push gate,** deterministically, with git only (slice D3). A round
  drifts when:
  - it touches files outside the PR's footprint that its trigger does not name;
  - or its churn passes `max(200, footprint churn)`.

  Such a round is held, not pushed, until the person pushes it or drops it.

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
