# A per-rule open-count ratchet for Sonar (issue #204)

- **`sonar-baseline.json` holds how many findings each rule may still have** across the whole repository, as `lint:sonar --ratchet`
  counts them (every tracked file, the rules that need no type information, NOSONAR respected). A rule above its number fails;
  `--ratchet --write` lowers the numbers to today's counts and never raises one; `--ratchet --init` writes them once. It reuses the
  helpers of the layout ratchet (`overBaseline`, `tightened`, `initialised`).
- **Typed rules are not in the count.** They need the TypeScript program, which takes minutes over the whole repo on the Pi; they are
  still checked on the changed lines of every pull request, and SonarCloud counts them all.
- **CI runs it on pull requests**, after the changed-lines check, so a change that adds a finding of any rule fails there while the
  old ones are burned down in the batches of #197.
