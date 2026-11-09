# BDD: a card at a gate leads with the gate (issue #1269)

## Context

While a workflow run waits at a gate, the card's primary button used to be Open PR, next to the
gate's Approve: two primaries (#1269, fixed in #1282). It had unit tests and no journey.

## Decision

- `card-gate-primary.feature`, one scenario (en and pt-BR, 8 to 11 s on the Pi): the demo's card that
  waits at a gate (`DEMO_GATE_CARD`, a name the seed and the steps now share) shows the gate with
  Approve and Deny, and its run panel holds no main button, only the card's actions menu.
- Own state: none to make. The scenario only reads: it never answers the gate, so the English and the
  Portuguese run see the same waiting card.
- It goes red when the fix is undone (`gateWaiting={false}` in `CardDetail`): the panel then holds
  `Open PR` besides its menu.

## Not covered

Answering the gate (Approve moves the run on and would change the shared card): the approval
journeys and `card-opens-on-changes-ui` hold what happens after an answer, including the card going
back to Open PR once the gate is answered.
