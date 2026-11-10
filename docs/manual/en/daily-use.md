# Daily use

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/daily-use.md)

## Needs you, host page and notifications

- **Needs you:** in the sidebar, with the count of open requests across all hosts. The screen
  lists the requests, oldest to newest, and the selected request's card sits next to it: **A**
  approves, **N** denies and **Esc** closes the detail. **Open session** takes you to the
  conversation. The card takes the focus, so A and N work with no click first, and once a
  request is answered the next one is chosen, with how many are left. A high-risk request is
  still approved only by holding the button.
- **Finished:** under the requests, a **Finished** group lists the sessions that ended a turn,
  failed or ended since the last time you looked at Needs you, newest first, each with how it
  finished, how long ago and (once the host answers) how many files it changed. Choose one and
  **See the changes** opens the session on its Changes view. Leaving the screen is the look: the
  group is empty the next time. A session you were watching when it finished is not listed, and
  the group does not add to the sidebar count, which counts requests. The system notification of
  a finished turn or a failure is the one you already had: it is sent once, never while the app has
  focus.
- **Quiet sessions:** a session that is marked as running but has produced nothing for 15 minutes
  (30 while a tool call is still open, since a build can be quiet) is listed under the requests as
  "Quiet for 23 min · last: Bash", on a daemon that announces `stall`. Choose it for **Open**,
  **Stop the turn**, **Send "continue"** and **Not stuck, snooze 1 h** (which keeps that session out
  of the list and off its card for an hour, says when it comes back, and is kept across restarts of the
  app on this computer). It leaves the list at the next sign of life, and a session
  waiting for an approval is never quiet. One system notification is sent when it goes quiet, never
  while the app has focus; the Working card on the Activity board and the card on the project's board
  carry a "Quiet 23 min" badge.
  `stall.afterMinutes` in the daemon config sets the 15 (0 turns it off).
- **From a notification:** clicking it opens the session with the request's card focused: one
  key answers it. In the bell, an entry of a request already answered opens its session at that
  request.
- **Dependencies:** the host page's Overview tab has a **Health & dependencies** section (below) that groups what
  the host needs into **Required** (Claude Code, git with worktrees, the service that starts the
  daemon at boot, at least one allowed folder) and **Optional** (the GitHub, Azure, SSH and
  Tailscale tools, PowerShell on Windows, the Claude Code hooks). Each row has an icon and a word
  (green check OK, amber warning for an optional one missing or outdated, red cross for a required one
  missing, gray dash when it does not apply to the host's system), the version found and the least
  one, what stops working without it, and the command to install it on that host's system with a
  **copy** button. **Check again** asks the host again. The headline says "All set", "N optional
  missing" or "N required missing", and a host with a required one missing shows a red mark in the
  sidebar. `flightdeckd doctor` prints the same grouping in the terminal after its own checks, with the
  fix for the host's system under each one that is missing or outdated.
- **Host page layout:** the page opens on that host's **Sessions** (the ones that need you
  first, then the latest; **See all sessions** opens the Sessions list already filtered by the host, for that visit only: the filter you saved for the next time is not changed)
  and its **Projects** (the same cards as the Projects list; **See all projects** opens that list
  filtered by the host, with a chip that clears the filter). A host with none says so and offers
  **New session**. The rest is on three tabs: **Overview** (sessions, projects, the Claude account
  and the host information), **Usage** (quota and the usage table) and **Settings** (allowed
  folders, hooks, worktrees clean-up, telemetry, terminal, maintenance, reconnect and remove). The tabs answer to the
  arrow keys.
- **Host page:** click the host name to see system, versions, active sessions, heartbeat
  latency, rename, reconnect and remove. A host that passes the API key on to Claude gets a ⚠
  badge. The uptime keeps counting while the page is open.
