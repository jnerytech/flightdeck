# flightdeckd commands: the actions of a project

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/flightdeckd-action-commands.md)

The verbs that read the actions of a project (a command a session may run for you, with its approval rule) and what each
run did. They work as the other `flightdeckd` commands do: see
[what they all share](flightdeckd-commands.md#what-they-all-share). Both reads change nothing. How a session runs an
action without seeing its secrets is in [the actions chapter](actions-claude-uses-a-secret-without-seeing-it.md).

## fd action

```sh
fd action list --json --project api
fd action list --plain
fd action runs
fd action runs deploy --project api --limit 20
fd action runs --json
```

`list --plain` prints one line for each action, trusted or not: its name, its description, `trusted` or `not trusted`,
its approval rule, its hash and, when the file changed since it was trusted, what changed. `list --json` prints
`{ "actions": [ ... ] }` with the same keys for every action: `name`, `description`, `approval`, `params`, `hash`,
`trusted` and `changed`. Neither shows the command, the environment, the working folder or a secret. The hash is the one
a later `action trust --hash` takes.

`list` with neither flag is the one the `flightdeck` mod reads: raw JSON with only the trusted actions, their name,
description, approval and params. It stays as it is so the mod keeps working, and it has no `--json` or `--host`. `run`
is the mod's too.

`runs [<action>]` prints the runs, newest first: the time, the action, who asked, how it ended (`exit`, `timed out`,
`output cut`) and the output, indented. Secrets in the output are already masked by the host. `--limit` takes a whole
number from 1 to 500. With `--json` it prints `{ "runs": [ ... ] }` as the host answers.

`--project <name or id>` names the project; a name that two projects share is refused with their ids. Without it the
host's own actions and runs are asked for. `--host <name>` reads a paired host. Exit `0` done, `1` refused, `2` no
daemon.
