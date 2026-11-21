# The output of `flightdeckd action list` (issue #3629)

`flightdeckd action list` has two readers. The `flightdeck` mod runs `flightdeckd action list [--project p]` with no
flag and parses its raw JSON: the trusted actions only, each with `name`, `description`, `approval` and `params`. Its
tests pin that argv. A CLI-first `list` needs more: every action, trusted or not, with the `hash` that `action trust`
takes, whether it is `trusted` and what `changed`.

## Decision (fd-coordinator, 2026-11-21)

- With no flag, `action list` prints what it printed before: the raw, trusted-only JSON. A test pins it. The mod reads
  it, so changing its shape would break the mod and gain nothing for the new readers.
- `action list --json` prints `{ "actions": [ ... ], "errors": [ ... ], "issues": ... }` (what is wrong with the actions
  file; `issues` is `null` when absent) for every action, with `name`, `description`, `approval`,
  `params`, `hash`, `trusted` and `changed`. Never the command (`run`), the environment, the working folder or the
  secrets: a person decides to trust an action from its hash and what changed, and the declaration is in the file they
  already read.
- `action list --plain` prints one line for each action, for a person. The name is `--plain` and not `--text`
  because `--text` is the value flag of `snippet save`.
- `--json` and `--host` apply to `list --json|--plain` and `runs`. A bare `list` and `run` refuse both, because the mod
  has no use for them and a raw reader with a flag it ignores would mislead.
- `runnableActions` and the MCP `list_actions` stay as they are.

## Limits

`--hash` on `action trust` is only the caller's own word (#3439); the hash `list` prints is the one the host
holds now, and `trust` refuses when it no longer matches.

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

## The writes in short (slice 2)

`action save --definition-file <json object>`, `action trust <name> --hash <64 hex>` and `action remove <name>`, over
`actions.save`, `actions.trust` and `actions.remove`. They print the same allowlisted keys as `list --json`, never the
command, environment, folder or secrets that `ActionInfo` carries.

- `save` is high risk because the daemon trusts what is saved this way as it is saved (the app's own path): a shell save
  makes a command that runs with secrets with no second step. `trust` lets a versioned command run; `remove` deletes
  one. The rules live in `permissions/domain/action-risk.ts`; `action` joins `VERB_NOUNS` so a verb hidden by the shell
  is high too. `list`, `runs` and `run` keep their medium risk.
- The vault is in the app, not on the host, so no host command lists the secret ids. `--secret-ids a,b` sends them as
  `secretIds`; without it the daemon does not check secret references, as for any caller that omits the field.
- `trust` needs the whole hash (the daemon compares the full sha256). A refusal `action_changed_review` is followed by
  one `actions.list` read, and the current hash is added to the error so the person compares what they trust.
- `remove` only deletes what is in the daemon's table. A versioned action is removed by editing its file.
- The definition file is read before the host is asked. A write with no answer exits 2 and says the change may or may
  not have been made. There is no `--confirm`: the shell's risk rule, not a flag the caller types, is the gate.
