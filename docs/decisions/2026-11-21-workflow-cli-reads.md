# The workflow reads from a shell: flightdeckd workflow (issue #3628)

The first slice of `flightdeckd workflow`: the verbs that only read. The verbs that change something (trust a
workflow, add a template, resume a run) come in a second slice with their risk rules.

## Decision

- **The verbs.** `workflow list <project>`, `templates <project>`, `validate <project> <workflow>`, `run <run>`,
  `watch` and `resume <run>`. Each calls the daemon request the screen calls (`workflow.list`, `workflow.templates`,
  `workflow.validate`, `run.get`, `run.watch`, `run.resume`), on this machine or on a paired host with `--host`.
- **The hash is whole.** `list` and `validate` print the full sha256 of the file: trust is given to that exact
  content, so a later `trust --hash` can only be given what was read.
- **An invalid workflow is a result.** `validate` and `list` exit 0 for a workflow with errors and print them; `--json`
  prints what the daemon answered. Exit 1 is the daemon's refusal (an unknown project, workflow or run).
- **`resume` here only checks.** It sends no `confirm`, so it changes nothing: it says where a failed run would resume,
  or why it cannot. Over a connection the daemon does not trust for the vault it answers `transport_refused`, and the
  line says that. Actually resuming comes with the write slice.
- **`--confirm` is refused for now.** A flag no verb of the slice reads is refused by the parser, so a script cannot
  believe it confirmed something.
- **Answering a gate stays in the app.** `gate.respond` is app-only in `docs/cli-parity.json`: a gate asks a person,
  and a script or a session answering it would remove the person from the loop (fd-coordinator, #3628).

## Discarded

- **`workflow run` meaning "start a run".** Runs start from a card; a verb with that name that only reads would
  mislead. `run <run>` shows one, as `card get` does.
- **A shortened hash in the text.** Easier to read, but it cannot be handed to `trust --hash`.

## Consequences

- Five more daemon requests have a CLI command; `cli-parity-baseline.json` goes down by six (the gate is app-only).
- The write slice adds `workflow` to the verbs the shell risk rules read, with `trust`, `template-add` and
  `resume --confirm` rated high.
