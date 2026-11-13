# Mutation survivors accepted as equivalent, and a score baseline per domain (issue #1607)

## Decision

The first weekly run on `main` (workflow_dispatch run 43425072395) scored `permissions-risk` at
94.13% (43 survivors) and `permissions-rules` at 84.28% (100 survivors). We accept those scores. No
`ignoreStatic` or `mutator.excludedMutations` rule is added: an ignore rule hides a mutant for good,
including one a later change makes killable, and the survivor list in the job summary is the
record of what is left.

`mutation-domains.json` now carries a `minScore` per domain: 94 for `permissions-risk` and 84 for
`permissions-rules`, the accepted scores rounded down. `bun run mutation:weekly` lists a domain
under its `minScore` in the job summary and exits 1, so the scheduled run goes red when a change
to the classifiers or their tests lowers the score. It still gates nothing else (the workflow starts
on a schedule or by hand only). The baseline only goes up: raise `minScore` in the PR that kills
survivors, never lower it to make a run pass.

## Survivors read and why they are equivalent

Local Stryker runs over line ranges (`--mutate <file>:<from>-<to>`, about 2 s per mutant) covered
`rule-risk.ts` 100-140, `sensitive-paths.ts` 85-165, `risk.ts` 260-290 and `risk.ts` 330-340. Every
survivor there changes no observable result:

- `instances()` and `wildcardOptions()` in `rule-risk.ts` are overlapping generators. A mutant that
  drops, reorders or duplicates one of the overlapping candidates yields the same set of verdicts.
- The NTFS filter at `sensitive-paths.ts:104` and the `?? ""` fallbacks beside it are dead on every
  input the callers can build. Their mutants cannot change a verdict.
- A redirect `>&N` target is a file descriptor or a project file the rules allow either way, so the
  mutants that change how the target is read give the same verdict.
- `every` against `some` over the paths of a read tool that takes one path is the same test.
- The `!== ""` filters feed `credential("")`, which is false, so removing the filter changes nothing.

## Not read

The ranges `risk.ts` 85-125, 143-182 and 368-372, and `rule-risk.ts` 93-98, 145, 183-185 and
276-302, were not read one by one. Their survivors are inside the accepted scores but are not
claimed to be equivalent. If one of them turns out to be a business rule, it becomes a test issue
(see `2026-11-13-weekly-mutation-run.md`), and the PR that kills it raises `minScore`.

## Done when (issue #1607)

`bun run mutation` prints a score and `2026-11-11-mutation-testing.md` is on main. The scheduled run
reports a score per domain and now holds it above a baseline.
