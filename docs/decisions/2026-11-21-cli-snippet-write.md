# Changing snippets from a shell (issue #3615)

Slice 2 of the `snippet` noun: `save`, `remove`, `favorite`, `trust`, `use` and `import-history --select`, over
`snippets.save`, `snippets.remove`, `snippets.favorite`, `snippets.trust`, `snippets.use` and `snippets.importHistory`
with `select`.

- `--confirm` is required by `save`, `remove`, `trust`, `use` and `import-history --select`, and refused on every other
  verb, so a flag that does nothing is never silently accepted. `favorite` needs none: it only marks a row.
- Risk: `save`, `trust`, `use` and `import-history --select` are high (`permissions/domain/snippet-risk.ts`). A saved
  command is typed into a terminal with one key later; a trusted project file makes its commands runnable, and a
  session working in that repo can write that file, so `trust` then `use --enter` would be a session running its own
  command; `use` types, and with `--enter` runs, text in a terminal. `remove`, `favorite` and the reads stay ordinary
  shell commands. A word the shell expands in an `import-history` line is read as `--select`, as for `history resume`
  (#3570). `--value`, `--run`, `--text`, `--select` and `--terminal` are in the shell rules' option list (#3566).
- `use` always sends `action: "paste"` with the terminal given: the text goes into that terminal, and `--enter` is the
  only thing that runs it. The daemon's `run` and `send` actions (a snippet run in a new terminal, or sent to a
  session) are not in the CLI yet.
- A name is resolved as for `render` (a name first, then an id). With `--project-path`, a name that a host snippet and a
  project snippet both have is refused for `remove`, `favorite` and `use`, with the ids, because the host's would win;
  the id is then given instead. A name no snippet has is the daemon's `not_found`, exit `1`, and nothing is written.
- `remove` stays an ordinary shell command, but on a snippet of a project's versioned file it rewrites that file and
  drops its trust. A session can already edit that file in its own repository, so the rule adds no gate there.
- `use` prints one stdout line for each line of the text, as `render` does; `--json` keeps the text exact.
- `import-history --select` takes at least one id, and neither `--limit` nor `--reveal` (they only shape the preview).
- The verb of a `snippet` line the shell expands (`fd snippet $V ...`) is read as high, as for the other nouns (#3559).
- The write that may have gone out is said when no answer came: `note.wrote` is set right before each write call, and
  exit `2` carries "the host may or may not have made the change".
- Left out: `save --target file` (writing the project's versioned file), editing a snippet by id, `--var` defaults on
  `save`, and the `run` and `send` actions of `use`.

Open question for the coordinator: the `snippets.use` handler and `SnippetUse` hold no guard I could find, so any client that holds the token may type
into any terminal the daemon has. The CLI takes the same path as the app; a guard (for instance the proof the daemon
asks for the plugin installs) would be a protocol change of its own.
