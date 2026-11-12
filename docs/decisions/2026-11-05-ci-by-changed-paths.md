# CI by changed paths (issue #264)

- **Why.** Every PR ran the whole matrix (Windows in three shards, prints, e2e, cargo), so a
  docs or scripts change waited half an hour for checks that read none of it.
- **The plan** (scripts/lib/ci/paths.ts, run by the `changes` job against the merge-base with the
  PR's target): docs and scripts alone run the Linux job (the whole suite with the 100% gate,
  typecheck, lint, the audit, SonarCloud); `apps/daemon/**` or a smoke adds the Windows shards, the
  Windows checks and the smokes; `apps/desktop/**`, `packages/**`, `package.json`, `bun.lock`, a
  bunfig, a tsconfig or `.github/workflows/**` add the prints and e2e; `apps/desktop/src-tauri/**`
  adds cargo. A push to main, a run by hand, or a diff the job cannot read plans everything, so
  every commit on main has a full run, and a tag goes only on a commit whose full run is green.
- **The required names still report.** `test (windows-latest)` and `screenshots (prints, axe e
  e2e)` are aggregates: they pass when their jobs were skipped by path, but only after checking
  that the `changes` job itself succeeded, since a failed plan has no outputs and would otherwise
  read as "skipped".
- **cargo** (check and test of the shell) runs only when the plan says so, after
  `Swatinem/rust-cache` (pinned to the v2.9.3 commit). On Windows the app build and the bundle
  budget run whenever the app or the shell changed, apart from cargo.
- **e2e in three Playwright shards** (`bun run e2e -- --shard=i/3`), each with its own report and
  failures artifact; the aggregate fails if any shard failed.
- **lint:sonar on a PR is the ratchet only** (`lint:sonar (ratchet)`): the changed-lines run was
  red on every large diff for code smells and is not a required check, so its red X said nothing.
  The ratchet is green unless a rule's open count goes up. The changed-lines run stays local.
