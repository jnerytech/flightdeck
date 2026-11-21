# The write side of a card's PR watch from a shell (issue #3539)

Slice 2 of the watch verbs in [the CLI-first decision](2026-11-19-cli-first.md), after [the read side](2026-11-20-watch-read.md).

`watch set`, `watch extend`, `watch resolve-held`, `watch settings` with flags and `watch follow`, over `watch.set`,
`watch.extend`, `watch.resolveHeld`, `watch.settings` with a patch and `watch.watch`. With them every `watch.*` command
has a CLI verb.

## The verbs

- `watch set <card> --enable|--disable|--default`: exactly one switch. `--default` hands the card back to the project's
  setting (the protocol's `enabled: null`).
- `watch extend <card> --rounds <1-10>`: the rounds allowed on top of the limit.
- `watch resolve-held <card> <round> --push|--drop`: what to do with a round held for touching files outside the PR.
- `watch settings <project> [flags]`: with no flag it reads, as before. A flag sets that field and leaves the others
  alone. `--enable` and `--disable` set the project's `enabled`.
- `watch follow`: stays connected and prints the watch of a card each time the daemon pushes it, until Ctrl-C
  (exit `0`). `--json` prints one watch per line. It takes no operand: the stream is every card's.

## Choices

- **Clearing a field.** A limit that may be empty (`--budget-usd`, `--max-turns`, `--daily-usd`) takes the word `none`
  to clear it. A list (`--check`, `--check-env`, `--drift-allow`) is replaced by the values typed, one flag a value, and
  its `--clear-*` twin (`--clear-checks`, `--clear-check-env`, `--clear-drift-allow`) empties it. `--clear-checks`
  with `--check` is refused.
- **One check before the daemon.** The patch is checked against the protocol's own `WatchSettings` schema before
  anything is sent, so a check that looks like a shell line, a secret-shaped `--check-env` name or a number out of
  range is refused by the flag that set it, with exit `1` and nothing sent. A flag twice for a single value is refused.
- **Shared flags.** `--check`, `--clear-checks`, `--persona`, `--rounds`, `--enable` and `--disable` are the flags of
  `team`, `card` and `terminal` too. On `watch` they move into fields of their own and are deleted from the shared ones,
  so the other commands' checks neither see nor refuse them; a flag of the watch on another verb or command is refused
  by name.
- **`resolve-held` prints the card's watch.** `watch.resolveHeld` answers with the card's watch and carries no commit
  ids, so the command prints one line (`pushed round <id>` or `dropped round <id>`) and then the watch.
- **A write that got no answer** says on stderr that it "may or may not have been" done, as `board settings` does, and
  exits `2`.
- **A far host.** `--host` goes through the daemon's own checks: a patch that changes a field outside the ones a paired
  host may edit (`enabled`, `maxRounds`, `maxTurns`, `maxFailures`, `budgetUsd`, `dailyUsd`) is refused by that host with
  `transport_refused`, and the command exits `1` with its line.

## High-risk rules

A session that runs these from its shell would decide, without the person, whether Claude is woken against a PR and what
it spends, or publish a held round. `permissions/domain/watch-risk.ts` makes them high:

- `watch set` unless it only has `--disable`;
- `watch extend`, always;
- `watch resolve-held` unless it only has `--drop`;
- `watch settings` with any flag other than `--json`, `--host` and `--config`, unless the only change is `--disable`.

The settings rule reads a flag by what it is not (an allowlist of the three that read), because the `--flag=value` form
is a flag too and a list of write flags would miss a later one. The reads (`get`, `trace`, `describe`, `by-url`,
`follow`) stay ordinary. The ten new flags that take a value joined `OPTIONS_WITH_VALUE`, so a flag with a value typed
before the verb is not read as a word; a test keeps that list equal to the parser's.

## Not decided here

A transport guard or the #3439 proof for the watch commands; changes to how a round runs; `isWatchCheck` and
`isCheckEnvName`; `card.pr.merge`; the app's use of the commands.
