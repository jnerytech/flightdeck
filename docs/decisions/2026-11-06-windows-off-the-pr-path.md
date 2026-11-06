# Windows leaves the PR path and stops gating (issue #534)

- **The symptom.** From 14:45 on 2026-11-06 about 4 of 30 Windows test-shard jobs failed, each on a
  different test timing out at the 15 s per-test limit (deps-guard, worktrees-seguranca, servico,
  project-trust, times-ui, keep-awake). Every one passed on rerun and on Linux. It was the
  runner pool, not a test, so skipping tests one by one (the #494 cap) would not scale. Delivery
  was waiting on reruns of a check nobody could fix.
- **The decision (the user, 2026-11-06).** "Disable the Windows test if needed, I will test it by
  hand during use": fast delivery comes first. Windows stays as a signal, not a gate.
- **What changed.**
  - `scripts/lib/ci-paths.ts`: a PR and a push to `main` plan no Windows jobs, whatever they
    change and even when the diff cannot be read. The schedule (every 3 hours) and a run by hand
    still plan everything, Windows included.
  - `.github/workflows/ci.yml`: the Windows shard job, the Windows checks job and the
    `test (windows-latest)` aggregate are `continue-on-error`, so a red Windows job leaves the
    run green. On a PR the aggregate passes at once (no Windows planned), so the name still
    reports. The main ruleset no longer requires `test (windows-latest)` (the coordinator
    changed it; the backup is `ruleset-main.before-no-windows.json` in the handoff folder).
  - `pr tag` (`fullGreen`) reads the schedule run's conclusion, or a dispatch run's Ubuntu
    suite job, so it never needed Windows; with `continue-on-error` a red Windows job cannot
    turn a full run red. A test pins it.
  - `scripts/test/timeout.ts`: where Windows still runs, a test gets 30 s instead of 15 s
    (Linux and macOS stay at 15 s, so Linux keeps catching real slowness). The shard runner and
    `test:related` both read it.
- **What it costs.** A Windows-only break is no longer seen on the PR that causes it: the next
  scheduled full run shows it, within 3 hours, and the person's own use of the app on Windows
  catches the rest. The release workflow still builds on Windows.
- **Reverting.** Plan Windows again for a PR in `ciPlan`, drop `continue-on-error`, and have the
  ruleset require `test (windows-latest)`. The timeout stays useful either way.
