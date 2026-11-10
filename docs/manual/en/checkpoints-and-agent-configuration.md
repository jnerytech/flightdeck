# Checkpoints and agent configuration

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/checkpoints-and-agent-configuration.md)

Two things from Phase 12: going back in time inside a session (the **timeline**), and configuring
the agent of a project (the **Agent screen**). Both need a daemon that announces the
`checkpoints` and `agentcfg` features (0.12.0 or later); with an older one the buttons simply do not
show.

## Snapshots

At the start and at the end of every turn, when the session's folder is inside a git repository,
the daemon takes a **snapshot**: a copy of HEAD plus every change, untracked files included and
ignored files left out. It is built in a temporary index and kept as a commit that only
`refs/flightdeck/snapshots/<session>/<n>` points to, so your index, your files and `git status`
never change and nothing shows up in `git log`.

- Managed sessions take them by themselves. Terminal sessions take them from the
  [hooks](session-hub-and-claude-code-hooks.md#claude-code-hooks) (`UserPromptSubmit` before the turn, `Stop` after it), so the hooks
  must be installed.
- A turn that changes more than 200 MB is skipped, with the reason. A folder outside a repository
  has no snapshots.
- The daily maintenance keeps 50 snapshots per session and 30 days, and deletes the refs nothing
  uses any more.

## The timeline

The **Timeline** button in the header of a session (managed or terminal) opens a side panel with
its turns, oldest first. Each turn shows its number, the local time, the prompt, and whether it
changed files: **Changed files**, **No file changes** or **In progress**. **Show files of turn N**
lists the files that turn changed, with what happened to each (changed, created, deleted) and the
lines added and removed.

## Rewinding files

**Rewind files to here** puts the repository's files back to how they were before that turn.

1. A preview opens first: the files that change, what happens to each (goes back to what it was,
   will be removed because it was created later, will be restored), the lines, and how it goes
   back: through Claude Code's own checkpoint (a live managed session) or through the turn's git
   snapshot.
2. Nothing changes until you press **Rewind files**.
3. Before going back, Flightdeck saves the current state. **Undo rewind** (in the panel) brings
   it back.

It is disabled while the session is in a turn: stop the session first. Files ignored by git are
never touched, and only files inside the repository go back.

**What rewinding does not do.** It covers files, and only files. A database change, a network
call, a `git push` or any other command that acted outside the repository is not undone. The
SDK's own checkpoint does not see changes made by `Bash` or by subagents, which is why Flightdeck
adds the git snapshots.

## Forking

**Fork from here** creates a new conversation that starts at that turn; the original stays as it
is. You choose where to open it:

- **Open in Flightdeck:** a new managed session, resumed on the new conversation.
- **Open in the terminal:** the dialog shows the command (`flightdeckd claude --resume <id>`) and
  the button of the terminal.

**Also rewind the files** goes back to the state of that turn before opening the fork, with the
same preview as above. You can undo it from the timeline.

For a terminal session the daemon finds the turn's message in the transcript by its prompt. When it
cannot be sure (the same prompt said more times than there are turns, or the other way round, or
the message is not indexed yet), the fork is disabled on that turn and the panel says why.

The fork is written by the SDK as a new transcript in `~/.claude/projects`, like any Claude Code
session: the only write there that comes from this phase, and only when you ask for it.

## The Agent screen

**Projects → Agent of {project}** opens the project's configuration for Claude Code, in four tabs.
Flightdeck writes only files of the project, each time you press the button that names the file;
the user's `~/.claude` and `~/.claude.json` are shown **read-only**.

- **MCP:** the servers of the project's `.mcp.json` and the user's (`~/.claude.json`, general and
  for this project), each with its origin. You can add, edit and remove the `.mcp.json` ones; the
  on/off switch writes `.claude/settings.local.json`. The `.mcp.json` is versioned, and the screen
  warns you. Values of `env` and `headers` are masked: to save a server that has them, type each
  masked value again.
- **Test** shows the exact command and arguments (or the URL) and asks for confirmation before
  anything runs, because a stdio server is a command that came from the repository. It then starts
  the server, lists its tools and resources and stops it (15 s limit). Opening the list never
  starts a server.
- **CLAUDE.md, Agents and Skills:** the project's files (a `CLAUDE.md` in any folder,
  `CLAUDE.local.md`, `.claude/agents/*.md`, `.claude/skills/<name>/SKILL.md`) can be edited, with a
  preview; the user's are read-only. Saving compares the hash read when the file was opened: if the
  file changed on disk, nothing is overwritten, what you typed stays on screen and **Reload**
  brings the current version. Agents and skills have a form for the frontmatter (name,
  description, and tools and model for an agent) and keep every other line of the file. **New
  agent**, **New skill** and **New CLAUDE.md** create the file on the first save.
- Project files other than `CLAUDE.local.md` are versioned: the screen warns that saving changes a
  file of the repository.
