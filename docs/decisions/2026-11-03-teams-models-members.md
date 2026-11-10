# Teams: models and members (issue #1711, moved from DECISIONS.md)

- **A member's model.** `teams.create` takes `coordinatorModel` and `workerModels` (one entry per
  worker, `null` for the default); `TeamMember.model` carries it back. No model means the
  persona's own model, then the runtime's default, because `SessionManager.create` already falls
  back that way. The coordinator gets it through `startCoordinator`; a worker through its card's
  `variant.model`, the field the session start already reads, so no migration was needed. The
  card's `variant` is also what marks an arena variant, but arenas are told apart by `arena_of`,
  which a team card never has.
- **The form is rows.** The worker count and the persona checklist became one row per worker (persona
  and model, add and remove, 1 to 8). The model list is `opus`, `sonnet`, `haiku`, the aliases the
  session bar already offers (shared as `MODELS`).
- **Members of a running team.** `teams.update` takes `addMember { persona, model }` next to the
  older `addWorkers` count, which stays for scripts. The persona is checked before the card is
  created, so a refusal leaves nothing behind. Removing a worker now interrupts its card
  (`stopCard`) before it leaves the team; the card stays on the board. A paused team refuses new
  members (`team_paused`), a closed one every change (`team_closed`), and the coordinator cannot
  leave (`team_coordinator_stays`); an unknown member is `team_member_unknown`. The coordinator
  is told through the existing system notice, which now names the persona and model.
