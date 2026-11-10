# Fix: a session manages cards through the flightdeck MCP server (issue #1711, moved from DECISIONS.md)

- New MCP tools `move_card`, `update_card`, `comment_card` and `finish_card`, all through one
  daemon command, `card.manage { as, cwd?, action, ... }`. The daemon finds the project of the
  session from where it runs (a managed session's own folder, else the `cwd` the MCP server
  sends) with `Board.projectForCwd`, and the session's own card is the one whose worktree holds
  that folder: it is the default `cardId`. A card of another project is refused
  (`card_other_project`), a session outside every project too (`card_scope_unknown`), and a
  session in a project but not in a card needs the id (`card_id_needed`). The actions reuse the
  board's own methods (`moveCard`, `updateCard`, `completeCard`, `discardCard`), so the rules and
  the live `card.updated` are the same as in the app.
- Cards have no comment thread, so `comment_card` appends a UTC-dated note to the description
  (`**Note YYYY-MM-DD HH:MM:** text`), keeping the old text.
- `finish_card` takes `done` or `discard` in one tool, as asked. The permission side keys on the
  input: with `outcome: "discard"` the risk classifier says high ("never automatic"), and for the
  tool in any form the broker offers no "always allow" suggestion and `checkUpdates` refuses a
  rule for it, so the project's saved rules cannot approve it. (Every MCP tool already counts as
  network access, which the automatic approval never takes.) What a user types into their own
  Claude Code `settings.json` is theirs to decide and outside what the daemon can enforce.
- In a session in `bypassPermissions` the SDK skips `canUseTool`, so `finish_card` with `discard`
  runs there without a prompt. That is the explicit choice of the person who turned bypass on for
  the host and picked that mode for the session; the manual says so next to the bypass switch.
