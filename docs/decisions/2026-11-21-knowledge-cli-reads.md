# The knowledge reads of the CLI (issue #3623, slice 1)

Context: `docs/decisions/2026-11-19-cli-first.md` says a feature is a `flightdeckd` command first and the screen calls the
same daemon request. `knowledge.list`, `knowledge.index` and `knowledge.feed` had a screen and no command. This slice adds
the three reads; the writes (`set-status`, `create`, `set-feed`) and their shell risk rules are the second slice. Parity:
the three rows now name `knowledge`, so the gap count falls by three.

## Decision

`flightdeckd knowledge list|index|feed <project>`, over the three requests, in `knowledge/knowledge-cli.ts` with its
text in `knowledge/domain/knowledge-cli-view.ts` (pure) and the words in `cli/domain/knowledge-args.ts`. `knowledge/`
gets its public entry, `index.ts`, which the command table imports.

- **The project.** A name or an id, through `resolveProject`, and the request carries that project's `path`. An absolute
  folder (`/`, `\` or a drive letter) that names no project goes to the daemon as it is. The handlers already resolve every
  folder with `resolveAllowedCwd`, so a folder outside the allowed roots is the daemon's refusal (exit `1`); the CLI adds no
  check of its own. A relative path is not guessed at: it is a missing project.
- **`list`** prints a document a line: path, status, type (`-` for none), title and the hash, then `supersedes`, `problems`
  and `warnings` when it has them. The hash is printed whole because the next slice's `set-status --hash` takes it and the
  CLI never reads it by itself. A list that was cut says so on its own line; an empty one says `no knowledge documents`.
- **`index`** prints the Markdown a session is given, as it is, line by line; empty text says
  `no document is given to sessions`. `--json` carries `text`, `fed` and `truncated`.
- **`feed`** prints `on`, or `off` with the folder that switches it off and whether it is the project itself or one above,
  and says when an untrusted project is not given the index whatever the switch says.
- `--json` keeps every key with `null` for a field an older daemon leaves out; text and JSON strip control characters, since
  titles and paths come from files.
- `knowledge` joined the commands that take `--host` and `--json`. It is not a `--confirm` owner: no read takes one.
  Nothing here writes, so the shell risk rules need no new entry.

## Discarded

- Resolving a relative folder against the shell's folder: a person names a project, and a path is only for a folder no
  project covers; guessing would hide a typo.
- A `--path` flag next to the project operand: one operand with two readings is shorter than two spellings of it, and the
  other verbs of this family already take a project that way.
