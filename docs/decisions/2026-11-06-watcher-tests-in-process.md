# The PR watcher tests answer in process (issue #246)

- **The cause.** `vigiar-github` and `vigiar-ado` failed at their 20 s timeout on the loaded Pi,
  with or without any change. Their watcher tests started a real fake `gh`/`az` process for every
  call: about five per round (checks, mergeable, comments, reviews, threads), mostly one after
  another, and up to four rounds per test. Measured with each fake call held 3 s, one GitHub round
  took 14.5 s and one Azure round 8.7 s; the machine's own slowness to start processes does the
  same at a smaller scale. `tick()` swallows a look that fails, so a round that came too late
  fired nothing and the test saw one trigger instead of two.
- **The fix, no timeout raised.** The watcher already takes a `provider`, and `GithubCli` and
  `AzureDevOpsCli` take a `run`: the tests now give the watcher the fake's in-process runner. The
  calls are the same, answered and recorded by the same fake; a round starts no process. A test
  per file holds every fake rule 3 s and expects the round under 1.5 s (a hold only holds a
  process), so going back to real processes fails it.
- **What still starts a process.** The provider tests that make one call each (health, a build
  log) keep the real fake process: one start is far from 20 s, and `pr-runner.test.ts` covers the
  provider through a process found on PATH.
- **Why it landed late.** The first branch (written 2026-11-05) appended this to
  `docs/DECISIONS.md`, which #304 then froze; this port keeps the same test and fix.
