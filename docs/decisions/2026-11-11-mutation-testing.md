# Mutation testing with StrykerJS, by hand (issue #1607)

## Decision

StrykerJS 10.1.1 (pinned) runs with its command test runner over `bun test`; Stryker has no Bun
runner plugin, so each mutant runs the named test file(s) as one `bun test` call. It is not part of
any CI workflow: `bun run mutation` is a by-hand run (a test checks that `ci.yml` and `release.yml`
never start it). `stryker.config.json` names the files to mutate and the test file that judges them;
`reports/mutation/` and `.stryker-tmp/` are ignored.

## First measurement (the one small pure domain)

`apps/daemon/src/permissions/risk.ts` (348 lines) judged by `apps/daemon/test/permissions/risk.test.ts`
(9 tests, 1.3 s): 654 mutants, 374 killed, 2 timed out, 278 survived, a score of 57.49 %, in 18 minutes
27 seconds on the Orange Pi (one process, 1.5 s per mutant; no coverage analysis with the command
runner, so every mutant runs the whole file). Survivors by kind: string literals 119, conditionals 41,
regular expressions 39, array declarations 22, method calls 17, equality operators 12, logical
operators 11, arrow functions 9. Many string-literal survivors are messages and labels no test reads;
the conditional and equality ones are the candidates to look at first.

## Next

Widen only after the survivors of this file are read: a business-rule survivor becomes a test, not a
rewrite of the file. Cost grows with mutants times the judging file's time, so a file is judged by its
own test file, never the suite.
