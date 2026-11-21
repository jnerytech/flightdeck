# flightdeckd commands: the workflows of a project and their runs

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/flightdeckd-workflow-commands.md)

The verbs that read a project's workflows and their runs: the workflows with their hash and trust, the templates a
project can add, one workflow checked again, a run with its steps, a stream of every change of a run, and whether a
failed run can resume. They work as the other `flightdeckd` commands do: see
[what they all share](flightdeckd-commands.md#what-they-all-share). Trusting a workflow, adding a template, resuming a
run and answering a gate stay in the app.

## fd workflow

```sh
fd workflow list api
fd workflow templates api
fd workflow validate api ship
fd workflow run r1 --json
fd workflow watch
fd workflow resume r1
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

`resume <run>` only checks: it prints where a failed run would resume, or why it cannot, and starts nothing.

With `--json` the commands print what the daemon answered. `--host <name>` reads a paired host.
