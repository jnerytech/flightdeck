# CI on every pushed work branch (issue #217, part of #216)

- **`push: branches: ["**"]`.** Every pushed branch runs the whole workflow: the suite on Linux
  and Windows, SonarCloud, the prints, axe and e2e. Tags alone start nothing (no `tags:` key).
  The existing concurrency group (`ci-<ref>-<event>`, cancel in progress) already makes a new
  push cancel the branch's previous push run, and never a dispatched or pull-request run.
- **The docs-only skip is narrow.** `paths-ignore` lists only `docs/manual/**` and
  `docs/images/**`, the files no test reads. `README.md`, `CLAUDE.md`, `docs/TDD.md`,
  `docs/DECISIONS.md` and some specs are read by tests, so a change to them still runs the CI.
  `ci-branches.test.ts` fails if a test ever names a path the filter skips.
- **Pull requests are never filtered.** A required check whose workflow is skipped by a path
  filter stays pending and blocks the merge, so `pull_request` keeps no `paths` or `paths-ignore`.
- **A branch with an open pull request runs twice** (its push and the pull request's merge ref).
  That is accepted: CI minutes are free for this public repository, and the two runs check
  different trees.
- **Based on `rc/0363`,** which adds `workflow_dispatch` (#129) to the same `on:` block.
