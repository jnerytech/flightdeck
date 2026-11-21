# The read side of the review comments from a shell (issue #3619)

Slice 1 of the review verbs in [the CLI-first decision](2026-11-19-cli-first.md).

`review list <target>`, over `review.list`. It reads the inline comments the daemon keeps for a target and changes
nothing.

- The noun is `review`, as the protocol names it. The operand is the protocol's own target (`session:<id>`,
  `card:<id>`, `terminal:<id>` or `project:<id>`), passed as typed: the daemon checks it, and a target it refuses is
  its text on stderr and exit `1`. The verb does not resolve a name to an id, since a target already carries one.
- A comment prints as a line with its id, `path:start-end` (`path:line` when one line), the side, and its state, then
  `outdated` and a second opinion's author and severity when they apply, with the body on the lines under it. A body
  is split on its line breaks before it is cleaned, so the terminal never sees a control character from text a session
  wrote.
- No comment is `<target>: no comments` and exit `0`.
- `--json` keeps every key and prints `null` for `author` and `severity` when a comment has none.
- `review` joined the commands that take `--json` and `--host`. The risk rules need no new entry: nothing here writes,
  so `fd review list` from a session's shell stays ordinary.
- Not in this slice: `add`, `update`, `remove` and `send`. `send` writes the review into a session, so it comes with
  its own high-risk rule, `--confirm` and a security review.
