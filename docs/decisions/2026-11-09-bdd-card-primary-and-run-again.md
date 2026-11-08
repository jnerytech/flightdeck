# BDD: the card's main button and Run again (issue #1197, #1219)

## Context

fd-coordinator asked for `.feature` files (en + pt-BR, own state, under 90 s) for what shipped
after round 4. This slice covers the card's one main button (#1197) and Run again on a failed
workflow run (#1219).

## Decision

- `card-primary.feature`: a card made by the scenario leads with Start; Finish and Discard are
  not on the page until the card's menu opens; pressing Start turns the same button into Review
  changes, with the focus still on it (the one-element rule of #1197). About 16 to 18 s.
- `run-again.feature`: a project of the scenario's own commits a workflow whose check fails the
  first time and passes the second (`test -e .bdd-attempt || { touch .bdd-attempt; exit 1; }`),
  the scenario trusts it on the Workflows page, starts a card with it from the board's menu, sees
  Run again once the run failed, presses it, and sees the second run complete. About 25 to 30 s.
  The second run passes so the end state is visible: a run that fails again re-keys the Run again
  note (#1219) and "Started again." would flash for under a second.
- Both show red when their key step is cut (Start not pressed; Run again not pressed).

## Not covered

The reasons Run again is off (the workflow file changed, has errors, or is gone) and the Stop
and Open PR leads: the component tests hold those (`run-again-ui`, `card-primary-ui`); a
scenario would need a second committed workflow state per reason. The idle-session Stop in the menu.
