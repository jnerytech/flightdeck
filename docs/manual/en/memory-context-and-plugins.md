# Memory, context and plugins

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/memory-context-and-plugins.md)

Two extensions of the project's **Agent** screen (phase 12) and a screen for Claude Code's plugins.

## Memory and context

On the **Agent** screen of a project, for a host that announces `memory`:

- **Memory** lists the files of the project's auto memory (`~/.claude/projects/<project>/memory`,
  shared by all worktrees of the repository): the `MEMORY.md` index and one file per topic, with the
  type and a mark for the ones the index does not mention. **Open** shows a file; **Save** and
  **Delete** always ask first, and a save repeats the hash of what was opened: if the file changed
  on disk meanwhile, nothing is written and **Reload** brings the new text, keeping yours on screen.
  **New memory** creates a plain `.md` file in that folder and nowhere else. Flightdeck only touches
  the memory on an explicit action of yours, and records each decision (the name and the hashes,
  never the text) in `memory-decisions.jsonl` next to the daemon's data.
- **Cleanup suggestions** point at duplicated files, index lines whose file is gone, files the
  index does not mention, files untouched for over 90 days and entries that look contradictory.
  They only point: nothing is changed unless you do it.
- **Context** is the budget of the start of a session: each source (the organization's, the user's
  and the project's CLAUDE.md, `CLAUDE.local.md`, rules, skills and memory) with an estimate of
  tokens (a quarter of the bytes) and whether it loads **at the start** or **on demand**. Only the
  first 200 lines or 25 KB of `MEMORY.md` enter at the start: the screen highlights the cut and
  lists the lines, and the files only those lines mention, that stay out.

## Plugins

The **Plugins** screen (sidebar, for hosts that announce `plugins`) drives the `claude plugin`
command of the host. A plugin runs code on the machine, so every plugin shows **what it installs**
before anything happens: the manifest, the hooks with the events they listen to, the monitors,
skills, agents, commands and MCP servers, and a hash of the whole content. Hooks on `PreToolUse` or
`PermissionRequest`, which can decide for you, carry an **attention** mark.

- **Installed** lists the plugins with version, scope and state: **See what it installs**,
  **Update**, **Pin version** and **Remove**. A pinned plugin is not updated until you unpin it.
  **Preview the folder** takes a local plugin folder: `claude plugin validate` runs first, and a
  folder it refuses cannot be installed.
- **Available** lists what the marketplaces offer; **Install** shows the content and its hash, and
  installing repeats that hash. A plugin that comes from another repository has no preview and is
  not installed from here.
- A command that a marketplace declares is shown, and only **Accept this command** accepts it, by
  its own sha256. Flightdeck never passes `-y` to the CLI.
- After an install or an update the folder the CLI left is hashed again; if it is not the content
  you saw, the plugin is uninstalled at once and the decision is recorded in
  `plugin-decisions.jsonl`.
- **Marketplaces** adds and removes (each after a confirmation) and updates.
