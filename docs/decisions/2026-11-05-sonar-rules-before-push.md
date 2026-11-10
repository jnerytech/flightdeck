# Sonar rules before a push (issue #194)

- **Biome stays the linter; `lint:sonar` only mirrors SonarCloud.** `bun run lint:sonar` runs `eslint-plugin-sonarjs` (Sonar's
  own JS/TS rules) with no other ESLint rule. The rule list is not hand-written: `scripts/lib/sonar-lint.ts` keeps the plugin
  rules whose Sonar key (`S1234`, from the rule's documentation URL) is active in the project's SonarCloud profile, "Sonar way
  comprehensive" for TypeScript, snapshotted in `scripts/sonar-profile.json`. Refresh it with
  `curl 'https://sonarcloud.io/api/rules/search?organization=jnerytech&qprofile=<key>&activation=true&ps=500&repositories=typescript'`
  when the profile changes (the API is public for a public project; no token).
- **Coverage of the profile (2026-11-05).** 211 of its 418 TypeScript rules have an ESLint rule: 160 run on syntax alone and 51
  need the TypeScript program (`--no-types` skips those). The other 207, and the `tssecurity` taint rules (47) and
  `tsarchitecture` rules (7), have no local equivalent and are reported only by SonarCloud.
- **New code only.** SonarCloud's gate judges new code, and `main` has far more old findings than a change can fix, so
  `lint:sonar` keeps the findings on the lines the branch added or changed (`git diff -U0` against the merge-base). `--all` and
  `--files` check whole files.
- **NOSONAR works the same on both sides, with one addition.** A `NOSONAR` comment silences the findings of its line, as in
  SonarCloud. Locally a `NOSONAR` with no reason after it is itself a finding (`nosonar-reason`): a suppression says why.
- **A workspace of its own.** `typescript-eslint` refuses TypeScript 7 (`typescript-eslint does not support TS 7.0`, tracking issue
  typescript-eslint#10940), which the repository uses. The linter lives in the `tools/sonar-lint` workspace with its own
  `typescript@5.9.3`; the app and the daemon keep TypeScript 7. Drop the pin when typescript-eslint supports TS 7.
- **Not chosen:** a local SonarQube server (too heavy for the Pi) and scanner runs from the machine (they need the token).
- **CI.** A fast `lint:sonar` job runs on pull requests only, against the merge-base with the target branch.
