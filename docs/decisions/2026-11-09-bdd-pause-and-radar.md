# BDD: pausing new runs on a host, and the conflict radar (issue #1440)

## Context

Two features of the night had unit and component tests but no journey: Pause new runs on a host
(#1404, PR #1415) and the conflict radar (#1405, PRs #1421 and #1424).

## Decision

- `host-pause.feature`, one scenario (en and pt-BR): with Pause new runs on (the host page, Settings
  tab), a card started on the scenario's own project says "waiting: host paused", the status bar
  names alfa as paused, and after Resume the card leaves the wait and starts. The scenario first
  resumes the host if a failed run left it paused, and ends resumed.
- `conflict-radar.feature`, two scenarios (en and pt-BR), on projects of the scenario's own:
  - two cards started with `[commit]` in the description each commit `fake-1.txt` (the fake Claude's
    first file, the same name in every card's folder); each tile then shows "May conflict with" the
    other, and the first card's Details name the other card and the shared file;
  - on a project with a remote and GitHub as its PR host, the first card's PR is opened from the
    app (the fake `gh` creates it) and the Merge PR confirm carries the line naming the other card.
- No seed change: everything is made through the app, in the scenario's own project and cards.
- Mutations, each red for the right reason: with the pause reason removed from `queueState` the card
  never says "waiting: host paused"; with `mayConflictOf` always empty, the badge and the confirm line
  never appear.

## Not covered

A pause with runs still going (`host-pause-ui` and the daemon tests hold the count), a paused host
that is far (the switch is near-only), more than two overlapping cards ("May conflict with N cards")
and the cap of 20 shared files.
