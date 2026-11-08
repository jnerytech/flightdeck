# Scale: what the app does with 200 sessions on 4 hosts, and its budgets (issue #1191)

## Context

Nothing measured the app or the daemon at a few hundred sessions across hosts. A load of 4 hosts with
50 sessions each, measured in happy-dom on the Pi (the shape counts, not the milliseconds), showed:

| What | 20 sessions | 200 | 400 / 800 |
| --- | --- | --- | --- |
| Connect: renders of each screen | 20 | 200 | 400 (one per session) |
| Connect: time | 0.5 s | 7.7 s | 22.5 s at 400 (quadratic) |
| Burst of 20 summaries of one session: Needs you render time | 134 ms | 746 ms | 1541 ms at 800 |
| Same burst: Sessions, sidebar render time | 189 / 281 ms | 294 / 303 ms | 397 / 354 ms at 800 |
| Same burst: the store's own work, no React | 28 ms | 34 ms | 104 ms at 800 |
| Same burst: Hub requests | 0 | 0 | 0 |

- **Connect.** The daemon answers `sessions.watch` with one frame per session. The app updates its
  state once per frame, and each update renders the whole tree, so the cost is O(N²) in sessions.
  This is the worst case found.
- **A summary renders every screen.** Each screen gets `state` from `App` and is not memoized, so it
  commits once for every summary, whatever changed. Needs you redraws all of its rows each time, so
  its cost grows with the sessions.
- **Cheap already.** The store itself is cheap. `updateHost` keeps the hosts and sessions it does
  not touch as the same objects. The Hub asks its hosts again only when sessions come or go.

## Decision

- **Budgets are counts, measured in process through the real paths.** Commits come from React's
  `Profiler`, and requests from counters. The burst goes through the store's `onEvent`/`onSummary`,
  or through a real in-process daemon. Wall-clock time is a report, never a gate: CI runners are
  too noisy for it.
- **The bar is the issue's: 200 sessions in total on 4 hosts.** Larger loads are reported. At 800,
  happy-dom passes CI's 5 s per-test limit.
- **First fix: the connect.** `sessions.watch { snapshot: "ack" }` carries every session's current
  summary in its ack: one frame for them all. The live summaries come as before. The host says it
  can in `hello` (`features: ["watch.snapshot"]`), because the app asks before `host.info` answers.
  The app applies a host's summaries as one change of its sessions (`onSummaries`). Each summary
  still raises its own unread mark, notification, webhook and finished record, in order. An older
  host gets the old request.
  - Budget (`scale-connect.test.tsx`): connecting to 4 hosts with 50 sessions each commits at most
    12 renders per host. It was 239 in total; with the fix it stays within the budget, and the test
    takes 4 s instead of 17 s.
- **Second fix: the rows of Needs you.** `EntryRow` is a memoized component in its own module. It
  compares what it shows (the entry's own record, field by field), because the list rebuilds its
  entries on every change. Its parent passes one stable handler and the chip as a value. A
  `minute` prop lets "time ago" move on once a minute.
  - Budget (`scale-needs-you.test.tsx`): a burst of 10 summaries of one session, at 200 sessions,
    redraws at most 3 rows per summary. It was 529. The test wraps the row's module and keeps the
    row's own memo, so a row that is not memoized counts every render of the list.
- **Next, one PR each, red budget first:**
  - the Sessions and sidebar rows;
  - `App`'s root `useStoreState`.
  Each of these is measured as the rows of the other sessions that render on one session's burst.
  Batching inside `update()` comes last, and only if a budget still fails: many tests assume its
  listeners run at once.

## Discarded alternatives

- **Batching summaries in the app on a timer.** It would delay what the person sees, and it would
  break every test that reads the state right after an event. One frame from the host does the
  same without a clock.
- **Wall-clock budgets in CI** ("first render < 300 ms"). Shared runners make them flaky.
- **Virtualized lists.** Not needed at 200 sessions once rows stop re-rendering. Revisit if the
  first render of 800 matters.

## Consequences

- `sessions.watch` and `hello` each gain an optional field. Old apps and old hosts keep the old
  path, which `sessions-watch-snapshot.test.ts` covers.
- A host with hundreds of sessions sends one large frame on connect: about 300 bytes per summary,
  so 60 KB for 200 sessions.
