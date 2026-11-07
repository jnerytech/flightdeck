# Board stage contracts, second slice: the host keeps and checks them (issue #78)

Slice 1 (`2026-11-07-board-contracts.md`) was a checkpoint in the app. This slice moves the
contracts to the host and makes it check a person's move. Criteria on `card.start` stay for slice 3.

- **Shared logic.** The defaults, `contractOf` and `missingFor` live in `packages/protocol`
  (`board-contracts.ts`), so the app and the daemon cannot read a card differently. The app's
  `lib/board-contracts.ts` only passes the project's contracts along.
- **Contracts per project.** `Project.contractByColumn` (additive, `{}` by default, kept in
  `projects.contract_by_column`) holds a contract per column; `project.update` takes it, and `null`
  gives a column back to the default. A column the project leaves out keeps the default, and a
  project can also turn a column off (`checks: []`). Unknown columns and invalid contracts are
  refused with a reason.
- **The guard.** `Board.moveByHand` (the app's `card.move`) refuses a card that lacks what a
  `confirm` column asks, with the new code `contract_unmet`, the reason `card_contract_unmet` and
  the params `column` and `needs` (for example `pr,checksFailing`). A `hint` column never refuses,
  and a card already in the column is only reordered.
- **Force.** `card.move` takes `force` (additive). A forced move goes through and records a notice
  on the card (reason `card_moved_anyway`, same params), which the app says in its language ("Moved
  to In review anyway; it lacked a PR link"). The notice is cleared when the person moves the card
  on. A forced move of a card that lacks nothing records nothing.
- **Automatic callers are exempt by construction.** `moveCard` stays as it was and asks nothing.
  The manager (`manage.ts`), the board sync, the watch (service and fix) and PR events all call it;
  only `card.move` in `server.ts` calls `moveByHand`. Tests move cards through the manager, the
  sync and the watch under the strictest contract (every column asking everything) and check that
  nothing is refused, and one test fails if any other file calls `moveByHand`.
- **The app.** It asks with the project's contract and sends `force` only on Move anyway (for a
  group, on every card; Move only the ones that qualify sends none). A move it did not ask about
  that the host still refuses (a stale view) shows the host's reason through the usual error text.
- **Callers that moved to Review with no PR.** The demo creates its Review card there instead of
  moving it, and the board-sync smoke forces its moves. The finish dialog's Move to Done sends no
  force: Done asks nothing by default, and a project that sets a contract for it means it.

Left for slice 3: acceptance criteria asked on `card.start`, a spec or validation artifact, templates.
