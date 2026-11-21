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

# The knowledge writes of the CLI (issue #3623, slice 2)

`flightdeckd knowledge set-status|create|set-feed`, over `knowledge.setStatus`, `knowledge.create` and `knowledge.setFeed`,
in the same `knowledge/knowledge-cli.ts`. The three rows of the parity map now name `knowledge`, so the gap count falls by
three more (131).

- **`set-status <project> <file> --status valid|transitional|obsolete --hash <hash>`.** The hash is what `list` printed;
  the CLI never reads it, so a file that changed since is the daemon's `file_conflict` refusal (exit `1`) and nothing is
  written. Prints the document as `list` does.
- **`create <project> adr|rfc|prd <title> [--body-file <file>]`.** The kind and the title are operands, since a document is
  made of them. The file is read before any daemon is asked: a file that cannot be read, or holds more than
  `KNOWLEDGE_BODY_MAX` (100 000) characters, is exit `1` with no request. The daemon's own refusals (a title with no letter
  or digit, a document that exists, a folder that leaves the project) reach the person as they are.
- **`set-feed <project> --on|--off`.** One direction, never both; prints the feed state as `feed` does.
- **Unsure result.** A write that gets no answer says the change may or may not have gone in and points at `knowledge list`
  (`feed` for `set-feed`), as the other write commands do.
- **Shared flags.** `--status`, `--on` and `--off` already belong to `message history`, `boardsync set-push` and
  `snippet favorite`, and the parser holds one handler per flag name: `knowledgeFlags` reads them as `knowledge`'s when the
  command is `knowledge` and hands any other command the handler it had. `--hash` and `--body-file` are plain values and
  need no choice; `persona`'s check lets them through for `knowledge`, and `knowledgeProblem` says which verb takes each.

## Shell risk

A session that can switch the feed decides what every session of the project is told, so any `set-feed` line is **high**,
on or off, by `permissions/domain/knowledge-risk.ts` (unlike `boardsync set-push`, whose `--off` grants nothing: here a
session could switch the library off to hide what it was told). `create` writes a new file a person reviews in the
project, and `set-status` moves one status line guarded by the hash, so both stay ordinary, as do the reads. `knowledge`
joined the nouns whose verb the shell may not expand (`$V`, a brace list), so a hidden verb is high too.

## Discarded

- `--kind` and `--title` as flags: a document cannot exist without them, so they are operands, like the project.
- `--confirm` on `set-feed`: from a shell it is only a typed word and grants nothing; the rule is on the shell line.
- A `--off`-only exception like `set-push`: see Shell risk.
