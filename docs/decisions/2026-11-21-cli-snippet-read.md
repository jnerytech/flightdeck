# Reading snippets from a shell (issue #3615)

Slice 1 of the `snippet` noun: `snippet render`, `snippet parse` and `snippet import-history`, over `snippets.render`,
`snippets.parse` and `snippets.importHistory`. `list` and `get` (#3423, the mod's readers) keep their raw output and
flags; they take neither `--host` nor `--json`. The write side (`save`, `remove`, `favorite`, `trust`,
`import-history --select` and `use`) is the second slice, with `--confirm` and a high-risk rule.

- `render` resolves the word as a name first (the host's, then `--project-path`'s) and as an id when no name matches,
  then renders by id. The daemon's refusal (an unknown snippet, a field with no value) is printed whole; the CLI adds
  no second check.
- `parse` reads a file or stdin in the CLI and sends the text: the daemon never reads a path of the caller's, so no
  path check is added. The 1000000-character limit is the protocol's, checked before the send so the refusal names it.
- `import-history` sends no `select`, so it only previews. A flagged command comes back with `command: null` and the
  kinds the scan found; the view prints those kinds, never a value. `--reveal` is the protocol's own flag.
- Output: lines for a person, the daemon's answer whole under `--json` (`id`, `name`, `text`, `fields` for `render`).
  Daemon text goes through `plain`, so a terminal control in a snippet or a history line is printed without it.
