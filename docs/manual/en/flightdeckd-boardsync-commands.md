# flightdeckd commands: the board sync of a project

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/flightdeckd-boardsync-commands.md)

The verbs that read how a project's board is synced with a GitHub Projects board. They work as the other
`flightdeckd` commands do: see [what they all share](flightdeckd-commands.md#what-they-all-share). They change
nothing. Linking a project to a board, and the sync itself, stay in the app: see
[Board sync with GitHub Projects](board.md#board-sync-with-github-projects).

## fd boardsync

```sh
fd boardsync boards
fd boardsync status api
fd boardsync status api --json
fd boardsync log card-1
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

With `--json` the commands print the value the daemon returns, with `null` for a missing field. `--host <name>` reads
a paired host.
