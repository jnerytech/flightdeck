# Test tiers by content (issue #261)

- **Why.** The owner asked which tests are unit and which integration. Renaming 800 files into
  folders would conflict with every open branch, so the tier comes from what a test does, computed
  on every call (about 100 ms for the tree). No manifest is committed: every PR that adds a test
  would have to update it, and two such PRs would conflict in it.
- **The rules** (scripts/lib/test-tiers.ts): a test that starts a process (`Bun.spawn`, `spawnSync`,
  a fake CLI), a server or a socket (`startServer`, `startDaemon`, `Bun.serve`, a WebSocket,
  `FrameClient`) is `integration`; one that draws the DOM (`registerDom`, Testing Library) is
  `component`; the rest is `unit`; `scripts/e2e/*.e2e.ts` and the smokes are `e2e`. Integration
  wins over component: a screen test against an in-process daemon is heavy. Helpers count function
  by function, comments stripped: a test that takes only `waitFor` from apps/desktop/test/fixtures.ts
  is not integration because `daemon()` sits in the same file.
- **Measured** on the last green main run (Linux, 550 s of test files): unit 249 files 24 s (4%),
  component 167 files 97 s (18%), integration 386 files 428 s (78%). Today: unit 281,
  component 180, integration 394, e2e 32 (`bun run test:tiers`).
- **Use.** `bun run test:related -- --fast --tier unit,component` for a session on the Pi: a test
  with no tier still runs, the left-out ones are named, and there is no coverage gate (a part of
  the tiers covers part of a file). CI runs every tier and keeps the one combined 100% gate on
  Linux. A test checks that every test file of the tree gets a tier.
