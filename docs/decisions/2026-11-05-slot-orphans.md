# The slot survives nested calls and orphan waiters (issue #236)

- **What happened.** A `test:related` run held the slot for 2 h 12 min. Its inner `slot --` came
  from an older `slot.ts` with no `FLIGHTDECK_SLOT_HOLDER`, so it waited for its own ancestor. Four
  more waiters were orphans (parent pid 1) whose sessions had moved on. One of them had been queued
  for 5 h 42 min.
- **Ancestry.** Before queuing, a run walks up its parents through `/proc`, for at most 64 steps.
  When one of them is the live lock holder, the run starts at once, as it does with
  `FLIGHTDECK_SLOT_HOLDER`. This covers a holder variable that got lost, and a holder from an older
  `slot.ts`.
- **Orphans give up.** A waiter gives up when its parent is pid 1 at start, or when its parent dies
  or changes while it waits. It logs why and exits 1, so the queue moves. A holder is never stopped
  for this: a run in progress finishes.
- **`--status` and `--reap`.**
  - On Linux, `--status` adds each waiter's folder and an `ORPHAN` mark to the numbered queue of
    #372.
  - A holder's or a waiter's command is cut after 80 characters, so a `test:related` run of hundreds
    of files stays on one line.
  - `--reap` stops each orphan waiter by its process group (`kill -PGID`). It removes that waiter's
    file and the files of dead waiters, and never touches the holder.
- **Linux only.** Only Linux has the `/proc` reader. Elsewhere the slot behaves as before, and the
  `FLIGHTDECK_SLOT_HOLDER` shortcut still applies.
- **Ported on 2026-11-06.** The branch was written for an rc/0365 that was never cut. It landed
  later, on top of #372's first-come queue.
