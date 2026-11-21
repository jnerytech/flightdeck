# The write side of a project's auto memory from a shell: `memory write` and `memory delete` (issue #3618)

Slice 2 of the memory verbs in [the CLI-first decision](2026-11-19-cli-first.md); slice 1 is
[the read side](2026-11-21-memory-read-cli.md).

## Decision

Two verbs over `memory.write` and `memory.delete`. Both take `--json`, `--host` and the exit codes of the other verbs:
0 done, 1 refused, 2 no daemon.

- `memory write <project> <name> --file <path|-> (--expected-hash <hash> | --new) --confirm` replaces a note with the
  content of a file, or of standard input for `-`. The hash is the one `memory list` or `memory read` printed, and
  `--new` is a null hash for a note that must not exist. The two cannot go together and one of them is required.
- `memory delete <project> <name> --expected-hash <hash> --confirm` deletes a note.
- All of it is refused before anything is sent: a missing `--confirm`, a missing or malformed hash (64 hex digits), no
  `--file`, a content file that cannot be read, and a flag that belongs to the other verbs. The daemon's refusals
  (`memory_write_confirm`, `memory_delete_confirm`, `memory_changed`, `memory_exists`, `memory_not_found`,
  `memory_name_invalid`, `memory_is_link`) print as its own text with its reason, exit 1.
- `--file`, `--expected-hash` and `--new` keep the one handler they have for `agentcfg`; `agentcfg`'s check of stray
  flags now leaves the flags of a `memory` line to `memoryProblem`, as it does `review add`'s `--path`.
- The CLI neither rebuilds the folder path, nor validates the name, nor computes the hash: the daemon does.

## What guards it

A session that runs `memory write` or `memory delete` from its shell is `high` (`memory-risk.ts`), so the app asks the
person first: every later session of the project loads the notes at its start as its own memory, so a session could
plant instructions for the next one, or erase what the person kept. `list`, `read`, `budget` and `suggest` grant
nothing, so they stay ordinary. `memory` joined the commands whose verb a shell expansion cannot hide, and its flags
`--file` and `--expected-hash` were already read as valued options.

Without a device-bound confirmation in the daemon, the typed `--confirm` and `--expected-hash` are all a person at a
terminal has: the same state as every other `--confirm` verb of the CLI (#3439).

## Writes that get no answer

A write or delete that is cut or silent may have happened. The run exits `2` and says "the memory file may or may not
have changed: read it again before you write again".

## Not done

A transport guard or a #3439 proof for write and delete, `agentcfg.*`, and any change to how the daemon finds the
folder, validates names or computes the budget.
