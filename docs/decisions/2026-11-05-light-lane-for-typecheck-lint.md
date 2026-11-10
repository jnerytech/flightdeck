# The light lane for typecheck and lint (issue #1711, moved from DECISIONS.md)

- **Why.** On 2026-11-05 the Pi ran out of memory (148 MB free, load 49) with five or six
  typechecks running at once outside the slot. One run of `bun run typecheck` was itself three
  tsc processes at once (`bun run --filter '*'` runs the workspaces in parallel) and then a
  fourth: measured on the Pi, protocol 0.29 GB, daemon 0.95 GB, desktop 1.46 GB, scripts 1.05 GB.
- **A lane with two places** (`scripts/lane.ts`, logic in `scripts/lib/lane.ts`). Each place is
  one of the slot's lock files (`tryAcquire`/`release`), in the temp folder. A third run waits and
  names the two holders once. It is separate from the heavy slot: a typecheck never waits for a
  full suite, nor a full suite for a typecheck.
- **Fail-open and nesting.** A lock that cannot be used runs the command anyway and says so. A
  call made inside the lane or the heavy slot (`FLIGHTDECK_LANE_HOLDER`, `FLIGHTDECK_SLOT_HOLDER`
  from #141) runs at once, so a script that runs typecheck inside a slot run never waits for itself.
- **One project at a time, incremental.** `scripts/typecheck.ts` runs one tsc per project in
  sequence (protocol, daemon, desktop, scripts), each with `--incremental` and its build info in
  `node_modules/.cache/tsc/` (ignored, one per checkout). A cold run peaks at 1.48 GB (the desktop
  project) and took 46 s on the loaded Pi; a run with nothing changed takes 8 s and 0.46 GB. A type
  error added after a warm run is still reported. One shared tsc for all projects was not tried:
  it would hold every project's program at once, the opposite of what the lane needs.
- **The workspaces' own `typecheck` scripts stay** for a run inside one package; a test checks
  that `PROJECTS` lists every workspace that has one.
