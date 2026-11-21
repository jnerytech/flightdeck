# The read side of a project's auto memory from a shell (issue #3618)

Slice 1 of the memory verbs in [the CLI-first decision](2026-11-19-cli-first.md); the write side follows.

`memory list|read|budget|suggest <project>`, over `memory.list`, `memory.read`, `memory.budget` and
`memory.suggest`. They read the memory folder the daemon finds and change nothing.

- A project is named by id or by name (`resolveProject`, as `project` and `agentcfg` do). `read` also takes the file
  name, passed as typed: the daemon checks it (`memory_name_invalid`, `memory_not_found`) and a refusal is its text on
  stderr and exit `1`. The CLI does not rebuild the folder path, validate names or compute the budget.
- `list` prints a line per file with its hash, so a later write can repeat it as `--expected-hash`. An absent folder and
  an empty one are two different lines. `read` prints the hash on its own line before the content, and the content is
  split on its line breaks before it is cleaned, so the terminal never sees a control character from a file.
- `budget` prints the numbers the daemon computed; `--json` prints the budget as it came.
- `--json` keeps every key and prints `null` for `type`, `description` and `detail`.
- `memory` joined the commands that take `--json` and `--host`. The risk rules need no entry: nothing here writes, so
  `fd memory list` from a session's shell stays ordinary.
- Not in this slice: `write` and `delete`. They change files by path, so they come with a high-risk rule, `--confirm`,
  `--expected-hash` and a security review.
