# Fake CLIs never outlive the run (issue #254)

- **What happened.** On 2026-11-05 at about 08:30, 83 fake `gh` processes (`fake-cli-main.ts …
  auth status`) were left with ppid 1 after a run in another checkout, and earlyoom then killed
  other sessions' tests. A fake answers and exits, but one whose rule holds it (`delayMs`, a login
  waiting for the browser, 30 s in the GitHub tests) or leaves a pipe holder (`holdPipesMs`) kept
  running when its caller was gone.
- **The fake watches its caller.** `fake-cli-main.ts` stops (exit 1) as soon as it is re-parented
  (ppid 1 or a subreaper) or its caller's pid is gone, checked at start and every 100 ms. The
  shell shim passes its own parent in `FLIGHTDECK_FAKE_CALLER` (exec keeps the shim's pid), so a
  fake that starts after its caller died still knows whom to watch. The pipe holder outlives the
  fake on purpose, so it watches the caller instead.
- **A deadline.** No fake lives past 60 s (`FLIGHTDECK_FAKE_MAX_MS` overrides it), its holds
  included: above the longest delay a test uses (30 s).
- **The run sweeps.** A fake records its pid, and its holder's, under `<state>/pids`; the state
  folder sits in the run's temp folder. At exit the preload kills what is still alive there
  (`reapFakes`), after checking `/proc/<pid>/cmdline` names the fake, so a reused pid is never
  hit. That is Linux only: elsewhere the watch and the deadline end them.
- **Not lighter, because it was not heavy.** Measured on the Pi, one fake call peaks at about 20 MB
  resident (`bun --smol` changes nothing). The 11.6 GB was the count, not the size, so the fix
  is that they end.
