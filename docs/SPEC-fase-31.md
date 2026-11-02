# Flightdeck — Phase 31 spec (Card dependencies: blocked by)

## Goal

A board card is one worktree plus one session. Real work has order: the API card must be merged before the card that
calls it starts, or the second session builds on code that is not there. Today the person keeps that order in their
head: they start cards by hand, or they start all of them and fix the conflicts later. Two parts of the product make it
worse: the host's slot queue (`maxParallelRuns`) starts cards oldest first, with no idea that one depends on another,
and automations and workflows can start a card on their own.

This phase adds **dependencies between cards**: a card can be *blocked by* other cards. A blocked card cannot start,
says why, and can start by itself when its blockers are done, if the person asked for that. The board shows the chain.
Nothing is required: a card with no blockers behaves exactly as before.

Origin: a request relayed on 2026-11-02 (user-approved phase). Prerequisites: Phase 4 (board), Phase 6 (workflows),
Phase 7 (queue and quota), Phase 8 (budgets, the other reason a queued card waits), Phase 22 (PR watch and fix) and
Phase 23 (automations).

**Out:** dependencies between sessions that are not cards, between hosts, "relates to" and "duplicates" links, a graph
or Gantt view, dependencies that change a card's column by themselves (only *start* is gated), and blocking `card.move`
(moving a card by hand is how the person overrides the plan).

## Research (2026-11-02)

What comparable tools do, and what to take from it:

