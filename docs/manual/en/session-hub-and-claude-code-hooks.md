# Session hub and Claude Code hooks

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/session-hub-and-claude-code-hooks.md)

The **Sessions** screen is the app's main one: every Claude Code session of the online hosts in
one place, grouped by project and ordered by last activity.

- **Project first.** Each project is a group with a bold heading (a folder, its name, a **live/total**
  chip and one chip per host, which opens that host's page). **Every project starts folded**, showing
  only its header and the sessions that need you; open one with its arrow, and the choice is
  remembered per project. **Expand all** and **Collapse all** at the top do it for every project.
  Opened, a project shows its live sessions first (the ones that need you on top). The
  ended and history sessions sit behind **N earlier sessions**, newest first. Typing in the filter
  also matches project names, and any filter (text, origin, state, persona, pinned) opens
  everything it keeps. Picking a host in **Data from** only narrows the list to that host: the
  projects stay as folded or open as you left them. The fold of a project is remembered under a key that does not
  change when a host goes offline or folders merge. A pinned session always stays with the live ones. **The same project on two
  hosts is one group** with both host chips, and each row keeps its own host chip. A project
  without a git remote is matched by its folder name across hosts, but never when one host has two
  folders with that name: those stay separate groups everywhere. Groups that share a name show a
  short **path hint** (the folder above the project, for example `work`) beside the heading and in
  its name for screen readers. **Data from** in the toolbar (with two hosts or more) lists one
  host's sessions or every host's, the same choice as on Home; **See all sessions** on a host page
  looks at that host for the visit without changing it.
- **Titles.** A session is called by its name, else the title its host gives it (the summary Claude
  Code wrote, or its first prompt), else the persona with the task, else its folder. System wrappers (`<task-notification>`,
  "Another Claude session sent a message:", local-command output) never appear in a title.

## What the list shows

| Origin | Where it comes from |
| --- | --- |
| Flightdeck | sessions the daemon itself runs (`session.list`) |
| terminal | sessions opened outside Flightdeck, in the terminal or in VS Code's integrated terminal, seen through the Claude Code hooks (`external.list`) |
| history | transcripts indexed from `~/.claude/projects` (`history.list`) |

A session appears only once. The order of preference is managed, then terminal, then history.

- **Group:** the project. What counts is the `remote.origin.url` of the repository of the
  session's folder, normalized, so SSH and HTTPS of the same repository land together. Worktrees
  count as the main repository. Without a remote, the repository root counts; without a
  repository, the folder. The folder is the one the session started in, where its transcript is
  filed: a terminal session that later works in another folder stays in its own project.
- **Row:** shows host, origin (a terminal session has a "terminal" chip), state (running, needs you, idle, ended), the "controllable" badge
  and the time.
- **Summary:** below, a line taken from the transcript, with no AI: "Request: <first line of the
  last prompt, up to 80 characters>" and what the session is doing now ("running Bash", "waiting
  for approval of Write", "idle 12 min ago"). The daemon sends it in the `summary` field of the
  lists.
- **View:** the two buttons at the start of the toolbar (**List** and **Cards**) switch how the
  sessions are drawn. A card shows the title (click to open), the project, the host, the status
  dot, the persona, the cost (on hosts that report it) and the last line (the request and what the
  session is doing, such as the tool waiting for approval), with the same menu as a row. Cards sit
  in as many columns as the width allows. The choice is remembered.
- **Filters:** text, host, origin, state, "Pinned only" and "Show archived". Archived sessions are
  left out by default.
- **Menu:** rename, pin (pinned sessions go to the top of the group), archive and "Copy command"
  (`flightdeckd claude --resume <id>`).
- **Opening a session:**
  - managed: opens the conversation;
  - terminal, still alive: opens the live transcript, with its permission requests and, if it is
    controllable, the message box;
  - ended or from history: opens the reader, with "Continue in Flightdeck".

## The message box

- In a session's message box you can **paste or drop images** (PNG, JPEG, GIF or WebP, up to five
  per message and 5 MB each; the host must support it). They show as thumbnails you can remove
  before sending, and the conversation notes how many images a message carried. A file that does
  not fit says why instead of being attached.
- While a turn runs, **Queue** (or Enter) puts the message in a **Queued** list above the box
  instead of sending it. **Edit** takes it back into the box and **Remove** drops it; when the turn
  ends the queued messages go out in order, one per turn.
- **Enter** sends the message; **Ctrl+Enter** (or Shift+Enter) adds a new line. The send icon (↵)
  shows when the box has text. Typing `/` offers the snippets and the commands of the session.
