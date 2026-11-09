# A running session that says nothing is marked quiet (issue #1478)

From the research of #1475 (proposal 1). A session can show *Working* for an hour while a tool hangs,
the network is down or a prompt nobody sees waits, and nothing tells the person. Slice 1 marks it.

## The defaults

- **15 minutes** without any event (`stall.afterMinutes` in the daemon config; 0 turns it off and then
  there is no timer at all). Short enough to matter, long enough that a model thinking hard is not
  flagged: a turn is rarely silent for a quarter of an hour.
- **Twice that (30 minutes) while a tool call is open.** A build or a test run is silent on purpose;
  a call with no result yet is the commonest quiet that is not a stall. The row still names the last tool.
- **Only a `running` session.** One waiting on an approval is waiting for the person (it is already in
  Needs you), an idle one is idle, and a starting one has its own states.
- **"Any event" includes streamed deltas.** The store never persists `message.delta`, so the session's
  `updatedAt` stays old during a long answer. The manager keeps its own clock (`ActivityClock`) fed from
  `emit`, which sees every event; `updatedAt` is not used.
- **The unit** (`StallWatcher`'s `unitMs`, default one minute) can be shortened with
  `FLIGHTDECK_STALL_UNIT_MS`, as the journeys do (a "minute" of one second), so the BDD does not wait a
  quarter of an hour. Nothing reads it in production.

## Protocol

Additive. `quietSince` (ISO time of the last event) and `quietTool` (the last tool called, or `null`) are
optional on `SessionSummary` and on the live `session.summary` event. The host announces the feature
`stall` when it runs the watcher. It is not in `DAEMON_FEATURES`: it is announced only by a server given a
watcher, like `hostPause`. An older app ignores the fields; an older daemon never sends them.

## The app

- A *Quiet* row in Needs you after the requests, with **Open**, **Interrupt**, **Send "continue"** and
  **Not stuck, snooze 1 h**. Snoozing was kept in memory only at first; since #1554 it is kept in the app's
  storage until its time (the first version showed the row again after a restart), and a toast says when it comes back.
- One system notification when the summary first carries `quietSince` (the existing `needs-you` kind, so
  the person's notification settings apply), never for the first summary seen after a connect and never
  with the app in focus. The event stream clears the quiet state at once, so a later stall is a new one.
- A badge on the Working card of the Activity board.

## Left for later

A setting in the host page for the delay (today the config file), a "quiet" filter on the Sessions list,
and persisting the snooze.

- The watcher owns one timer while it is on (every 30 s, `sessions/stall.ts`); `daemon-idle.test.ts` lists it among the idle daemon's timers. `stall.afterMinutes: 0` starts none.
