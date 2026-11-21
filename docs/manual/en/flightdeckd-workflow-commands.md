# flightdeckd commands: the workflows of a project and their runs

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/flightdeckd-workflow-commands.md)

The verbs that read a project's workflows and their runs: the workflows with their hash and trust, the templates a
project can add, one workflow checked again, a run with its steps, a stream of every change of a run, and whether a
failed run can resume. Three verbs change something: trust a workflow, add a template and resume a failed run. They
work as the other `flightdeckd` commands do: see [what they all share](flightdeckd-commands.md#what-they-all-share).
Answering a gate stays in the app.

## fd workflow

```sh
fd workflow list api
fd workflow templates api
fd workflow validate api ship
fd workflow run r1 --json
fd workflow watch
fd workflow resume r1
fd workflow trust api ship --hash <the hash list printed>
fd workflow template-add api review-loop --confirm
fd workflow resume r1 --confirm
```

A project is its name or its id.

`list <project>` prints the workflows of the base branch, one line each: the name, the whole hash of the file, `trusted`,
`untrusted` or `invalid`, how many `check` commands it can run and its inputs. A workflow with errors prints each one
below it as `error: ...`. A project with none prints `no workflow in .flightdeck/workflows on the base branch`.

`templates <project>` prints the workflows that ship with the product: the id, the title, where the file goes, the
persona of its agent steps and whether its `check` line holds the project's own test command (`filled`), a placeholder
that fails (`placeholder`) or none.

`validate <project> <workflow>` checks one workflow again and prints it in full: the name, the hash and the state, then
its inputs, its check commands and its errors. A workflow with errors exits `0`: the errors are the result.

`run <run>` prints a run: its state and the reason, what it spent, the time it waits for the plan quota until, and each
step with its attempt, type, state and exit code. An unknown run exits `1`.

`watch` writes one line for every change of a run on this host, starting with the runs that are active, until Ctrl-C
(exit `0`). With `--json` each line is one run.

`resume <run>` only checks: it prints where a failed run would resume and starts nothing. When it cannot resume it prints why, with the parameters of
the reason, and exits `1`. The reason is a stable word a script can read; over `--host` the daemon answers
`transport_refused` for every run, so run the check on the host itself.

`trust <project> <workflow> --hash <hash>` gives the workflow the trust to run its shell commands, and prints it as
`validate` does. The hash is the whole 64 characters `list` printed: the command never reads one for you. A workflow
that changed since you read the hash, or has errors, is refused with exit `1`.

`template-add <project> <template> --confirm` commits the template on a new branch of the project and opens its pull
request, then prints the file, the branch, the base and the pull request. Without `--confirm` it exits `1` and changes
nothing. It needs a connection from the computer the daemon runs on: over `--host` the daemon refuses it.

`resume <run> --confirm` runs the project's commands again from the step that failed, and prints `<run> resumed from
<step>`. It needs the same near connection. A run that cannot resume prints why and exits `1`.

`--hash` and `--confirm` are only the word of whoever types them: a session's shell can type them too, so a session
that runs these three verbs is stopped for the person's answer. If the connection is lost while one is in flight,
the command exits `2` and says the change may or may not have happened: look with `list`, `run` or the project's
branches before you run it again.

With `--json` the commands print what the daemon answered. `--host <name>` reads a paired host.
