# The CLI parity files merge without conflicts (issue #3759)

## Context

Under CLI first (#3423) many PRs add a `flightdeckd` noun at the same time. On 2026-11-21 five of them
(#3691, #3747, #3748, #3743, #3739) conflicted with each other on every merge of `main`, and each
resolution pushed a merge commit that cancelled the PR's CI run (about 25 minutes). Two PRs went 90
minutes without a finished run. The conflicts came from three shapes:

- `cli-parity-baseline.json` held one number, the count of gaps. Two PRs that each changed a gap both
  rewrote it, and the right value was known only by running `bun run arch` after the merge.
- `JSON_COMMANDS`, `HOST_COMMANDS`, `CONFIRM_OWNERS` and `VERB_NOUNS` were each one long string, and every
  PR appended its noun at the end. A single line is one unit of merge, so two different nouns conflicted.
- The exact noun list in `risk-fd-launch-forms.test.ts` and a copy of the `HOST_COMMANDS` order in
  `host-flag.test.ts` had the same shape.

## Decision

1. The parity ratchet has no baseline file. `bun run arch` reads `docs/cli-parity.json` at the merge base
   with `origin/main` (or `main`) and fails, naming them, on a command that is a gap now and was not one
   at the base: a new `cmd(...)` with an empty row, or a covered row emptied. The table prints the count
   as before. The old file was the lower of main's and the branch's number, so a PR could never raise it;
   the new check forbids the same thing, and closing a gap needs nothing else.
2. The four lists are arrays with one name per line, in alphabetical order, and a test checks each is
   sorted and has no duplicate. A PR inserts its noun at its own place in the alphabet, so two PRs
   merge unless they add neighbours.
3. `host-flag.test.ts` builds its sentence from `HOST_COMMANDS`, and the exact `VERB_NOUNS` list in the
   test is one noun per line.

## Discarded

- One row file per noun for the parity table: the rows are already one per line in an alphabetical
  object, so they merge; a directory of files adds a loader and an index for no gain.
- A parity baseline computed from the protocol sources at the merge base: it needs every protocol file
  at the base, and the table at the base already says which commands were gaps.
- Sorting the `xxxProblem(args) ??` chain of `args.ts`: its order may decide which error wins when two
  apply, so it is behavior and waits for its own change. The action union of `cli-args.ts` and the help
  text of `usage.ts` stay as they are for the same kind of reason.

## Consequences

- With no merge base (no `origin/main` and no `main` in the checkout) the parity ratchet compares
  nothing, as the other ratchets that read the merge base do. CI checks out the whole history.
- On a push to `main` the merge base is the head, so the check there is a no-op. A race between two PRs
  cannot lower the bar: each PR is checked against the table it forked from, and rows are one per line, so
  two PRs that touch the same row conflict in text.
- The sentence "--host: this flag only applies to flightdeckd ..." lists the commands in alphabetical
  order now.
- A held PR that still has `cli-parity-baseline.json` gets one last modify/delete conflict: delete the file.
- Still conflicting, and left out: the problem chain, the action union, the help text and the pass-through
  list of `persona-args.ts`.
