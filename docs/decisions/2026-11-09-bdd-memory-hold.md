# BDD: a card waits while the host is short of memory (issue #1364)

## Context

From the memory share the person sets (`resources.pauseAt`), a new card waits on the host and starts
when memory falls; a host with no reading never holds (#1343, PR #1353). The hold reads the
machine's own memory, which a journey cannot set, and on a busy runner it would hold every card.

## Decision

- The demo hosts get the daemon's `memoryReading` option: a file in the host's folder holds the share
  in use (0 to 1), and no file is no reading, so by default nothing waits. `DemoIds.memoryFile` gives
  the steps alfa's file. Beta has none.
- `memory-hold.feature`, two scenarios (en and pt-BR, 40 to 60 s on the Pi, which holds the card
  for one 15 s look of the gate):
  - with the hold set from 95% on alfa and its memory at 96%, a card started on a project of the
    scenario's own says "waiting for memory"; when the memory falls to 50% the badge goes and the
    card starts (it leads with its changes or its PR);
  - with the hold set and no memory reading, the card starts at once and never waits.
- Own state: the project and card are the scenario's own. The scenario reads the host's threshold
  first and puts it back, and deletes the memory file, so the next scenario finds a host with no
  reading.
- It goes red when a reading is written where none should be: the card is held and never leads.

## Not covered

The release margin (2 points under the threshold) and the unreadable reading (a throw, an impossible
number): `memory-gate` daemon tests hold them. A hold on a run that already started (never stopped)
and a host that is not offered the setting (`memory-hold-ui` holds the select).