- Under each assistant message a row shows on hover or keyboard focus: **Copy message**, **Fork from
  here** (on the latest message: it carries the whole conversation so far), **Pin session** and how
  long ago the message was written.
- The box floats at the bottom as a rounded card. **+** attaches images (when the host supports it).
  Under the card a status line shows the model and the permission mode, and a spinner while a turn
  runs. When the session lets you change them, the mode is a **chip** (for example "Default"):
  click it, or focus it and press Enter, to open the **Mode** menu with every mode, what it does
  and its number (press 1 to 4 to pick one). **Shift+Tab** in the box cycles Default, Accept edits
  and Plan. **Bypass permissions** is in the menu too, but the chip never lands on it by cycling:
  it asks first, naming the host and the session, and the chip turns red while it is on. On a
  host where the switch is off (or for a mode looser than the one the session started with) the
  row is greyed out, says why, and links to the host's settings. The model is a chip too ("Opus
  5.5 · Medium"): its **Model** menu lists Default, Opus, Sonnet and Haiku with what each is for
  and its number (press 1 to 4), **More models** has the specific versions, and **Effort** (on a
  host that supports it) sets Low, Medium, High, Extra high or Max for the next turns, or back to
  the model's own level. An OpenCode session keeps a plain list of its own models. While a turn
  runs a line above the box says what is happening ("Running a command", "Editing files", "Waiting for you") and for how
  long; the spinner stops moving if your system asks for reduced motion.
- **Waiting on a button:** a button whose command is running ignores a second click at once. Under a
  tenth of a second nothing changes on screen; up to one second it only looks busy; from one second
  it shows a spinner; after three seconds it also says **Still working…** (or the stage, when the
  command reports one). A list or panel that is loading draws its placeholders only if the wait
  passes two tenths of a second, so a quick load shows no flicker.

## Claude Code hooks

Sessions opened outside Flightdeck only show up once the hooks are installed on the host. There
are two ways, and both are opt-in: on the host screen, the **Install hooks** button, which asks
for confirmation, or in the host's terminal:

```sh
flightdeckd hooks install     # writes the Flightdeck entries to ~/.claude/settings.json
flightdeckd hooks status      # installed, absent or out of date
flightdeckd hooks uninstall   # removes only the Flightdeck entries
```

- **What is written:** it is Flightdeck's only write to `~/.claude`.
  - `install` merges the entries with what already exists, without touching other keys or
    third-party hooks.
  - Beforehand, it saves a copy as `settings.json.flightdeck-backup`.
  - Reinstalling replaces the old entries instead of duplicating them.
- **Entries:**
  - `SessionStart` is a command hook:
    `<flightdeckd> hook session-start --url <receiver> --token <token>`. On Windows, Claude Code
    runs command hooks through Git Bash, which treats `\` as an escape. That is why the
    executable path is written with forward slashes (`D:/...`). An old installation with
    backslashes shows up as out of date in `hooks status`: run `hooks install` again.
  - `UserPromptSubmit`, `Notification`, `PermissionRequest`, `PostToolUse`, `PostToolUseFailure`,
    `PermissionDenied`, `Stop` and `SessionEnd` are http hooks to the daemon's receiver, at
    `http://127.0.0.1:<hooks.port>`, with the token header.
- **Config:** `hooks.port` defaults to 7421. `hooks.token` is generated on the first install.
  `hooks.permissionTimeoutS` is 600. `hooks.staleAfterS` is 900; a session with no events and no
  transcript change for that long becomes ended.
- **WSL:** the WSL daemon installs into WSL's `~/.claude` and needs a different `hooks.port` from
  Windows's.
- **Installing from the CLI while the daemon is running:** the daemon only starts receiving the
  hooks after it is restarted (`flightdeckd service stop` and `service start`). When installing
  from the app, the receiver comes up right away.
- **Claude never waits for Flightdeck:**
  - With the daemon down, the hooks fail fast and the session carries on.
  - With no app open, the permission request is answered immediately, empty, and the terminal
    dialog decides.

## Approving terminal sessions from the app

With the app open, the `PermissionRequest` of a terminal session waits for the answer and shows
up in **Needs you**, with a system notification. Meanwhile the terminal dialog stays active.
Whichever comes first wins:

- **Approve or Deny in the app:** allows or denies the tool.
- **Answering in the terminal:** the request leaves the queue at the session's next event.

Nothing is approved without a click.
