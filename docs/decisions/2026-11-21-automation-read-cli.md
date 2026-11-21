# The read side of a project's automations from a shell (issue #3627)

Slice 1 of the `automation` noun in [the CLI-first decision](2026-11-19-cli-first.md).

`automation list <project>` and `automation runs <automation> [--limit <1-500>]`, over `automation.list` and
`automation.runs`. They read what the daemon already keeps and change nothing. The write side (`save`, `enable`,
`disable`, `remove`) is the second slice: an automation starts workflows and cards on its own, so it comes with its own
high-risk rules and a security review.

- The noun is `automation`, as the protocol names it. `list` takes a project (its name or its id, through
  `resolveProject`: a name two projects share is refused with their ids); `runs` takes an automation id, which `list`
  prints first on each line.
- `list` prints one line for each automation: its id, its name, `on` or `off`, what fires it, what it does, its daily
  limit, and `external authors allowed` when it acts on third-party content. A project with none is
  `<project>: no automations` and exit `0`: the lookup worked and the answer is "none".
- `runs` prints the number of runs and then one line for each, newest first as the daemon sends them: the time, the
  status, the cause and the detail. An automation that never fired is `<id>: no runs`. An id the daemon does not know
  gets the same answer, because `automation.runs` returns an empty list for it: exit `0`. A refusal from the daemon is exit `1`,
  one line on stderr.
- `--limit` is the shared flag. The parser already refuses a value outside 1 to 1000; `automation` stops at the daemon's
  own bound of 500 and refuses the flag on `list`.
- Names, labels and details are text a person or a repository wrote; the shared `shown` helper strips the control
  characters, so a name cannot drive the terminal.
- `--json` keeps every key and prints `null` where an action leaves a field out (`inputs`, `title` and `description`
  of `start_workflow`, and a run's `detail`).
- `automation` joined the commands that take `--json` and `--host`. The risk rules need no new entry: nothing here
  writes, so `fd automation` from a session's shell stays ordinary.
- Not in this slice: `save`, `enable`, `disable` and `remove`.
