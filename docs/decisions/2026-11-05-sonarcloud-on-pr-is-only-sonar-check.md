# SonarCloud on the PR is the only Sonar check (issue #283)

- **Why.** The local copy (`bun run lint:sonar`, eslint-plugin-sonarjs in `tools/sonar-lint` with
  `scripts/sonar-profile.json`, and the per-rule ratchet of `sonar-baseline.json`) missed rules
  SonarCloud flags: its typed rules were skipped under `--no-types`, and several Sonar rules have
  no ESLint version at all. Its ratchet also failed a PR once main grew past the baseline. The user
  chose to remove it rather than strengthen it.
- **What is gone:** `tools/sonar-lint` (and the `tools/*` workspace), `scripts/lib/sonar-lint.ts`,
  the profile, the baseline, their tests, the `lint:sonar` script, and the CI steps (the quick
  job's ratchet went in #278). The earlier entries above that describe them are history.
- **What stays:** every `// NOSONAR: <reason>` comment, since SonarCloud honours them; and
  `sonar-coverage.test.ts`, which guards SonarCloud's own configuration (its coverage is read on
  exactly the files of the 100% gate, and every test file is analysed as test code). Its helpers
  moved, unchanged, to `scripts/lib/sonar/project.ts`.
- **For sessions:** no Sonar run before a push. A SonarCloud finding on a PR is fixed in that PR.
