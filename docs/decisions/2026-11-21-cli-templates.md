# Task templates, what a task made and harness templates from a shell (issue #3738)

`template list|start`, `task results|preview` and `harness templates list|delete`, over `template.list`,
`template.start`, `task.results`, `task.preview`, `harness.templates.list` and `harness.templates.delete`.

- `template start` takes each field as `--field <id>=<value>`, once per field (the first `=` splits the id, so a value
  may hold one; a repeated id is refused). `--language` (default `en`) and `--name` (1 to 100 characters) are the
  protocol's own. The daemon still validates the template, the values and the folders; the CLI only checks the shapes.
- `task results|preview` take the session by id or by name, as the other session commands do. The daemon decides which
  paths are a task's results, so a path outside them is a refusal with its text. A list or a preview cut short is said
  on stderr, and stdout stays what a script reads.
- `harness templates delete` needs `--confirm` and refuses without it before it connects; it then sends `confirm:
  true`. The daemon already refuses a far connection (`requireVaultTransport`) and unless `confirm` is true, so the CLI
  adds no exception. A lost connection says the template may or may not be deleted.
- The risk rules rate `template start` and `harness templates delete` high from a session's shell, through `fd`,
  `flightdeckd`, `bun run .../bin.ts` and `bash -c`, and rate a shell-expanded verb of either noun high too. The reads
  stay ordinary. `--confirm` and the field values are only typed words, so the rating is the gate (#3439). `--field`
  joined the options-with-a-value list the rules skip, and `harness` and `template` the nouns whose verb they read.
- The parity table rows of the six commands moved from `{}` to their noun.
