# Splitting the board by domain (issue #1523)

`apps/daemon/src/board/board.ts` has 3,069 lines and took 66 commits on main in one day. Every board
feature lands in the one `Board` class: projects, card creation and blockers, the arena, the run
queue and its holds, moves and the card's end, project rules, PRs and their poll, the conflict
radar, the session follow and the check loop. PRs conflict there, and SonarCloud's findings pile up
(S3776 at `board.ts:2830`, `onSessionEvent`). The split moves each domain into a module of its own
behind the same `Board` API. It changes no behavior: every method, refusal, event and order stays
as it is, and the board's tests are the check, unchanged.

## Decision

**Collaborator classes behind a facade.** Each domain becomes a class in `board/<domain>.ts` that
owns its own mutable fields and reaches the rest of the board through a narrow port, the pattern
the board already uses for `WorkflowEngine` (its `host`: `place`, `release`, `acquire`,
`takeSlots`, `waitQuota`, `card`...). `Board` stays the one class the daemon and the tests import:
it builds the collaborators, keeps the core, and each public method becomes a one-line delegate.

**The core stays in `board.ts`.** `db`, `opts`, `getCard`, `changed`, `emit`, `place`,
`setNotice`/`clearNotice`, the card watchers, `stopped`, the constructor and `stop()`/`idle()`.
Every domain reads and writes cards through these, so none of them imports another domain.

**Ports, never import cycles.** Calls run in loops today: a release pumps the queue, the queue
launches a run, the launch follows the session, a session event places the card and releases its
slot. A collaborator gets what it calls in another domain as late-bound closures in its port
(`release: (id) => this.queue.release(id)`), as `WorkflowEngine` does. A domain module never
imports `board.ts` or another domain module. It may import the board's existing helper modules
(`pr.ts`, `merge.ts`, `conflict-radar.ts`, `check-loop-engine.ts`, `project-rules.ts`,
`worktree.ts`, `spec.ts` and the rest), which stay as they are and import no domain module. Types
come from `@flightdeck/protocol` or `board/types.ts`, which step 0 below fills.

**Rejected.**

- *Free functions over a shared core* (`startCard(core, id)`, every field on the core). It is the
  most mechanical move, but every field stays on `Board`, so ownership is still one bag of state
  and the facade never thins.
- *Methods attached to `Board.prototype` from other files* (declaration merging). No call site
  changes, but privates do not type across files, and Sonar and Biome read it badly.
- *A new service layer with its own events.* More surface than the problem needs.

## Module map

Line numbers are from `origin/main` at `0ccbe3ad0`; sizes are estimates. The names avoid the
existing helper files (`project-rules.ts`, `conflict-radar.ts`, `pr.ts`, `check-loop-engine.ts`):
a domain module is the stateful part that uses them.

| Module | Owns | From `board.ts` | ~Lines |
| --- | --- | --- | --- |
| `projects.ts` | list, read, add, update, `forWire`, `projectForCwd`; `toProject`, contracts, personas, pins, spec path | 206–345, 547–725 | 330 |
| `rule-writes.ts` | `ruleWrites`, list/remove rules, `applyProjectRules` | 2064–2110 | 60 |
| `arena.ts` | `startArena`, `arena`, variants, `chooseVariant` | 994–1183 | 190 |
| `blockers.ts` | blockers, `unsatisfied`, `dismissUnblocked`, `afterBlockerChange`, waiting | 1258–1402 | 150 |
| `run-queue.ts` | `running`, `waiters`, `quotaWaiters`, `limit`, the four unwatchers; `startCard`, `pump`, `queueState`, holds (`budgetHeld`, `budgetBlocked`, `waitQuota`, `onLimits`), `acquire`, `takeSlots`, `release`, `maxParallelRuns` | 1535–1727, 2616–2627 | 260 |
| `launch.ts` | `launch`, `startSpec`, `firstSession`, `closeRuns`, `finish`, `removeCleanWorktree`, `failRun` | 1742–1906 | 170 |
| `card-pr-flow.ts` | `diff`, `createPr`, `mergePr`, PR comments and their cache, `updateFromBase`, `mergeLocal`, `removeMerged`, `commentOnIssue` | 2141–2412 | 280 |
| `pr-poll.ts` | the poll timer and round, `onPrRound`, `pollPrs`, `readPr`; `checkWatchers` and `onChecksFailing`, which only `readPr` fires | 2495–2615 | 125 |
| `radar-feed.ts` | `radar`, `radarReads`; refresh, read, drop, `mayConflictOf` | 2686–2773 | 90 |
| `session-follow.ts` | `follows`, `fixes`; `follow`, `onSessionEvent`, `newTurn`, `releaseAfter`, `personTurnOfSession`, `fixCard` (done, #1523 move 2) | 1477–1504, 2818–2900 | 170 |
| `check-loop-host.ts` | `loop`, `unreadableLoopSettings`; `storeCheckLoop`, the engine's port, `checkLoopOf`, `loopCard`, `loopLimit`, `recordRound`, `sweepCheckLoops` | 1422–1451, 2902–3069 | 200 |
| `card-lifecycle.ts` | `moveCard`, `moveByHand`, templates, `refreshSpec`, `stopCard`, complete, discard, delete | 1907–2063, 2413–2494 | 250 |

| `cards.ts` | `createCard`, `createCardFrom`, `raiseCards`, `cardTemplates`, `cardForIssue`, `updateCard` | 725–781, 866–993, 1184–1257 | 260 |

What stays in `board.ts`: the core above, `getCard` (it composes the queue, radar and loop views
through their collaborators), the constructor and teardown, and about 75 delegates. The ranges
above move about 2,500 of the 3,069 lines; step 0 moves about 120 more (row types, options).
What is left is roughly 450 lines of core, constructor and imports, plus 3 to 4 lines per
delegate, so about 700 to 750 lines. `cards.ts` is needed for that, not optional.

## Rules every move keeps

- **The constructor's order is behavior.** Today: workflows, limits, the permission-update hook,
  the four limit watchers, `armPoll`, the loop engine, `sweepCheckLoops`, follow the live runs,
  `workflows.recover()`, the blocker re-check, `pump`, the radar refresh. All collaborators are
  built first, without side effects; the constructor then runs these steps in this order.
- **`stop()` owns teardown**, as `close()` did in the server split: each collaborator with state
  has a `dispose()`, and `stop()` calls them in today's order (timers, unwatchers, the `stopped`
  flag, the follows).
