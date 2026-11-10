# Development

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/development.md)

```sh
bun run typecheck      # tsc in every workspace and in the scripts
bun run lint           # Biome
bun run test:related   # the tests of what you changed, 80% coverage on the changed files
bun run test           # the whole suite, 80% of lines and functions per file (#1002)
bun run smoke          # end to end with the real daemon and --runtime fake; prints SMOKE OK
bun run smoke:multi    # two daemons, one client, permission via session.summary; SMOKE MULTI OK
bun run smoke:history  # indexes, searches, resumes and sees history.changed; SMOKE HISTORY OK
bun run smoke:board    # card with a fake gh and a local remote up to the merged PR; SMOKE BOARD OK
bun run smoke:central  # hooks, flightdeckd claude with the fake claude, approval and channel; SMOKE CENTRAL OK
bun run smoke:workflow # the whole example workflow, fake check and gh, up to the merged PR; SMOKE WORKFLOW OK
bun run smoke:limits   # quota and quota queue, project rule, bypass refusal and hook with updatedPermissions; SMOKE LIMITS OK
bun run smoke:ops      # host operations: maintenance (backup, prune), incompatible protocol, restore
bun run smoke:update   # local release server, daemon-latest.json, signed binaries and refusal of a tampered one
bun run smoke:costs    # costs from fixture transcripts, a budget that holds a card, CSV export
bun run tdd:audit -- --since fase-5   # every feat/fix has a test commit of the same scope before it
bun run build:daemon   # binaries in dist/
bun run build:desktop  # Vite frontend in apps/desktop/dist
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml   # requires apps/desktop/dist
```

Since Phase 2, development is TDD ([`docs/TDD.md`](../../TDD.md)): each area's test is born red,
runs on its own with `bun --config=bunfig.area.toml test ./<file>` (same bunfig, without the
global coverage threshold) and is committed as `test(<area>)` before the `feat(<area>)`. The
preload of both bunfigs installs a guard that fails the suite if any test runs the real `claude`,
and another that points `HOME`/`USERPROFILE` at a temporary folder, so no test reads the real
`~/.claude`. The check guard (Phase 6) only lets a workflow `check` reach the shell if the
command is a fake installed by the test itself. The smokes (except `smoke:real`) use the same
guards. The transcript fixtures live in `apps/daemon/test/fixtures/history/` and are written by
hand.

Tests and smokes use only the `FakeRuntime`. `bun run smoke:real` repeats the script with the
real Claude in a throwaway folder. It is manual, spends quota and is not part of the acceptance
criteria.

Other `package.json` scripts: `bun run coverage`, `bun run format` (Biome with `--write`),
`bun run ui:lock` (writes `apps/desktop/components.lock.json`, the hash of each shadcn/ui
component as the CLI generated it), `bun run release:version`, `bun run release:assets`,
`bun run release:tauri-config` and `bun run release:sign` (the last four are used by the
[release](releases.md#releases)).
