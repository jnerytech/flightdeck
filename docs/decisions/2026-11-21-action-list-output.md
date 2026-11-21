# The output of `flightdeckd action list` (issue #3629)

`flightdeckd action list` has two readers. The `flightdeck` mod runs `flightdeckd action list [--project p]` with no
flag and parses its raw JSON: the trusted actions only, each with `name`, `description`, `approval` and `params`. Its
tests pin that argv. A CLI-first `list` needs more: every action, trusted or not, with the `hash` that `action trust`
takes, whether it is `trusted` and what `changed`.

## Decision (fd-coordinator, 2026-11-21)

- With no flag, `action list` prints what it printed before: the raw, trusted-only JSON. A test pins it. The mod reads
  it, so changing its shape would break the mod and gain nothing for the new readers.
- `action list --json` prints `{ "actions": [ ... ] }` for every action, with `name`, `description`, `approval`,
  `params`, `hash`, `trusted` and `changed`. Never the command (`run`), the environment, the working folder or the
  secrets: a person decides to trust an action from its hash and what changed, and the declaration is in the file they
  already read.
- `action list --plain` prints one line for each action, for a person. The name is `--plain` and not `--text`
  because `--text` is the value flag of `snippet save`.
- `--json` and `--host` apply to `list --json|--plain` and `runs`. A bare `list` and `run` refuse both, because the mod
  has no use for them and a raw reader with a flag it ignores would mislead.
- `runnableActions` and the MCP `list_actions` stay as they are.

## Limits

`--hash` on a future `action trust` is only the caller's own word (#3439); the hash `list` prints is the one the host
holds now, and `trust` will refuse when it no longer matches.

## The reads in short (slice 1)

`2026-11-19-cli-first.md` is at the Markdown size limit, so the record of this slice lives here. Slice 1 of `action`:
`action runs` over `actions.runs`, and `action list --json|--plain` over `actions.list`. The write side (`save`,
`trust`, `remove`) is the second slice.

- `runs [<name>] [--project] [--limit 1-500]`: the project is named by name or id (`resolveProject`); without
  `--project` `runs` asks for the runs of every project on the host (the daemon's `actions.runs` filters by scope only
  when a project is given). The limit is checked on the CLI before the host is asked.
- The output of a run is text a program wrote: it goes through `said`, which strips control characters, and the host
  has already masked the secrets in it.
- `--plain` is the text form of `list`. `--text` is already the body of `snippet save --text`, so a second meaning
  would confuse the same word across nouns.