- **Tests stay unchanged.** The two tests that reach a private through a cast keep it as a private
  delegate on `Board`: `sync-git.test.ts:205` (`budgetBlocked`) and `check-loop-board.test.ts:616`
  (`onSessionEvent`).
- **The pinned caller lists move with their callers.** `deps-gate.test.ts` lists, exactly, the files
  that match `.startCard(`; `board-contracts.test.ts` the files that contain `moveByHand(`. Calls
  through a port match too. Three moves add a `startCard` caller: `arena.ts` (the arena, 1046),
  `blockers.ts` (the auto-start of an unblocked card, 1323) and `session-follow.ts` (the fix run,
  1480). `card-lifecycle.ts` joins the `moveByHand` list, since it defines it. Each list changes in
  the move's own commit: it is a consequence of the move, and a test commit before it would fail.
  `refusal-english.test.ts` pins each Portuguese string the board shows to its file; the string
  and the new file go into its lists in the move's commit too.
- **Coverage per file.** The 80% gate holds each new file to itself. Before a move, run
  `bun run coverage:funcs <file> --tests <its tests>` on the extracted module. If it is under, add
  the missing test first, in a `test(board-split)` commit.
- **Sonar moves with the code.** A new file counts as new code, so an old finding in a moved range
  shows on that PR. The module that receives it fixes it in the same PR, in its own commit after
  the move. Today that is S3776 and S7737 in `onSessionEvent` (to `session-follow.ts`), S9382 at
  2698 (to `radar-feed.ts`) and S7059 at 544, the constructor's async radar refresh (stays in
  `board.ts`; fixed with the last move).

## Order of the moves

No open PR touches `board.ts` today (2026-11-09), so the hot domains go early, while the window is
quiet. Moving them last, as #1288 did, would only make them conflict longer.

0. The row types (`CardRow`, `RunRow`, `ProjectRow`) and `BoardOptions` move to `board/types.ts`,
   and `board.ts` re-exports `BoardOptions`, so no import elsewhere changes.
1. `projects.ts` and `rule-writes.ts`: no shared state. These prove the port and the facade.
2. `session-follow.ts`, with the S3776 cut in a second commit.
3. `run-queue.ts` and `launch.ts`: the queue and the holds.
4. `check-loop-host.ts`.
5. `card-pr-flow.ts` and `pr-poll.ts`.
6. `radar-feed.ts`, `arena.ts` and `blockers.ts`.
7. `card-lifecycle.ts` and `cards.ts`, then S7059 and the size check.

**Each move.**

- One PR with one `refactor(board-split)` commit for the move. Before it come the `test` commits a
  rule above calls for; after it, the Sonar fix.
- Locally: typecheck, the test files that name the domain, and `board-contracts`, `deps-gate`,
  `sync-git`. `test:related` on `board.ts` reaches more than 60 files: the PR's CI runs them.
- Before the push, one line to every session naming the methods that move and their new file.

## Exit criteria

- `board.ts` is a facade under about 800 lines.
- No function in `board/` is above cognitive complexity 15, and the S3776 at `board.ts:2830` is
  gone.
- No domain module imports `board.ts` or another domain module.
- The board's tests pass unchanged except for the pinned caller lists.
