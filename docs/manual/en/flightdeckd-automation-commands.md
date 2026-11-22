# flightdeckd commands: the automations of a project

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/flightdeckd-automation-commands.md)

The verbs that read, save, turn on and off, and remove the automations of a project (a trigger, such as a time, a PR
comment, failing checks or a labeled issue, and the action it fires) and what each one did when it fired. They work as
the other `flightdeckd` commands do: see [what they all share](flightdeckd-commands.md#what-they-all-share). `list` and
`runs` change nothing.

## fd automation

```sh
fd automation list api
fd automation list api --json
fd automation runs a1
fd automation runs a1 --limit 20 --json
fd automation save api --name "Nightly triage" --definition-file nightly.json --max-runs 5
fd automation enable a1 --confirm
fd automation disable a1
fd automation remove a1 --confirm
```

`list <project>` prints one line for each automation of a project, named by its name or its id: its id, its name,
`on` or `off`, what fires it, what it does and how many runs a day it may make. `external authors allowed` is added
when it acts on content from third parties. A project with none prints `no automations` and exits `0`. A name that two
projects share is refused with their ids.

`runs <automation>` prints the runs of an automation, newest first: the time, the status (`ok`, `failed`, `ignored`,
`skipped`, `limited` or `missed`), the cause and the detail. `--limit` takes a whole number from 1 to 500. An
id the host does not know prints `no runs` too: the host answers an empty list, so check the id with `automation list`.

With `--json` the commands print the value the daemon returns, with `null` for a missing field. `--host <name>` reads
a paired host.

`save <project> --name <text> --definition-file <file>` writes an automation and prints it. The file is JSON with the
two things that make an automation, `{ "trigger": { ... }, "action": { ... } }`, in the shapes the app saves: for
example `{ "trigger": { "type": "cron", "expr": "0 3 * * *", "tz": "Europe/Lisbon" }, "action": { "type":
"start_workflow", "workflow": "triage" } }`. A file that cannot be read, is not JSON or does not fit is refused with
exit `1` before the host is asked. `--max-runs <n>` sets how many runs a day it may make (a whole number from 1),
`--external-authors on|off` says whether it acts on content from third parties, and `--automation <id>` changes that
automation instead of making a new one. `save` always leaves the automation off, so nothing fires until `enable`: saving over an automation that was on turns it off, and you turn it on again with `enable`. An `--automation` id the project does not have is refused.

`enable <automation> --confirm` turns it on: from then on it fires on its own. `--confirm` is required, and it is only
your own word that you read the trigger and the action (`automation list` prints what fires it and what it does).
Turning it on needs a near connection (this computer or Tailscale): over a far one the daemon refuses with `transport_refused`.
`disable <automation>` turns it off, answers anywhere and needs nothing. `remove <automation> --confirm` deletes it and its runs, and
`--json` prints the automations the project has left.

A host that does not answer after one of these was sent leaves its result unknown: exit `2`, and the message says to
check with `automation list` before trying again. An automation id the host does not know is refused with exit `1`.

From a session's own shell, `automation save`, `enable` and `remove` are **high risk** and need the person's approval
(`--confirm` proves nothing there, as it is only a flag the session types). `disable` and the two reads stay
ordinary.
