# Approvals and always allow

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/approvals-and-always-allow.md)

Besides Approve and Deny, an approval, whether from a managed or a terminal session, offers:

- **Allow for this session:** shown when Claude Code suggests permissions with the `session`
  destination, which only apply to that session.
- **Always in this project:** opens the rule for editing before sending it.
  - For Bash, the default is the exact command, which you can replace with a prefix such as
    `npm test:*`.
  - For other tools, the default is the tool name.
  - A rule that names a folder, or a path that is not there yet, is refused: it would cover
    everything below it. A search over a folder (Grep, Glob) does not offer this button; the message
    says to name one file.
  - The rule goes to `<project>/.claude/settings.local.json`, Claude Code's local, unversioned
    file.

The daemon only accepts one of the request's own suggestions (`session` or `localSettings`
destinations) or a project rule for the same tool, up to 500 characters and with no line break.

- **Refused:** `userSettings` (`~/.claude/settings.json`), `projectSettings` (the versioned
  `.claude/settings.json`), `cliArg` and the `bypassPermissions` and `auto` modes.
- **On refusal:** the app shows the error, and the request stays open.

Cards run in worktrees, and each worktree has its own `.claude`:

- a rule accepted in a card session (or in a workflow step session) is also written to the
  `.claude/settings.local.json` at the repository root, without duplicating it and without
  touching the other keys;
- every new worktree gets a copy of the root file, unless the repository versions it;
- `.claude/settings.local.json` goes into the repository's `.git/info/exclude`, so it never shows
  up in a card's diff or in a commit.

On the Projects screen, **Edit** shows the project's **Rules** section, with a remove button that
asks for confirmation and preserves the rest of the file.
