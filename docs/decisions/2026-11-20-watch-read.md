# The read side of a card's PR watch from a shell (issue #3539)

Slice 1 of the watch verbs in [the CLI-first decision](2026-11-19-cli-first.md).

`watch get|trace|describe <card>`, `watch by-url <link>` and `watch settings <project>`, over `watch.get`,
`watch.trace`, `watch.describe`, `watch.byUrl` and `watch.settings` with no patch. They read what the daemon already
keeps and change nothing.

- The noun is `watch`, with the card or the project as the operand, as for `card` and `ssh`. A card is named by its id;
  a project by its name or id (`resolveProject`, a name two projects share is refused with their ids).
- `by-url` with nothing found is `via: none` and exit `0`: the lookup worked and the answer is "no". A script reads
  `via` in `--json`.
- `describe` prints the text one line per line and puts the count of lines the daemon left out as a possible secret on
  stderr, so a redirect to a file carries the description and not the notice. `--json` prints `{text, redacted}`.
- `--json` keeps every key and prints `null` where an older daemon sends none (`reason`, `roundsUsed`, `maxRounds`, a
  round's `drift`, the optional settings).
- `watch` joined the commands that take `--json` and `--host`. The two lists moved from `args.ts` into
  `cli/domain/command-sets.ts` in a structure-only commit first, because `args.ts` was 2 lines from the 800-line
  ratchet.
- The risk rules need no new entry: nothing here writes, so `fd watch` from a session's shell stays ordinary.
- Not in this slice, and not decided here: the write side (`watch.set`, `watch.extend`, `watch.resolveHeld`,
  `watch.settings` with a patch, the `watch.watch` stream) and its high-risk rules; a transport guard or the #3439
  proof for the watch commands; `card.pr.merge`.
