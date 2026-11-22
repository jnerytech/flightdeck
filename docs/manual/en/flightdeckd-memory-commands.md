# flightdeckd commands: the auto memory of a project

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/flightdeckd-memory-commands.md)

The verbs that read and change the Claude Code auto memory of a project: the folder of notes Claude keeps for it and
loads at the start of a session. They work as the other `flightdeckd` commands do: see
[what they all share](flightdeckd-commands.md#what-they-all-share). `list`, `read`, `budget` and `suggest` change
nothing; `write` and `delete` change a note. The app's own screen is in
[Memory, context and plugins](memory-context-and-plugins.md).

## fd memory

```sh
fd memory list api
fd memory read api MEMORY.md
fd memory budget api --json
fd memory suggest api
```

A project is named by its id or its name. `--host <name>` reads a paired host.

- `list <project>` prints one line per file: its name, its hash, its size in bytes and lines, whether the index
  (`MEMORY.md`) names it, and its type and description when it has them. A project with no memory folder prints
  `no memory folder: <folder>`, and a folder with no file prints `no memory files in <folder>`; both exit `0`.
- `read <project> <name>` prints the file's identity, then `hash: <hash>`, a blank line and the content. The hash is
  what a later change of the file repeats to prove it read the current version. A name that is not a plain file name,
  or a file that is not there, exits `1` with the host's text.
- `budget <project>` prints what the memory costs at the start of a session: the tokens, the index against its limits
  (lines and bytes), how much of it loads and what cut it (`lines` or `bytes`), and the lines and files left out. An
  index that fits prints `all of it`.
- `suggest <project>` prints the cleanups the Memory screen proposes, one per line: the kind (`duplicate`,
  `broken-link`, `orphan`, `stale` or `contradiction`), the files, and a detail when there is one. No suggestion
  prints `no suggestions`.

With `--json` each verb prints one JSON value with every key, and `null` for what a file or a suggestion has none of
(`type`, `description`, `detail`). Text a session or a person wrote into a file is printed with its control characters
replaced, so it cannot drive the terminal. The exit code is `0` for done, `1` for refused and `2` when no daemon
answers.

## Changing a note

```sh
fd memory write api tdd.md --file next.md --expected-hash <hash> --confirm
fd memory write api notes.md --file - --new --confirm < notes.md
fd memory delete api tdd.md --expected-hash <hash> --confirm
```

- `write <project> <name> --file <path> --expected-hash <hash> --confirm` replaces a note with the content of a file,
  or of standard input when the path is `-`. The hash is the one `list` or `read` printed: the host refuses the write
  with `memory_changed` if the note is no longer that version, so you never overwrite a change you did not read.
  `--new` takes the place of the hash for a note that must not exist yet, and the host refuses it with
  `memory_exists` if it does. It prints `wrote <name>  hash: <new hash>`.
- `delete <project> <name> --expected-hash <hash> --confirm` deletes a note and prints `deleted <name>`. A note that is
  not there is `memory_not_found`, and one that changed is `memory_changed`.
- `write` and `delete` need a near connection (this computer or Tailscale), since a note is read into the project's sessions: over a far one the daemon refuses with `transport_refused`. `list` and `read` answer anywhere.
- `--confirm` is required: without it nothing is sent. A name that is not a plain file name, or that is a link, is
  refused by the host (`memory_name_invalid`, `memory_is_link`) with exit `1`.

A write that gets no answer exits `2` and says the note may or may not have changed: run `memory read` before you
repeat it. With `--json` a write prints `{ "name", "hash" }` and a delete prints `{ "name" }`. In the shell of a
session, `write` and `delete` are high-risk commands: the app asks the person first, because every later session of the
project loads the note as its own memory. `--confirm` and `--expected-hash` are words typed by whoever runs the command,
so they do not stand for the person.