- **Resources:** a host page panel (hosts that announce `resources`) shows the host's memory and
  disk as bars, its load, and a table of its sessions and terminals with the biggest memory first:
  project, memory, CPU and the programs running (names only; never a command line or an
  environment). Memory or disk at 80% reads **High** and at 90% **Critical**, in words as well as
  colour. **Leftover processes** lists a `claude` that the host's daemon started for a session that is
  over (older than a minute, in that session's folder, started while that session lived), with its
  pid, age and memory; a `claude` the daemon starts for something else (a plugin install, the account
  query, an action) or a live session's process whose folder was moved is never listed; **End** asks first and ends only that
  process (the daemon checks again, right before the signal, that it is the same process, by pid and
  start time, still its own child and still without an owner). A `claude` whose folder cannot be read,
  or that runs in a folder where a live session is, is never listed: which one is whose cannot be told.
  A daemon running as pid 1 (a container) lists none. Ending needs a connection from loopback or
  Tailscale, like the other commands that change the host, and sends SIGTERM to that process only. The
  panel reads every 5 s while the page is open and the host is online, and the daemon keeps no
  timer for it. Per-process numbers come from `/proc`, so only Linux hosts have them; macOS and
  Windows hosts show the memory and disk (and the load, on macOS) and say the processes are not
  measured. A session is matched to its `claude` by folder and start order, so two sessions in one
  folder can swap numbers.
- **Worktrees:** a host page panel (hosts that announce `worktrees`) lists the cards' worktrees
  under `.flightdeck/worktrees` with their size on disk (**unknown** when measuring ran out of
  time, never 0), how long they have been idle, and their card. **Suggested** marks a clean worktree
  with no unpushed commits and no live session, idle for over 7 days, whose card is Done or whose
  PR merged, or that has no card. A worktree with uncommitted changes, commits that exist nowhere
  else, a running session, terminal or run, an unknown base branch (it must be a real branch, not
  a tag or `HEAD`), a branch that is not one of Flightdeck's `fd/…`, ignored files a build does not
  recreate (only `node_modules`, `dist`, `build`, `target`, `coverage`, `.cache`, `.next` and `out`
  as a folder at the root of the worktree do not count, and an ignored credential file such as `.env`
  or `*.pem` always does), edits that git hides from `git status` (`assume-unchanged` or
  `skip-worktree`), or anything git could not answer about is **kept**: the row says why and cannot
  be ticked. The confirmation says the rebuildable folders go with the worktree. Filter by Suggested, Protected or No card, sort by age or size, **Select
  suggested** or **Select all that can go**, then **Remove**: the confirmation names every branch
  with its card and column, and the space it frees. Only the rows on screen can be ticked or
  removed. The host holds each folder (nothing can start in it) and checks it again before removing
  it (without force), so one that changed meanwhile is kept; the branch is deleted only if it is
  still at the commit that was checked, otherwise the folder goes and the branch stays, and the
  result says so. The card, if any, stays on the board without its
  worktree. A disk under 10% free is warned about. Deleting something that is kept still goes through
  the card's **Discard**.
- **A host that is offline** shows a banner at the top of its page: the state, what failed in plain
  words (nothing answered, no answer in time, the link dropped, the token refused), the time of the
  last try, a countdown to the next automatic try and **Reconnect now**, which shows its progress
  and then "Still offline." if it failed. The sections that need the connection say "Host offline"
  instead of "checking…". For a refused connection to a local, WSL or Linux host, the banner lists
  the commands to check the daemon (`systemctl --user status flightdeckd`,
  `sudo loginctl enable-linger $USER`, and `systemd=true` in `/etc/wsl.conf` on WSL). The app also
  tries an offline host at once, and starts the countdown over, when the window regains focus or
  the network comes back (at most once every 2 seconds). When the daemon runs but refuses this
  machine's address (it is outside `allowedNetworks`), `flightdeckd doctor` says so and names the
  address; the app cannot tell that apart from a daemon that is down, so for a host that is not
  on this machine it adds the hint to check `allowedNetworks` (`flightdeckd setup` adds the
  Tailscale networks).
- **Notifications** carry the host name.
- **Closing the window** sends the app to the tray (can be turned off in Settings). **Start with
  Windows** is in Settings, off by default.
- **Single instance:** opening the app again (or a `flightdeck://` link) focuses the existing
  window.

## Tray

The tray icon has Open, the **Needs you (N)** submenu and Quit. The submenu lists up to 10 open
requests, from managed and terminal sessions, oldest to newest, as `host · session · tool: input
summary` (for example `pc · api · Bash: npm test`).

- Each request opens a submenu with **Approve**, **Deny** and **Open**. Approve and Deny answer
  on the request's host, without opening the window; Open brings the app to the session, with
  the approval card.
- Workflow gates appear only with **Open**: they need reading, and the answer is given on the
  card. A high-risk request and a secret request have **Deny** and **Open**: approving them
  takes the window.
- Above 10, the last row is **and N more…**, which opens the app.
- The submenu is rebuilt half a second after the list stops changing.
- **Request notification:** carries the link `flightdeck://request?host=…&request=…`, which opens
  the app focused on the request. In the desktop app, Tauri's notification plugin does not
  report clicks on Windows or Linux: there, the tray is the quick path. Opening the link from
  outside (for example `start flightdeck://request?...`) works.

## Open in terminal

The **Open in terminal** button appears on the session (managed and terminal), on the card (its
worktree) and on each project of the Projects screen. The session is resumed with
`flightdeckd claude --resume <id>`, and the project opens a fresh `claude` in the folder.

| Host | What runs |
| --- | --- |
| This Windows (daemon on `127.0.0.1`) | `wt.exe -d <folder> <flightdeckd> claude --resume <id>`; without Windows Terminal, `cmd.exe /c start "" /d <folder> cmd /k <flightdeckd> claude …` |
| Supervised WSL (Linux daemon on `127.0.0.1` inside a distro) | `wt.exe wsl.exe -d <distro> --cd <folder> -- <flightdeckd> claude …` (without Windows Terminal, through `cmd /c start`) |
| Any other | the button becomes **Copy command**: `cd <folder> && <flightdeckd> claude --resume <id>` |

- `<flightdeckd>` is the stable binary (`~/.flightdeck/bin/flightdeckd`, from the
  [update](host-operations.md#updating-with-flightdeckd-update)) when it exists on the host, otherwise
  `flightdeckd` from the PATH. The daemon reports both, and the WSL distro, in `host.info`.
- The command comes from the app's Rust shell, with the arguments as a list, without going
  through a shell, except for the fallback's `cmd /k`. It only accepts `wt.exe` and `cmd.exe`.

## Palette Ctrl+K

`Ctrl+K` (or "Search the history", in the sidebar) opens a palette with sections in this order:
**Live sessions**, **Cards**, **Projects**, **Hosts**, **Actions** (New session on…, Go to
Settings) and, after Enter, **History**. In the current app the titles of the palette's local
sections and some of its action labels are hard-coded in Portuguese (Sessões ao vivo, Cards,
Projetos, Hosts, Ações, Abrir board, Ir para Configurações, Ir para Custos); the names here are
their English equivalents.

- Local things show up immediately and filter as you type. Enter with nothing selected searches
  the history of all hosts, which arrives later, without erasing the rest.
- **↑/↓** select, **Enter** opens and **Tab** shows the entry's actions (for example, on a
  project: Open board, Workflows, Open in terminal). Esc goes back from the actions to the list
  and, from there, closes.
- **Go to Costs** appears when the app has the Costs screen and some host announces `costs`.
- The row the keyboard is on is a surface with a ring around it, in both themes. A session's row
  shows its state glyph (running, needs you, idle) and follows it as it changes; a card's row
  has the card icon.
- With nothing typed, a **Recent** section comes first with up to six of the entries you opened
  (kept between runs): what waits for you first, then what runs, then the rest. Each shows
  **Alt+1** to **Alt+6**, which open it while the palette is open (outside it, the same keys pick
  the views of a session page).
  The order is fixed when the palette opens, so rows do not move under the cursor.
- The palette opens **narrowed to where you are**: on a board or a card, to its host and project;
  on a session or a host page, to the host. The filters show as chips under the field; click one to
  remove it, or **Clear all filters**. The change lasts only until the palette closes.
- Text that matches no card ends the list with **Create card “text” in project** (the scope's
  project, or the only project there is). Pasting a GitHub issue link or typing `#123` in a
  project with an issue provider offers **Create card from issue** instead, which links the issue.
- Each section shows eight rows, then a button such as **22 more**; each press shows twenty more.
- **Actions** also has **Go to Sessions / Needs you / Projects**, **Show the
  keyboard shortcuts** and, while a request waits for you, **Approve the oldest request** and
  **Deny the oldest request** (a high-risk request is opened to be held, as in the tray). Each
  command shows its keys at the right.

## Keyboard shortcuts

`?` (outside text fields) opens a sheet with every shortcut, by group. The go-to chords press `g`
and then a letter within about a second and a half: `g s` Sessions, `g n` Needs you, `g p`
Projects, `g c` Costs, `g a` Activity, `g ,` Settings. Other shortcuts: `Ctrl+K` palette, `Alt+←`/`Alt+→` back and
forward, `Alt+Shift+C` next client, `Ctrl+T`/`W`/`Tab`/`1…9` tabs, `j`/`k`/`Enter` in lists and
`A`/`N` on a request. None of them fires while you type in a field.

The first `Tab` on any screen shows **Skip to content** at the top left; `Enter` moves the focus past
the title bar and the sidebar to the screen itself (#1430).

## Global shortcut

`Ctrl+Alt+F` brings the app to the front with the global search open, even with it in the
background or in the tray. To change it, open **Settings → Global shortcut**, type the
combination and click **Save shortcut**.

- Format `Modifiers+Key`, for example `Ctrl+Shift+Y`. The key is a letter, a digit or `F1` to
  `F24`, and at least `Ctrl`, `Alt` or `Super` is required.
- `Ctrl+K` is refused: it opens the search inside the app and, as a global shortcut, would
  collide with the browser and VS Code.
- If another program already uses the combination, the app warns and opens Settings for you to
  choose another. The shortcut is only saved after the system accepts it.
