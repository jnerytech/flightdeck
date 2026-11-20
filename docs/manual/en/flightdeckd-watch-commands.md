# flightdeckd commands: the PR watch of a card

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/flightdeckd-watch-commands.md)

The verbs that read what the PR watch of a card did. They work as the other `flightdeckd` commands do: see
[what they all share](flightdeckd-commands.md#what-they-all-share). They change nothing.

## fd watch

```sh
fd watch get card-1
fd watch trace card-1 --json
fd watch describe card-1 > pr-description.md
fd watch by-url https://github.com/acme/api/pull/42
fd watch settings api
```

`get <card>` prints the state of the watch: `watching`, `needs you` with its reason, or `watch off`, how many of the
allowed rounds it used, and one line for each fixing round (its number, its id, its status, its cost and its turns).
A round that was held because it touched files outside the PR says how many.

`trace <card>` prints where the card's work came from: its title, the PR, the work item, the total cost, the sessions
that ran it (the session id, `run` or `fix`, when it started, the cost and the checkpoints) and the fixing rounds.

`describe <card>` prints the PR description the daemon writes from the card's sessions, one line per line, so it can go
to a file. It opens no PR. When the daemon left lines out because they looked like a secret, the command says how
many on stderr and keeps them out of the text.

`by-url <link>` looks a PR link up: `via: card` and the card's trace, `via: history` and the sessions of the history
that mention it, or `via: none`. Nothing found is not a failure: the command exits `0`. It fetches nothing from GitHub.

`settings <project>` prints the PR watch settings of a project, named by its name or its id: one line for each
setting, with `none` for an empty list and `unknown` for a setting an older daemon does not send. A name that two
projects share is refused with their ids.

With `--json` the commands print the value the daemon returns, with `null` for a missing field. `--host <name>` reads
a paired host. Changing the settings, extending a watch and resolving a held round are not here yet: use the app.