- **Linear** ([issue relations](https://linear.app/docs/issue-relations)): relations are *blocked by* / *blocking* (and related, duplicate). A blocked issue
  carries an orange flag in the sidebar; when the blocker is resolved the flag turns green and the item moves under
  Related. Nothing stops the person from starting or closing the blocked issue. Take: **the green "now unblocked"
  state is the useful moment**, and a visible reason beats a hard lock.
- **Jira** (issue links, [auto-flagging community post](https://community.atlassian.com/forums/discussion/3281980/no-more-hidden-dependencies-auto-flagging-blocked-and-blocking-work-with-jira-automation)): "blocks" and "is blocked by" are the two ends of one link, created together. The board
  does not show link types by default, so people rebuild it with JQL filters, flags or automation that adds a prefix to
  the summary, and remove it when no open blocker is left. Take: **one stored link, two views** (blocked by on one card,
  blocking on the other), and **the badge must be built in**, not left to the person.
- **GitHub Issues** ([creating issue dependencies](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-issue-dependencies)): *blocked by* and *blocking* in a Relationships sidebar, the same two
  ends, readable from the CLI (`--blocked-by`, `--blocking`, `blockedBy` in JSON); cross-repository references use
  `owner/repo#n`. It needs triage permission to edit. Take: **the same two-ended model, plain ids, and an explicit
  edit action**; the cross-repository form exists but costs an identity scheme.
- **Huly** ([related and blocking issues](https://docs.huly.io/task-tracking/related-issues/)) says plainly that its blocking does **not** stop the blocked issue from being completed. **GitLab**
  ([linked issues](https://docs.gitlab.com/ee/user/project/issues/related_issues.html)) asks for confirmation when someone closes an issue that is blocked. Take: trackers differ on enforcement; here the gate
  is on **start**, where the damage happens (a session spends money on top of missing code), with a refusal that names
  the blockers.
- **Zenhub** ([issue dependencies](https://support.zenhub.com/article/how-do-i-create-issue-dependencies)): bidirectional, across repositories of a workspace. Take: cross-project is wanted, but see the open choice.

What fails, in short: **a flag nobody sees** (Jira's default board), **a lock the person cannot get around** (they stop
trusting the board), **a link with only one end shown** (the blocker has no idea it holds others up), and **cycles that
silently deadlock**. The design answers each: a built-in badge on both ends, a refusal that is a sentence and not a
silent disabled button, an explicit manual override (move the card), and cycle refusal when the link is made.

## Design

### The model

- A card has an ordered set of **blockers** (`blockedBy`): other cards of the **same project** on the same host. The
  other end, **blocking**, is derived, never stored twice. Stored in one table, `card_blockers (card_id, blocker_id)`,
  with `ON DELETE CASCADE` on both ends.
- **A blocker is satisfied** when its card is in the **Done** column (a merged PR moves it there; so does "Complete"),
  or, if the blocked card asked for `merged`, when its PR state is `merged`. The condition is a setting of the blocked
  card: `unblockWhen: "done" | "merged"`, default `done`. A blocker that is
  **discarded or deleted** (its card removed, with the project or by hand) leaves the set in the same step, because a card
  that is gone can never be done: the dependent never stays blocked by a ghost. If that was its last unsatisfied blocker
  the dependent is unblocked at once (the unblocked mark and notification, and the auto-start if it is on), and a notice
  on the card says which blocker left.
- A card is **blocked** while any blocker is not satisfied **and it has not started** (no run). Once a card has a run,
  its blockers are history: they stay listed, the card is not "blocked" any more, and `card.fix` runs (Phase 22) are never
  gated, since the PR already exists.
- **Cycles and limits:** a link that would close a cycle (including a card blocked by itself) is refused when it is made,
  with the cycle named. At most 20 blockers per card. A blocker in another project is refused (`blocker_other_project`).
- **Auto-start** is optional per card: `autoStart: { workflow: string | null } | null`. When it is on and the last blocker
  becomes satisfied, the daemon starts the card as `card.start` would (the column's default persona, the chosen workflow
  if any). The start goes through the normal queue, so slots, the plan quota and budgets still apply. With it off, the
  card gets an **unblocked mark** (`unblockedAt`) and a desktop notification, until the person starts it or dismisses the
  mark.
- **The base the run starts from.** A card that has blockers creates its worktree from the base branch **as it is after
  the blockers merged**, so it sees their code. Before `git worktree add`, the daemon runs `git fetch origin <base>` (when
  the repository has an `origin`; a failed fetch is a notice on the card and the run goes on with the local base), then
  starts from `origin/<base>` if the local base is an ancestor of it (the PR was merged on the remote and the local
  branch is behind), else from the local base (a local merge, Phase 4, already moved it). It never moves the local base
  branch, which may be checked out. Cards with no blockers keep the old path: no fetch, the local base.
- **Daemon restart:** on boot the daemon re-evaluates every card that has `autoStart` and no run. A blocker that became
  done while the daemon was down starts its card once, never twice (the run row is the guard).

### Where the gate is

One check in the board's start path (`startCard`, and so `startArena`, `card.start` from the app, the MCP tool, the
automation action and a workflow step that starts a card). It throws `invalid_state` with `reason: "card_blocked"` and
`params: { blockers: "<titles>" }`. Nothing else starts a card, so nothing can skip it. The app translates the reason
(`daemonRefusal.card_blocked`, both languages) and the Start button shows the sentence, not only a disabled state.

`card.move` is not gated: moving a blocked card to *In progress* by hand moves a pin, it starts nothing. Moving a card to
Done by hand does satisfy the cards it blocks.

### Protocol

- `Card` gains, all optional with defaults (an older daemon parses): `blockedBy: string[]`, `blocking: string[]`,
  `waitingOn: string[]` (the blockers not yet satisfied), `unblockWhen`, `autoStart`, `unblockedAt`.
- `card.create` and `card.update` take `blockedBy`, `unblockWhen` and `autoStart` (replacing the set). `card.dismissUnblocked`
  clears the mark. Validation (same project, no cycle, limit) is in the daemon; the app only offers valid choices.
- `HostInfo.features` gains `deps`; the app hides the section on a host without it.
- The existing board update path carries a changed card; changing a blocker's column re-sends the cards it blocks.

### The app

- **Board card:** a "Blocked · N" badge (lock icon, the number of unsatisfied blockers) and a "Blocking N" chip on a card
  that holds others up, both with the card titles in their tooltip. A card that just became unblocked wears an "Unblocked"
  mark. Badges use the existing status primitives, so they pass axe in both themes.
- **Card detail:** a "Blocked by" section: the blockers with their column and PR state, a remove button on each, an "Add
  blocker" picker (cards of the project that are not the card itself and would not close a cycle), the `done`/`merged`
  choice, the auto-start switch with the workflow picker, and a "Blocking" list. The indirect chain shows as an indented
  tree to depth 3 ("and 2 more").
- **Start:** the Start button of a blocked card is enabled, and a click shows the refusal sentence with the blocker
  titles; it never fails silently. The New card dialog has no Start button (a new card is always created in the Backlog); blockers are set from the
  card's detail, or by `card.create` with `blockedBy` for other clients.
- **Filter:** a "Blocked" toggle in the board filters, next to the existing ones.
- Strings in `en.ts` and `pt-BR.ts`; the manual and the README mention it (both languages).

### What the other features do

- **Automations** (Phase 23), **teams** and **workflows** (Phase 6): see "Where the gate is". They only start a card
  they made, which has no blockers, so none of them needs to know about dependencies (a test lists every caller of
  `startCard` so a new one is checked).
- **Queue and budgets:** a blocked card is not queued (it has no run). `queueReason` stays slot, quota or budget, for
  cards that are not blocked.
- **Arena** (Phase 13): variants have no blockers of their own; the arena's parent card is gated.
- **Clients** (Phase 29): nothing to do; dependencies are inside one project, so the client filter keeps both ends.

## Tests and criteria

| Area | What must pass |
| --- | --- |
| `deps-model` | add, replace and remove blockers; the two ends agree; same project only; self link, two-card and long cycles refused with the cycle named; the 20 limit; a discarded or deleted blocker leaves the set with a notice, and a dependent whose last blocker left is unblocked (mark, notification, auto-start if set) and never stays blocked by a ghost; `ON DELETE CASCADE` |
| `deps-state` | blocked while a blocker is unsatisfied and the card has no run; `done` versus `merged`; a card with a run is not blocked and a fix run is never gated; moving a blocker to Done by hand satisfies; reopening a blocker blocks again only cards that have not started |
| `deps-gate` | `card.start`, `startArena`, the MCP tool, an automation action and a workflow step all get `invalid_state` with `reason: "card_blocked"` and the titles; a card with no blockers is untouched; `card.move` is not gated |
| `deps-autostart` | the last blocker satisfied starts the card once through the queue (slots, quota and budget respected); a card with auto-start off gets `unblockedAt` and a notification; a restart evaluates cards whose blocker finished while down, once; dismissing clears the mark |
| `deps-base` | a card with blockers fetches `origin/<base>` and starts from it when the local base is behind (PR merged on the remote), so the blocker's file is in the new worktree; from the local base after a local merge; a failed fetch is a notice and the run still starts; a card with no blockers does not fetch; the local base branch is never moved (real git, a bare `origin` in the test) |
| `deps-protocol` | the new `Card` fields default and an older daemon's card still parses; `card.create`/`card.update` carry them; `deps` in `HostInfo.features` |
| `deps-ui` | the badge, the chip, the unblocked mark, the detail section (add, remove, picker without cycle choices, `done`/`merged`, auto-start with workflow), the refusal sentence on Start, the Blocked filter, an old host without `deps`; both languages, both themes; axe clean |

A smoke, `smoke:deps` (printing `SMOKE DEPS OK`): a real daemon over WebSocket with the fake claude creates two cards,
links them, sees the refusal, finishes the blocker and sees the second start by itself. The prints (`demo:shots`) gain a
board with a blocked chain, the detail section and the refusal. The e2e journey `dependencias` links two cards on the
demo board, sees the badge, sees the refusal on Start, moves the blocker to Done and sees the unblocked mark.

**Acceptance criteria:** the usual ones, and these: with no blockers defined every screen and print is pixel-identical to
before; no path starts a blocked card (the gate test enumerates the start paths, so a new one fails it); a cycle can never
be stored; a card that has a run is never blocked again; auto-start starts a card at most once; a card never stays blocked by a discarded blocker; a card that waited on `merged` sees the blocker's code.

## Open choices (recommendation first)

1. **Same project only, or any card on the host.** Same project only. A card's session builds on its blocker's *merged
   branch*, which only makes sense inside one repository; across projects the link would be a reminder, not a build
   order, and it needs an identity (`projectId#cardId`) the app does not show today. **Recommend same project;** a
   `crossProject` flag can come later with no stored-shape change (the table already holds ids).
2. **What satisfies a blocker.** Done column by default, `merged` as an option over only one of them. *Done* is also set
   by "Complete" and by hand, so it works with no PR provider; `merged` is what a person wants when the next card must
   start from the merged base. **Recommend both, default `done`.**
3. **Hard gate or warning.** Gate on start, with a manual way around (`card.move`) over a warning only. Linear and Huly
   warn only; the cost here is a paid session on missing code, so the refusal earns its place. **Recommend the gate,
   named in a sentence, not a silent disabled button.**
4. **Auto-start default.** Off. Starting a session spends money and quota, so the person turns it on per card.
   **Recommend off,** with the unblocked mark and notification as the default way to notice.
5. **A discarded blocker.** It leaves the set and the card says so, and the dependent is unblocked in that step, over keeping a dead link that blocks forever. **Recommend leaving the set.**
6. **Daemon storage.** The daemon, in the card's own database, over the app. Dependencies are state the daemon needs
   (gate, auto-start, restart) and several desktops share a host. **Recommend the daemon.**
