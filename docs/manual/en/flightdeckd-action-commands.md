# flightdeckd commands: the actions of a project

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/flightdeckd-action-commands.md)

The verbs that read, save, trust and remove the actions of a project (a command a session may run for you, with its approval rule) and
what each run did. They work as the other `flightdeckd` commands do: see
[what they all share](flightdeckd-commands.md#what-they-all-share). `list` and `runs` change nothing; `save`, `trust` and `remove` change what can run. How a session runs an
action without seeing its secrets is in [the actions chapter](actions-claude-uses-a-secret-without-seeing-it.md).

## fd action

```sh
fd action list --json --project api
fd action list --plain
fd action runs
fd action runs deploy --project api --limit 20
fd action runs --json
fd action save --project api --definition-file deploy.json --secret-ids token
fd action trust deploy --project api --hash <the 64 characters list prints>
fd action remove deploy --project api
```

`list --plain` prints one line for each action, trusted or not: its name, its description, `trusted` or `not trusted`,
its approval rule, its hash and, when the file changed since it was trusted, what changed. `list --json` prints
`{ "actions": [ ... ], "errors": [ ... ], "issues": ... }` with the same keys for every action: `name`,
`description`, `approval`, `params`, `hash`, `trusted` and `changed`. `errors` and `issues` say what is wrong with the
actions file (`null` when the host sends no issues), and `--plain` prints each error as an `error:` line, so an empty list
is never a broken file in disguise. Neither shows the command, the environment, the working folder or a secret. The hash is the one
a later `action trust --hash` takes.

`list` with neither flag is the one the `flightdeck` mod reads: raw JSON with only the trusted actions, their name,
description, approval and params. It stays as it is so the mod keeps working, and it has no `--json` or `--host`. `run`
is the mod's too.

`runs [<action>]` prints the runs, newest first: the time, the action, who asked, how it ended (`exit`, `timed out`,
`output cut`) and the output, indented. Secrets in the output are already masked by the host. `--limit` takes a whole
number from 1 to 500. With `--json` it prints `{ "runs": [ ... ] }` as the host answers.

`--project <name or id>` names the project; a name that two projects share is refused with their ids. Without it `list` asks
for the host's own actions and `runs` for the runs of every project on the host. `--host <name>` reads a paired host. Exit `0` done, `1` refused, `2` no
daemon.

## Saving, trusting and removing

`save --definition-file <file>` declares an action: the file holds the action's whole declaration as one JSON object, as the
app's form builds it. It prints the saved action (the same keys as `list --json`) and exits `0`. **The host trusts what
is saved this way as it is saved**, so the action can run, with its secrets in its environment, without a second step. Without `--project` it is
the host's own action. A declaration the host refuses (a name already in use for another kind, a bad parameter, a secret it does not
know) exits `1` with the host's text. The vault is in the app, not on the host, so the host cannot say which secret ids exist:
`--secret-ids token,deploy-key` sends the ids you know, and the host then refuses a reference to any other. Without the
flag the host does not check them.

`trust <action> --hash <hash>` lets a versioned action (from `.flightdeck/actions.yaml`) run. It takes the whole 64-character
hash that `list --plain` prints, and it trusts the action only if that is still its hash. If the file changed, nothing is trusted: it exits
`1`, prints the host's text and the hash the action has now, so you compare what you are about to trust. The hash is only a
word the caller types: it proves that the caller saw a hash, not that a person reviewed the file.

`remove <action>` deletes an action saved on the host or in the project, with its trust, and prints what is left. An action that
comes from `.flightdeck/actions.yaml` is not in that table: remove it by editing the file, and the host answers that it does not exist.
An unknown name exits `1`.

A write that got no answer (the host was cut off or too slow) exits `2` and says, on the error output, that the change may
or may not have been made: run `fd action list --plain` before trying again.

### From a session

When a session runs `fd action save`, `trust` or `remove` in its own shell, the request is **high risk** and goes to you: it
would write a command that runs with secrets, let one run, or delete one. `list`, `runs` and `run` stay ordinary shell commands. For `save` the request shows the path of the definition file, not what is in it, and
a session can change the file after you answer: open the file, and deny if you cannot read what it runs.
