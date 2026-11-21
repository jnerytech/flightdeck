# `agentcfg list`, `read` and `write` get a CLI verb; the write is high risk (issue #3617)

Parent: #3423. Builds on the command gate of #3453 and #3507 and the rating of `project harness-apply` (#3599).

## Decision

`flightdeckd agentcfg list <project> --kind <kind>`, `agentcfg read <project> --kind <kind> --path <file>` and
`agentcfg write <project> --kind <kind> --path <file> --file <path|-> (--expected-hash <hash> | --new) --confirm`
call `agentcfg.list`, `agentcfg.read` and `agentcfg.write`. `--kind` is `claudemd`, `agent` or `skill`; `--origin
project|user` is passed to `read` and `write`. All three take `--json`, `--host` and the exit codes of the other
verbs: 0 done, 1 refused, 2 no daemon.

- `read` prints the file's hash. `write` repeats it with `--expected-hash`, or says `--new` for a file that must not
  exist yet. The CLI never reads the hash for the person, so a stale copy is refused by the daemon with
  `agentcfg_changed`, as it is in the app.
- The content comes from `--file <path>` or `--file -` (standard input). The CLI passes only the content: the
  daemon validates the frontmatter and the path, and returns the item's name and description.
- The daemon's refusal text is printed as it is, with its reason (`agentcfg_changed`, `agentcfg_exists`,
  `agentcfg_outside_project`, `agentcfg_path_invalid`, `agentcfg_field_required`, `agentcfg_file_missing`, ...).
  `--origin user` is passed through: the daemon says why a file of `~/.claude` is read-only.
- A write may have happened when the daemon goes silent, so the run says "may or may not have changed" (exit 2).
- In the text of `read`, the control characters of the content are turned into spaces, like every printed daemon
  text. `--json` keeps the content exact: JSON escapes the controls.

## What guards it

1. The risk rule. A session that runs `agentcfg write` from its shell is `high` (`agentcfg-risk.ts`), so the app asks
   the person first. `list` and `read` stay ordinary. The reason: every later session of the project reads the file
   as its own instructions.
2. `--confirm` and `--expected-hash` are only the caller's word, the limit #3439 describes for every `--confirm` verb.
   The hash guards against overwriting a change, not against a caller that wants to overwrite.

No transport guard is added here; that is the work of #3439.

## Parity

The three `agentcfg.*` rows of `docs/cli-parity.json` name `agentcfg`. The rows of `hooks.install`, `hooks.status`
and `hooks.uninstall` name `hooks`: `flightdeckd hooks install|status|uninstall` already does them
(`hook` is another command and accepts only `session-start`). The baseline drops by 6.

## Not done

`mcp.*`, `memory.*` and `plugins.*` stay as they were, and so does the app's use of these commands.
