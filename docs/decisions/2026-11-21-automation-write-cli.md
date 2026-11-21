# The write side of a project's automations from a shell (issue #3627)

Slice 2 of the `automation` noun, after [the read side](2026-11-21-automation-read-cli.md).

`automation save <project> --name <text> --definition-file <file>`, `automation enable <automation> --confirm`,
`automation disable <automation>` and `automation remove <automation> --confirm`, over `automation.save`,
`automation.toggle` and `automation.remove`. An automation starts workflows and cards on its own, so the verbs that
create it, turn it on or delete it are the app's decision.

- `save` takes the scalar fields as flags (`--name`, `--max-runs`, `--external-authors on|off`, `--automation <id>` to
  change one) and the trigger and the action from a JSON file, `{ "trigger": ..., "action": ... }`: they are nested
  unions, and a flag for each field would grow with the protocol. The runner reads the file and checks it against the
  protocol's own `AutomationTrigger` and `AutomationAction` before the daemon is asked, so a file that cannot be read,
  is not JSON or does not fit is exit `1` and changes nothing (the error says how many problems and of which kind,
  never the text, through `parseJsonWith`). `--automation` is the id flag, not `--id`: `--id` already belongs to
  `budget`, with its own refusal. The flags of `save` are refused on the other verbs (`automationProblem`).
- `save` leaves the automation off: the daemon never takes an `enabled` field from it. Nothing fires until `enable`, so
  `save` alone is a draft.
- `enable` needs `--confirm` and sends `confirm: true`, as the app does after it shows the trigger and the action.
  `remove` needs `--confirm` too, with a refusal that says it deletes the automation and its runs. `disable` grants
  nothing and needs none. `--confirm` is refused on the other verbs, and `automation` joined `CONFIRM_OWNERS`.
- `--confirm` is only a flag the caller types, so it proves nothing against a session that runs the command from its
  own shell. The risk rules are the guard there: `automation save`, `enable` and `remove` are **high**
  (`automation-risk.ts`, `changesAnAutomation`), through a runtime or a shell given the text, and `automation` joined
  the nouns whose verb a shell expansion may hide (`VERB_NOUNS`), so `fd automation $A a1` is high as well. `disable`,
  `list` and `runs` stay ordinary. The new value flags are in `OPTIONS_WITH_VALUE`, so a flag cannot hide the verb.
- `--json` prints the saved or toggled automation with every key (`null` where an action leaves a field out), and the
  automations left for `remove`. The text is one line: `saved|enabled|disabled <the line list prints>`, or
  `removed <id>`.
- A daemon that does not answer after one of the four was sent leaves its result unknown: exit `2`, and the message
  says to check with `automation list` before trying again.
- `--name` is the flag `persona save` already has; the persona check skips it for `automation`, which requires it on
  `save` and refuses it on the other verbs.
- `save --automation <id>` changes an automation of that project only: the runner asks `automation.list` first and
  refuses an id the project does not have (exit `1`), because the daemon keeps the project of a row it has and an id
  from another project would overwrite that one. Saving over an automation turns it off, as the daemon does for every
  save; the manual says so. The definition file takes only `trigger` and `action` (a key such as `maxRunsPerDay` is
  refused, not dropped: the scalars are flags), and `--max-runs` takes a safe integer.
- `disable` stays ordinary: it only stops what a person turned on, and the app's own toggle does the same without a
  card. A session that turns off a person's automations is an availability change, not a new thing that fires.
- Not in this slice, and a gap to report: nothing stops a token holder from enabling an automation over the wire (the
  daemon takes `automation.toggle` with `confirm` from any paired client, as the app does).
