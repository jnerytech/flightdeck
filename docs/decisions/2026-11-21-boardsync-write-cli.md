# The write side of a project's board sync from a shell: `boardsync link|unlink|set-map|set-push|sync-now` (issue #3540)

Slice 2 of the boardsync verbs in [the CLI-first decision](2026-11-19-cli-first.md); slice 1 is
[the read side](2026-11-21-boardsync-read-cli.md).

## Decision

Five verbs over `boardsync.link`, `boardsync.unlink`, `boardsync.setMap`, `boardsync.setPush` and
`boardsync.syncNow`. All take `--json`, `--host` and the exit codes of the other verbs: 0 done, 1 refused, 2 no daemon.

- `boardsync link <project> <board id> [--map <status>=<column>]...` ties the project to a board (the id comes from
  `boardsync boards`). Without `--map` the host builds the board's own map. The daemon pulls the board in as cards
  during the link, so the verb prints the status once that sync has run.
- `boardsync set-map <project> --map <status>=<column>...` replaces the map. At least one `--map`.
- `boardsync set-push <project> --on --confirm | --off` turns the push of local moves on or off. `--on` sends
  `confirm: true` only because `--confirm` was typed; the daemon still checks the `project` scope of the login.
- `boardsync sync-now <project>` runs one sync and prints what it did (the kinds that are zero are left out).
- `boardsync unlink <project>` stops the sync and keeps the cards, as the app does.
- `--map` splits on the last `=`, since a status of the board may hold one. The column is checked against the five
  the protocol knows, a status given twice is refused, and the pairs live in an object with no prototype so a status
  named `__proto__` is a key like the rest. All of this is refused before anything is sent.
- `--confirm` is refused on every verb except `set-push --on`, and `--on` and `--off` on every command but `set-push`.

## What guards it

A session that runs `link`, `set-map`, `sync-now` or `set-push` from its shell is `high` (`boardsync-risk.ts`), so the
app asks the person first: a session could otherwise tie a project to any board the host's `gh` can read, reshape what
a column means, pull a board's items in as cards (an item written by a stranger becomes a card), or turn on pushing
moves to an outside board. `set-push` is read by what it is not: only a lone `--off` is an ordinary command, and a word
the shell expands never is. `unlink` and the reads grant nothing, so they stay ordinary. `boardsync` joined the commands
whose verb a shell expansion cannot hide.

`unlink` is left ordinary on purpose, and its cost is known: it deletes the link row, so the project's custom map, its
push opt-in and its sync cursor are gone, and the cards stop syncing. The cards and their links stay, and linking again
is high, so the person is asked before anything reaches the board again. The security review (2026-11-21) rated this low.

Without a device-bound confirmation in the daemon, the typed `--confirm` of `set-push --on` is all a person at a
terminal has: the same state as every other `--confirm` verb of the CLI.

## Writes that get no answer

A write that is cut or silent may have happened. The run exits `2` and says "the change may or may not have
happened: run boardsync status before repeating it". A `link` and a `sync-now` read the whole board, so they wait
60 s, the others 15 s.

## Not done

`boardsync.setPush` has no CLI-side check that the board's login has the `project` scope: the daemon refuses and the
verb prints its text.
