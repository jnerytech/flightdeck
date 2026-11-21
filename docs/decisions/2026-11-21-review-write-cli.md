# The write side of the inline review comments from a shell: `review add|update|remove|send` (issue #3619)

Slice 2 of the review verbs in [the CLI-first decision](2026-11-19-cli-first.md); slice 1 is `review list`.

## Decision

Four verbs over `review.add`, `review.update`, `review.remove` and `review.send`. All take `--json`, `--host` and the
exit codes of the other verbs: 0 done, 1 refused, 2 no daemon.

- `review add <target> --path <file> --lines <n|a-b> --body <text> [--side new|old]` keeps a draft. The side is `new`
  by default. `--lines` is one line or a range; zero, a start after the end, a non-integer and a number past the
  safe integers are refused before anything is sent.
- `review update <id> --body <text>` changes a comment's text. The daemon answers `null` for an id it no longer has;
  the verb says so and exits 1 rather than print a success.
- `review remove <id>` deletes a comment. The daemon answers nothing whether the id existed or not, and it also
  removes comments already sent, so the verb cannot tell an unknown id from a known one and prints `removed <id>`.
- `review send <target> --confirm [--language en|pt-BR]` sends the drafts into the target as one message. `--confirm`
  is refused on every other verb and the verb flags (`--path`, `--side`, `--lines`, `--body`, `--language`) on the
  verbs that do not own them.
- `--path` is one parsed field, `pathFlag`, shared with `agentcfg read|write`, since the parser keeps one handler per
  flag.

## What guards it

`send`, `update` and `remove` from a session's shell are `high` (`review-risk.ts`). `send` puts text into a session, a
card or a terminal, which the app does only when the person presses Send review. `update` and `remove` act on any
comment by its id, so a session could rewrite or erase a draft the person wrote, and the text the person then sends
would carry the session's words. A verb the shell expands (a variable, a glob, a brace list, an ANSI-C quote or a
command substitution) is read as high too, and `review` joined the commands whose verb a shell expansion cannot hide.
`list` and `add` stay ordinary: they send nothing and leave the person's drafts as they are.

The security review (2026-11-21) rated `update` of the person's draft medium and `remove` and `add` low. The task
brief had `add`, `update` and `remove` ordinary; the review's fallback (`update` and `remove` high, `add` ordinary) is
what shipped, since a rule over an id cannot tell a session's own drafts from the person's.

## Writes that get no answer

A write that is cut or silent may have happened. The run exits `2` and says what to run before repeating it: `review
list` on the target for `add`, `update` and `remove`, and a look at the session for `send`.

## Known costs

- `add` lets a session write a draft on any target it knows the id of. The person reads the drafts before pressing
  Send review, and a session can already message another session with `send` and `card message`, so `add` grants
  little. The body has no length limit.
- `update` clears the comment's author, so a rewritten draft is sent unframed, as the person's. The lasting fix is in
  the daemon, not in the shell rule: stamp a draft added from the CLI with an origin, refuse `update` and `remove`
  on the person's drafts, refuse `remove` of a sent comment, and cap the body. Not done here; the protocol changes.
- `remove` of an unknown or sent id succeeds silently (the host's answer carries no information).
- The shell rule reads the command line, so an alias, a script written and run, or `ssh host fd review send` is not
  seen; this holds for every high verb of the CLI.
- Without a device-bound confirmation in the daemon, the typed `--confirm` of `send` is all a person at a terminal
  has: the same state as every other `--confirm` verb of the CLI.
