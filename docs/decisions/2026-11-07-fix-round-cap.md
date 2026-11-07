# One budget of automatic fixes per card, and the drift gate (issue #77)

## Context

Bots that review a PR, and the fixes they trigger, can loop: each round asks for more, and the
feature drifts from what was asked. Flightdeck had two paths that change a card after its PR
opens:
- PR watch-and-fix (`watch/fix.ts`), which runs rounds under `maxRounds` (3 by default) and
  pushes them itself after the local checks;
- the automations' `send_to_card` on `ci_failed` and `pr_comment`, which had no cap at all.

## Decision

- **One budget per card.** The automations' send counts against the same `maxRounds` as the
  watch's own rounds. It is recorded in `pr_watch_rounds` with the status `sent`, so the counter,
  the rounds history and the ROI rework count see it. Past the cap the automation sends nothing,
  and its run records why.
- **The cap stays a project setting,** counted per card since the watch was last turned on
  (`round_base`).
- **The hand-over:** when a card's rounds run out, or a round fails in a way no new trigger fixes,
  the card moves to the `waiting` column, which the board shows as "Needs you". The watch keeps
  `needs_you` with the reason, which lists each round.
- **Drift is measured at the push gate,** deterministically, with git only (slice D3):
  - a round that touches files outside the PR's footprint, that its trigger does not name;
  - or a round whose churn passes `max(200, footprint churn)`.

  Such a round is held, not pushed, until the person pushes it or drops it.

## Discarded alternatives

- **A separate cap per automation:** a card would still loop across two paths.
- **An LLM judge of drift against the card's description:** non-deterministic, it costs a turn
  per round, and the reviewer's text it reads could steer it. It may come later as a second
  signal, never the only one.

## Consequences

- An automation that used to send every failure to a card now stops after the card's rounds. The
  person then allows more rounds (`watch.extend`, slice D2) or takes over.
- The rounds history shows the automation's sends as "asked of the card".
