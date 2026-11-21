# flightdeckd commands: the board sync of a project

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/flightdeckd-boardsync-commands.md)

The verbs that read and change how a project's board is synced with a GitHub Projects board. They work as the other
`flightdeckd` commands do: see [what they all share](flightdeckd-commands.md#what-they-all-share). `boards`, `status`
and `log` change nothing; `link`, `unlink`, `set-map`, `set-push` and `sync-now` do what the **Sync** button does in the
app: see [Board sync with GitHub Projects](board.md#board-sync-with-github-projects).

## fd boardsync

```sh
fd boardsync boards
fd boardsync status api
fd boardsync status api --json
fd boardsync log card-1
fd boardsync link api PVT_kwHOAbc
fd boardsync link api PVT_kwHOAbc --map "No status=backlog" --map "Shipped=done"
fd boardsync set-map api --map "In review=review"
fd boardsync set-push api --on --confirm
fd boardsync set-push api --off
fd boardsync sync-now api
fd boardsync unlink api
```

`boards` prints the GitHub Projects boards of the account the host's `gh` is signed in to, one line for each: the
board id, who owns it and its number, its title and its link. It needs `gh` installed and signed in on the host: when
it is not, the command exits `1` and says so.

`status <project>` prints where the sync of a project stands, named by its name or its id: the board, whether local
moves are sent to it (`push`), when it was last read, and, when they apply, the time it is paused until, the last
error, a warning that the board has more items than one read takes, the map from the board's statuses to the
columns, and the statuses the board has. A project with no board prints `not linked to a board` and exits `0`. A
name that two projects share is refused with their ids.

`log <card>` prints the sync log of a card, newest first, one line for each entry: when it happened, its kind, and
what applies of who won, what was kept, what was lost and why. A card with no entry (or one the host does not
know) prints `no sync log`.

`link <project> <board id>` links a project to a board; the id is the first column of `boards`. The host reads the
board once during the link and makes its items cards, so the command prints the status after that sync. Without
`--map` the host picks the column of each status itself, as the app does; each `--map "<status>=<column>"` says one
status of the board and the column it goes to (`backlog`, `in_progress`, `waiting`, `review` or `done`). The status
may hold a `=`: the column is what follows the last one. A project that is already linked, a board the account does
not see and a board with no Status field are refused with exit `1`.

`set-map <project> --map "<status>=<column>"...` replaces the map of a linked project; give at least one `--map`, each
status once.

`set-push <project> --on --confirm` sends the moves of the project's cards to the board; `--off` stops it. Turning it
on needs `--confirm`, which says the person read what it does: the card's column becomes the item's Status, and
nothing else on the board changes. The login needs the `project` permission: when it lacks it, the command exits `1`
and says so, and nothing is sent. `--on` without `--confirm` is refused by the host.

`sync-now <project>` reads the board once and prints what it did (created, moved, updated, conflicts, unmapped, gone,
skipped, pushed, redacted), leaving out what is zero; `nothing to change` when all are. A board that has not changed
since the last read says so.

`unlink <project>` stops the sync and keeps the cards, with their links.

A write that got no answer (the host went silent or closed the connection) exits `2` and says the change may or may
not have happened: run `fd boardsync status <project>` before repeating it.

A session that runs `link`, `set-map`, `sync-now` or `set-push --on` from its shell is a high-risk request, so the
app asks you first; `unlink`, `set-push --off` and the reads are ordinary commands.

With `--json` the commands print the value the daemon returns, with `null` for a missing field (`sync-now` prints the
`status` and the `report`; `unlink` prints `{ "unlinked": true, "projectId": ... }`). `--host <name>` reaches a paired
host.
