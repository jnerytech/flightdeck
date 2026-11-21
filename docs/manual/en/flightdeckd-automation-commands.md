# flightdeckd commands: the automations of a project

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/flightdeckd-automation-commands.md)

The verbs that read the automations of a project (a trigger, such as a time, a PR comment, failing checks or a
labeled issue, and the action it fires) and what each one did when it fired. They work as the other `flightdeckd`
commands do: see [what they all share](flightdeckd-commands.md#what-they-all-share). They change nothing.

## fd automation

```sh
fd automation list api
fd automation list api --json
fd automation runs a1
fd automation runs a1 --limit 20 --json
```

`list <project>` prints one line for each automation of a project, named by its name or its id: its id, its name,
`on` or `off`, what fires it, what it does and how many runs a day it may make. `external authors allowed` is added
when it acts on content from third parties. A project with none prints `no automations` and exits `0`. A name that two
projects share is refused with their ids.

`runs <automation>` prints the runs of an automation, newest first: the time, the status (`ok`, `failed`, `ignored`,
`skipped`, `limited` or `missed`), the cause and the detail. `--limit` takes a whole number from 1 to 500. An
automation the host does not know is refused with exit `1`.

With `--json` the commands print the value the daemon returns, with `null` for a missing field. `--host <name>` reads
a paired host.
