# The eval of the harness (issue #169)

- **What it measures.** Whether a real session, given only the repo's CLAUDE.md, rules, hooks and
  skills, does a small TDD task the way docs/TDD.md asks. `scripts/harness-eval.ts` clones HEAD
  into a temporary folder per sample (origin removed, so nothing can be pushed back; dependencies
  installed), runs `claude -p` with `acceptEdits`, an allow list (Read, Edit, Write, area tests,
  `test:related`, `tdd:audit`, `typecheck`, `lint`, plain git) and `git push`/`git remote`
  disallowed, and a budget cap, then grades the clone.
- **Deterministic graders** (`scripts/lib/harness-eval.ts`, tested): the test file is where
  docs/TDD.md puts it; `test(area)` before `feat(area)`; a bun test run of the area that failed on
  an `expect` before the test commit (read from the stream-json transcript); `tdd:audit` and
  `test:related` pass in the clone; the run ended without error. No model grades a model, and no
  `claude plugin eval` (no code graders, and it does not load the project's `.claude/`).
- **Three samples, cost in the report** (review S2-8). The scorecard gives each grader's count over
  the samples, the cost (in all, a run, min, max), the turns and the permission denials.
- **First run, 2026-11-05, on the first branch (22136ed38, before the allow-list fix), Sonnet,
  `slug-case`:** every grader 3/3; $0.80 in all, $0.27 a run ($0.22 to $0.35); 18 turns a run (16 to
  20); 13 permission denials. Three of the denials were allow-list gaps that CLAUDE.md itself causes
  (`bun run lint`, `bun x biome`, `env -u CLAUDECODE bun ... test`) and are now allowed; the rest
  were shell writes and reads (`cat > file <<EOF`, `head`) where Read and Write are allowed, which
  the session recovered from. The full report is kept in the hand-off folder
  (`harness-eval-2026-11-05.json`).
- **Opt-in.** It never runs in the suite, in CI or under the slot (the model's turn is not a heavy
  run), and it spends real quota: run it after a harness change, under the quota rule.
- **Confinement, after the security review of the port (2026-11-06).** The CLI only wires what the
  lib decides, and the lib is tested. The session's processes, the clone and `bun install` get an
  allow-listed environment: the PATH, the home, the locale and the temp folders, never a token or
  key (`GH_TOKEN`, `ANTHROPIC_API_KEY` and the rest), so `claude` must be logged in with its own
  login, not a key in the environment. Read, Edit and Write are scoped to the clone, the home
  folder is denied when the clone is outside it, and a git `--output` is denied. The clone, the
  checkout, the removal of origin and the install must each succeed, and the session never starts
  in a clone that still lists a remote. Transcripts (only with `--keep`) and the report go to a
  0700 folder as 0600 files, and the report keeps each step's command, never its output. What
  stays: the tests the session writes run as you, with the network, so run the eval only on a
  machine where that is acceptable.
