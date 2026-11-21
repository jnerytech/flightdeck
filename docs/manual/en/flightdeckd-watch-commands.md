# flightdeckd commands: the PR watch of a card

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/flightdeckd-watch-commands.md)

The verbs that read what the PR watch of a card did and the ones that change it. They work as the other
`flightdeckd` commands do: see [what they all share](flightdeckd-commands.md#what-they-all-share). `get`, `trace`,
`describe`, `by-url`, `settings` without a flag and `follow` change nothing; the others change what the watch does by
itself, so a session that runs one from its shell is asked about first.

## fd watch

```sh
fd watch get card-1
fd watch trace card-1 --json
fd watch describe card-1 > pr-description.md
fd watch by-url https://github.com/acme/api/pull/42
fd watch settings api
fd watch follow
fd watch set card-1 --disable
fd watch extend card-1 --rounds 2
fd watch resolve-held card-1 round-1 --push
fd watch settings api --max-rounds 4 --check "bun test" --budget-usd none
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
a paired host.

`follow` stays connected and prints the watch of a card each time it changes, until Ctrl-C (exit `0`); with `--json` it
prints one watch per line.

`set <card>` takes one of `--enable`, `--disable` or `--default` (the project's setting). `extend <card> --rounds <1-10>`
allows that many rounds on top of the limit. `resolve-held <card> <round>` takes `--push` or `--drop`, and prints the
round it did and then the card's watch.

`settings <project>` with flags changes only the fields they name: `--enable`, `--disable`, `--max-rounds`,
`--check <command>` (repeat it; `--clear-checks` empties the list), `--check-timeout-min`, `--budget-usd`, `--max-turns`,
`--persona`, `--max-failures`, `--daily-usd`, `--check-rounds`, `--check-env <NAME>` (`--clear-check-env`),
`--check-loop-default on|off` and `--drift-allow <glob>` (`--clear-drift-allow`). `--budget-usd`, `--max-turns` and
`--daily-usd` take `none` for no limit. A value the daemon would refuse is refused by the flag, before anything is sent.
A command that got no answer says it may or may not have changed the watch: read it back before trying again. A paired
host refuses a change of a field only the person at that host may edit.
