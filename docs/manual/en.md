# Flightdeck Manual

English | [Português (Brasil)](pt-BR.md) · [Back to the README](../../README.md)

Complete Flightdeck reference, organized by topic. It applies to version 0.19.0. The roadmap is
in [`docs/SPEC.md`](../SPEC.md), the deviations from the specs in
[`docs/DECISIONS.md`](../DECISIONS.md) and the interface vocabulary in
[`docs/GLOSSARY.md`](../GLOSSARY.md). Those three documents, `docs/TDD.md` and the phase specs
are written in Portuguese.

## Table of contents

- [Overview](#overview)
- [Installation](#installation)
  - [From the release binaries](#from-the-release-binaries)
  - [From source](#from-source)
- [Hosts and daemon configuration](#hosts-and-daemon-configuration)
  - [The configuration file](#the-configuration-file)
  - [Starting the daemon](#starting-the-daemon)
  - [Connecting the desktop app](#connecting-the-desktop-app)
- [Service](#service)
  - [First run: flightdeckd setup](#first-run-flightdeckd-setup)
  - [Installing as a service](#installing-as-a-service)
  - [WSL from Windows](#wsl-from-windows)
- [Remote access over Tailscale](#remote-access-over-tailscale)
- [Pairing](#pairing)
- [Session hub and Claude Code hooks](#session-hub-and-claude-code-hooks)
  - [What the list shows](#what-the-list-shows)
  - [Claude Code hooks](#claude-code-hooks)
  - [Approving terminal sessions from the app](#approving-terminal-sessions-from-the-app)
- [flightdeckd claude and the channel](#flightdeckd-claude-and-the-channel)
  - [How it works](#how-it-works)
  - [Why the VS Code extension is left out](#why-the-vs-code-extension-is-left-out)
- [Approvals and always allow](#approvals-and-always-allow)
- [Projects](#projects)
- [Board](#board)
  - [Registering a project](#registering-a-project)
  - [Finding projects](#finding-projects)
  - [Card lifecycle](#card-lifecycle)
  - [PR providers](#pr-providers)
  - [Parallel run limit](#parallel-run-limit)
  - [Card dependencies](#card-dependencies)
- [Reviewing changes](#reviewing-changes)
  - [`.worktreeinclude`](#worktreeinclude)
  - [Claude Code statusline](#claude-code-statusline)
- [Run environment](#run-environment)
  - [The run.yaml](#the-runyaml)
  - [Trust](#trust)
  - [Ports](#ports)
  - [Run and Stop](#run-and-stop)
  - [Preview](#preview)
- [Workflows](#workflows)
  - [Declaring](#declaring)
  - [Trusting](#trusting)
  - [Running and following](#running-and-following)
  - [Budget of a run](#budget-of-a-run)
  - [The flightdeckd mcp MCP server](#the-flightdeckd-mcp-mcp-server)
- [History](#history)
  - [What is indexed](#what-is-indexed)
  - [Excluding folders](#excluding-folders)
  - [Rebuilding the index](#rebuilding-the-index)
  - [In the app](#in-the-app)
- [Checkpoints and agent configuration](#checkpoints-and-agent-configuration)
  - [Snapshots](#snapshots)
  - [The timeline](#the-timeline)
  - [Rewinding files](#rewinding-files)
  - [Forking](#forking)
  - [The Agent screen](#the-agent-screen)
- [Issues, automations and arena](#issues-automations-and-arena)
  - [Issues](#issues)
  - [Automations](#automations)
  - [Arena](#arena)
- [Risk-graded approval](#risk-graded-approval)
- [Background sessions](#background-sessions)
- [Session trace and replay](#session-trace-and-replay)
- [Session timing (telemetry)](#session-timing-telemetry)
- [Actions: Claude uses a secret without seeing it](#actions-claude-uses-a-secret-without-seeing-it)
- [Memory, context and plugins](#memory-context-and-plugins)
- [Watching and fixing a PR](#watching-and-fixing-a-pr)
- [Teams and messages between sessions](#teams-and-messages-between-sessions)
  - [Standard session names](#standard-session-names)
  - [Who may message whom](#who-may-message-whom)
  - [Teams](#teams)
- [Costs, budgets and quota](#costs-budgets-and-quota)
  - [The Claude account of a host](#the-claude-account-of-a-host)
  - [Plan quota](#plan-quota)
  - [Quota queue](#quota-queue)
  - [Usage](#usage)
  - [Costs](#costs)
  - [Prices](#prices)
  - [Budgets](#budgets)
  - [Quota history](#quota-history)
  - [Return on cost](#return-on-cost)
- [Clients: grouping work across hosts and projects](#clients-grouping-work-across-hosts-and-projects)
- [Session summary and webhooks](#session-summary-and-webhooks)
- [Notification center](#notification-center)
- [Tabs and embedded terminal](#tabs-and-embedded-terminal)
  - [Tabs](#tabs)
  - [Split view](#split-view)
  - [Embedded terminal](#embedded-terminal)
  - [Claude here](#claude-here)
- [Daily use](#daily-use)
  - [Needs you, host page and notifications](#needs-you-host-page-and-notifications)
  - [Tray](#tray)
  - [Open in terminal](#open-in-terminal)
  - [Palette Ctrl+K](#palette-ctrlk)
  - [Keyboard shortcuts](#keyboard-shortcuts)
  - [Global shortcut](#global-shortcut)
- [Interface](#interface)
  - [Design and navigation](#design-and-navigation)
  - [Demo mode, screenshots and end-to-end tests](#demo-mode-screenshots-and-end-to-end-tests)
  - [Performance](#performance)
- [Host operations](#host-operations)
  - [Versions and compatibility](#versions-and-compatibility)
  - [Updating with flightdeckd update](#updating-with-flightdeckd-update)
  - [Signed automatic update](#signed-automatic-update)
  - [Retention](#retention)
  - [Backup and restore](#backup-and-restore)
- [Deploy](#deploy)
- [Releases](#releases)
- [Development](#development)

UI labels follow the app's English dictionary. One exception: the section titles and some action
labels of the `Ctrl+K` palette are currently hard-coded in Portuguese in the app, and this manual
gives their English names (see [Palette Ctrl+K](#palette-ctrlk)). The daemon's own CLI messages
and `--help` text are in Portuguese too; messages quoted in this manual (for example "already
running") are translations. The manual assumes `flightdeckd` is on your `PATH`; the installed
binary lives in `~/.flightdeck/bin`, which the installer does not add to the `PATH`.

## Overview

Flightdeck is a personal command center for Claude Code. The `flightdeckd` daemon hosts Claude
Code sessions through the official Agent SDK, stores every event in SQLite and exposes a
WebSocket protocol. The desktop app (Tauri 2 + React) connects to one or more daemons, shows the
chat as it streams, approves or denies tools, and gathers the sessions of every host in one
place.

```text
packages/protocol   zod schemas + command and event types (shared)
apps/daemon         flightdeckd (Bun + TypeScript)
apps/desktop        Tauri 2 + React app
scripts/            smoke tests, binary builds and coverage check
```

Each delivered phase has its own spec (`docs/SPEC-fase-<n>.md`); Phase 1 and the roadmap are in
[`docs/SPEC.md`](../SPEC.md). The first ones: Phase 2, multi-host
([`SPEC-fase-2.md`](../SPEC-fase-2.md)); Phase 3, history ([`SPEC-fase-3.md`](../SPEC-fase-3.md));
Phase 4, board ([`SPEC-fase-4.md`](../SPEC-fase-4.md)); Phase 5, session hub
([`SPEC-fase-5.md`](../SPEC-fase-5.md)); Phase 6, workflows ([`SPEC-fase-6.md`](../SPEC-fase-6.md)).

## Installation

### From the release binaries

Each version is published on the [Releases](https://github.com/jnerytech/flightdeck/releases)
page with:

| File | What it is |
| --- | --- |
| `Flightdeck_<version>_x64-setup.exe` | desktop app installer for Windows (NSIS) |
| `Flightdeck_<version>_x64_en-US.msi` | the same app, as an MSI |
| `flightdeckd-windows-x64.exe` | daemon for Windows |
| `flightdeckd-linux-x64` | daemon for Linux and WSL (x64) |
| `flightdeckd-linux-arm64` | daemon for Linux arm64 (Orange Pi, Raspberry Pi) |
| `SHA256SUMS` | the SHA-256 of each file |

The release also carries the signatures (`.sig`) of the NSIS installer and of the daemons, and
the `latest.json` and `daemon-latest.json` manifests used by the
[automatic update](#signed-automatic-update).

1. **Verify the download** before running it:
   - Linux: `sha256sum -c SHA256SUMS --ignore-missing`.
   - Windows (PowerShell): `(Get-FileHash .\<file>).Hash.ToLower()`, and compare it with the
     file's line in `SHA256SUMS`.
2. **App:** run the installer. It has **no Windows code signature (Authenticode)**, so SmartScreen
   shows "Windows protected your PC". With the hash verified, click **More info** and then **Run
   anyway**. (The minisign signature of the updates is a different thing: see
   [Signed automatic update](#signed-automatic-update).)
3. **Daemon:** on each host, with Claude Code installed and logged in:
   - on Linux, `chmod +x` the binary before using it;
   - run `<binary> setup` (on Windows, `.\flightdeckd-windows-x64.exe setup` from the download
     folder, after `Unblock-File` if Windows blocks it; afterwards `flightdeckd` works in a new
     terminal): it copies the binary to `~/.flightdeck/bin`, asks for your project
     folders, installs and **starts** the service and prints the pairing link (see
     [First run: flightdeckd setup](#first-run-flightdeckd-setup)).

### From source

Prerequisites:

- [Bun](https://bun.sh) 1.4 or newer.
- Claude Code (`claude`) installed and logged in on the machine that runs the daemon. The daemon
  uses the host's own subscription and never passes `ANTHROPIC_API_KEY` on to Claude, unless
  `allowApiKey` is on.
- Only for the desktop app: stable Rust and the
  [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/). On Windows that includes
  the MSVC Build Tools and WebView2.

```sh
bun install
```

The desktop app, in development or as an installer:

```sh
cd apps/desktop
bun run tauri dev      # development
bun run tauri build    # installer
```

## Hosts and daemon configuration

A host is a machine that runs a `flightdeckd`. The app connects to as many hosts as you register.

### The configuration file

On first run the daemon creates `~/.flightdeck/config.json` with default values and a random
token. On systems that support it, the file is readable only by its owner.

```json
{
  "hostName": "my-pc",
  "bind": "127.0.0.1",
  "port": 7420,
  "token": "<generated>",
  "dataDir": "~/.flightdeck/data",
  "allowedRoots": ["C:/Users/me/projects", "~/code"],
  "runtime": "claude",
  "defaultPermissionMode": "default",
  "allowApiKey": false
}
```

- **`allowedRoots`** is mandatory in practice: sessions can only be opened in folders inside
  these roots. The path is resolved with realpath, so `..` and symlinks that leave the roots are
  refused. With an empty list no session can be created, and the daemon warns about it at boot.
- `bind` stays at `127.0.0.1`. To listen on another interface, change `bind` explicitly.
- `token` is what the app uses to connect. It never appears in the logs.
- `claudePath` (optional) points to the `claude` executable. In compiled binaries, the daemon
  uses the `claude` on the `PATH`.

The other keys (`allowedNetworks`, `wsl`, `hooks`, `history`, `updates`, `retention`, `backup`,
`quota`, `pricing`, `maxParallelRuns`, `board`) are described in the sections of the features
they belong to.

### Starting the daemon

From source:

```sh
bun run --filter @flightdeck/daemon start
# or, with options:
bun apps/daemon/src/bin.ts start --config ~/.flightdeck/config.json --runtime claude
```

`--runtime fake` starts the daemon with a deterministic runtime, with no network and no quota
spent. It is meant for testing the app.

Single binary:

```sh
bun run build:daemon   # produces dist/flightdeckd-windows-x64.exe, -linux-x64 and -linux-arm64
./dist/flightdeckd-linux-x64 --config ~/.flightdeck/config.json
```

The daemon prints `flightdeckd <version> listening on ws://127.0.0.1:7420/v1/ws (runtime=claude)`.
For it to survive a reboot and a closed SSH session, [install it as a service](#installing-as-a-service).

### Connecting the desktop app

In the app, click **Add host** and paste the pairing link (see [Pairing](#pairing)), or enter a
name, address (`127.0.0.1`, or the configured `bind`), port (`7420`) and token (the `token` value
in the daemon's `config.json`). **Test and add** performs `hello` and `host.info` before saving
and shows the reason when it fails (token refused, host down).

The token is kept in the operating system's credential store (Windows Credential Manager,
Keychain, Secret Service), not in plain text. Then use **+** next to the host to create a
session: a folder inside `allowedRoots`, a name, a permission mode and a first prompt. Tool
requests show up as inline cards with **Approve** and **Deny**. The app reconnects by itself
(from 1 s to 30 s) and resumes each session from the last event it saw.

#### The first host

With no host yet, the app shows four steps instead of the usual screens: install and start the
daemon (`flightdeckd setup`), copy the pairing link it prints, paste it and press **Test and
add**, and then the app opens the host's own page. There you press **Check** in **Check this
host** and add the project folders in **Allowed folders**. **Find my projects** (in **Projects**)
then fills the Board without typing a path.

#### Checking a host

**Check this host** (on the host's page, online hosts with a daemon that announces `doctor.run`)
asks the daemon to check itself: configuration, allowed folders, service, daemon, Claude Code,
hooks, Tailscale and the daemon's version against the app's. Every item is **ok**, **warning** or
**failed**; each one that is not **ok** comes with a plain step to fix it, in the app's language.
The daemon keeps answering while it checks (nothing blocks). The same checks run in a terminal
with `flightdeckd doctor`.
### Trusting a project

A project (a repository) can carry its own configuration: hooks that run commands by themselves,
MCP servers that start programs, settings with allowed tools, a `CLAUDE.md`, agents, skills and
commands. In a session Flightdeck starts, that configuration loads **only in a folder you trusted**.
Folders you were already working in when this arrived (your board projects and the folders of your
earlier sessions) are trusted; a repository you clone later, or a folder you add, starts untrusted.

- In an untrusted folder the session loads your own settings, not the project's, and **neither your
  own MCP servers nor your plugins** (Claude Code is told to use only the MCP server Flightdeck
  gives it). The project's `CLAUDE.md`, agents and skills do not load either. A notice at the top
  of the session says so, with **Review and trust**.
- The project page has **Project configuration**: what the project would load, read without
  running anything (hooks by event and MCP servers with their whole command, in a scrollable block
  with a warning when a command is long or has several lines; programs the settings run, such as
  `apiKeyHelper` and `statusLine`; environment variables that redirect traffic or code, with their
  value, and the names of the others, never their values; plugins; every other settings key
  present; allowed tools; agents, skills and commands, and the ones whose header carries hooks,
  servers or tool grants; `CLAUDE.md`; and files that could not be read), the cost of not
  trusting, and **Trust this project**. It asks first, naming the project and the host, because
  trusted hooks and MCP servers run commands on that computer without asking you. **Revoke trust**
  asks nothing. Trusting covers the folders inside the project, not the ones around it.
- Trusting a folder does not trust a parent: a clone inside it that has its own `.git` is its own
  project, and a folder that holds your allowed roots cannot be trusted at all. Background
  sessions follow the same rule as the sessions in the app.
- A card's worktree always reads its project configuration from the project's main folder, so a
  branch never brings hooks of its own, trusted or not.
- Trusting works only from the host's own computer or over Tailscale (like allowing a folder or sessions without prompts); revoking works from anywhere.
- The decision lives on the host (`project_trust` in its database), per host, and is logged. A
  host that does not announce `projectTrust` loads everything, as before.

### Sessions without permission prompts

By default no session of a host can run in **Bypass permissions** (every tool runs without asking).
To allow it, open the host's page and use **Sessions without permission prompts → Allow sessions
without prompts**; the app asks you to confirm and names the host. The choice is saved in the
host's config (`allowBypassPermissions`) and applies at once. With it on:

- **New session** offers "Bypass permissions: no prompts" in the permission mode list. Picking it
  asks again every time you press Create session, naming the host and the folder.
- The mode list in the message box of an open session offers every mode, including Bypass
  permissions and modes looser than the one the session started with. Switching to Bypass asks
  each time, naming the host and the session.
- Sessions started after the switch is on can be switched to Bypass; one that was already running
  keeps what it started with (the Claude Agent SDK needs to be told at start).

With it off (the default) the daemon refuses to start a session in Bypass, and an open session
can never be made more permissive than the mode it started with. A persona's permission mode
still counts when it is stricter. Turning the switch off asks nothing.

A session in Bypass permissions asks for nothing: Claude Code skips the permission prompt for every
tool, including the ones that otherwise always ask (such as discarding a card through the
flightdeck MCP server). That is the choice you make when you pick that mode.

## Service

### First run: flightdeckd setup

The very first run is the downloaded file itself, because nothing is on your `PATH` yet. On
Windows, open PowerShell in the download folder:

```powershell
Unblock-File .\flightdeckd-windows-x64.exe   # only if Windows blocks the file ("downloaded from the Internet")
.\flightdeckd-windows-x64.exe setup
```

When `setup` ends, open a **new terminal** and type `flightdeckd` from any folder: the copy in
`~/.flightdeck/bin` is called `flightdeckd.exe` (`flightdeckd` elsewhere), and that folder is now
on your `PATH`. After that:

```sh
flightdeckd setup                          # asks, step by step
flightdeckd setup --yes --folders ~/code   # no questions, for scripts (folders separated by commas)
flightdeckd doctor                         # what is missing, with the command that fixes each thing
```

`setup` does, in this order:

1. copies the running binary to `~/.flightdeck/bin`. When one is already there, `setup` asks it
   for its version: an **older** one (or one that does not answer `--version`) is replaced,
   after the service's daemon is stopped, and kept as `flightdeckd.old`; the same version or a
   **newer** one stays and `setup` says so. It always prints which binary and version the
   service will run. It then puts that folder on your `PATH`. On Windows it is added to your **user**
   `Path` (registry `HKCU\Environment`, without duplicates, keeping the other entries) and
   open programs are told, so only terminals opened afterwards see it. On Linux and macOS it
   appends the `export PATH="$HOME/.flightdeck/bin:$PATH"` line to `~/.profile` once (a second
   `setup` adds nothing, and the rest of the file is kept; if it cannot write the file it prints the
   line for you to add). `service uninstall` takes the entry off the Windows `Path` again;
2. asks for the project folders, one per answer, and refuses a folder that does not exist: they
   become `allowedRoots` in the config;
3. when Tailscale is up, asks whether you use Flightdeck from other devices (the default is
   **no**). Yes binds the daemon to the Tailscale address only, never to every interface, and
   lets in only loopback and the Tailscale ranges;
4. offers to install the Claude Code hooks;
5. installs the service **and starts it now**, waiting for `/health`;
6. prints the pairing link and the QR code.

When the input ends (a script without `--yes`), `setup` stops with exit code 1 instead of
looping. `service install` also starts the service now on its own. `doctor` checks the config,
the folders, the service, the daemon's `/health`, `claude`, the hooks and Tailscale, one line
each, and prints the fix of every failure; it exits 1 when a check fails.

### Installing as a service

The daemon survives a reboot and a closed SSH session by running as a service of its own user:

```sh
flightdeckd service install --dry-run   # shows the unit or task, changes nothing
flightdeckd service install [--config <file>]
flightdeckd service status              # state and the config the service uses
flightdeckd service stop                # stops the daemon; the service stays installed
flightdeckd service start               # starts the service and waits for /health
flightdeckd service uninstall           # stops the daemon and removes the service
```

- **Config:** with `--config`, the service runs `start --config <absolute path>`; without it, it
  uses `~/.flightdeck/config.json`.
- **Stopping:** `stop` and `uninstall` follow the same sequence:
  - ask the daemon for `daemon.shutdown`;
  - stop the task or unit;
  - wait for the `dataDir` lock, terminating the process only if it is the service's executable.

  On Windows, `schtasks /End` alone is not enough: it ends `conhost.exe` and leaves the daemon
  running. `start` brings the service up and waits for the `/health` of its config for up to 30 s.

- **Linux (WSL, Orange Pi, VPS):** writes `~/.config/systemd/user/flightdeckd.service`
  (`Restart=always`, `RestartSec=5`) and runs `systemctl --user enable --now flightdeckd`.
  Without *linger*, the service only starts after your login; `install` prints the command
  `sudo loginctl enable-linger $USER` for you to run (it never runs anything with sudo).
  `setup` ends with a **WARNING** block with that command when linger is off (on WSL it also says
  to turn on `systemd=true` in `/etc/wsl.conf`), and `flightdeckd doctor`, and the host's Doctor in
  the app, list "linger" as a failure until it is on.
- **Windows:** creates the scheduled task `Flightdeck\flightdeckd` at the user's logon, without
  elevated privileges and without a visible window (it imports an XML with
  `schtasks /Create /XML`; the console is hidden by `conhost.exe --headless`). The task only has a
  logon trigger, so `install` runs it right away (`schtasks /Run`) and waits for `/health`.
- The service command is the compiled binary; when running from source, it becomes
  `bun run apps/daemon/src/bin.ts start`.
- A service does not inherit the shell's `PATH`: `install` writes the path of `claude` to
  `claude.executablePath` in the config (on Windows it prefers `claude.exe`; a `.cmd` produces a
  warning). `--dry-run` only shows the path that would be written and does not create or change
  the config.
- A service does not load `.bashrc` either: run `claude auth login` on each host instead of
  relying on `CLAUDE_CODE_OAUTH_TOKEN` exported in the shell.
- Two daemons with the same `dataDir` cannot coexist: the second exits with code 3 ("already
  running").

### WSL from Windows

The Windows daemon can keep the daemon of each WSL distro running (and the distro awake):

```json
"wsl": [{ "distro": "Ubuntu", "command": "~/.local/bin/flightdeckd start", "port": 7430 }]
```

Each item becomes `wsl.exe -d <distro> --exec bash -lc "<command>"`, restarted with backoff from
1 s up to 60 s, logging to `dataDir/logs/wsl-<distro>.log`. The WSL daemon listens on
`127.0.0.1:7430`, which Windows reaches through `localhost`. If that daemon also receives hooks,
its `hooks.port` must differ from Windows's (see [Claude Code hooks](#claude-code-hooks)).

**Setting up the WSL daemon.** Run `flightdeckd setup` inside the distro. WSL shares `localhost`
with Windows, so setup detects WSL (`WSL_DISTRO_NAME`, or `/proc/version`) and moves the ports
that are still at the Windows daemon's defaults up by 10: `port` 7430, `hooks.port` 7431 and
`telemetry.port` 7432 (Windows keeps 7420, 7421 and 7422). They are written to `config.json`, so
nobody edits it by hand; a port you set yourself stays, and running setup again changes nothing.
A new config in WSL also names the host "<hostname> (WSL <distro>)", so the two daemons are easy
to tell apart in the app.

## Remote access over Tailscale

By default only loopback connections are accepted (`allowedNetworks`:
`["127.0.0.0/8", "::1/128"]`); any other origin gets HTTP 403 before the WebSocket, on every
route. To use the tailnet, set `bind` to the tailnet IP (or `0.0.0.0`) and allow the Tailscale
ranges:

```json
"bind": "0.0.0.0",
"allowedNetworks": ["127.0.0.0/8", "::1/128", "100.64.0.0/10", "fd7a:115c:a1e0::/48"]
```

There is no TLS of its own: Tailscale's WireGuard tunnel encrypts the traffic. **Exposing the
port on the open internet is not supported.**

## Pairing

```sh
flightdeckd pair            # prints flightdeck://<ip>:<port>?name=…&token=… and the QR code
flightdeckd pair --rotate   # generates a new token; the running daemon drops whoever used the old one
```

The address is what the daemon listens on: `bind`, or the Tailscale IP (`tailscale ip -4`) when
the daemon listens on every interface. A daemon on the loopback gets a `127.0.0.1` link plus a
hint on how to open it to Tailscale, because a link with the Tailscale IP would not connect. In the
app, paste the link into **Add host** or open it directly (`flightdeck://` is registered with the
system); the app fills in the form, tests the connection with `hello` and `host.info`, and only
saves after you confirm.

## Session hub and Claude Code hooks

The **Sessions** screen is the app's main one: every Claude Code session of the online hosts in
one place, grouped by project and ordered by last activity.

### What the list shows

| Origin | Where it comes from |
| --- | --- |
| Flightdeck | sessions the daemon itself runs (`session.list`) |
| terminal | sessions opened outside Flightdeck, in the terminal or in VS Code's integrated terminal, seen through the Claude Code hooks (`external.list`) |
| history | transcripts indexed from `~/.claude/projects` (`history.list`) |

A session appears only once. The order of preference is managed, then terminal, then history.

- **Group:** the project. What counts is the `remote.origin.url` of the repository of the
  session's folder, normalized, so SSH and HTTPS of the same repository land together. Worktrees
  count as the main repository. Without a remote, the repository root counts; without a
  repository, the folder.
- **Row:** shows host, origin, state (running, needs you, idle, ended), the "controllable" badge
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

### The message box

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
  Under the card a status line shows the model and the permission mode, each a picker when the
  session lets you change it, and a spinner while a turn runs. While a turn runs a line above the
  box says what is happening ("Running a command", "Editing files", "Waiting for you") and for how
  long; the spinner stops moving if your system asks for reduced motion.

### Claude Code hooks

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

### Approving terminal sessions from the app

With the app open, the `PermissionRequest` of a terminal session waits for the answer and shows
up in **Needs you**, with a system notification. Meanwhile the terminal dialog stays active.
Whichever comes first wins:

- **Approve or Deny in the app:** allows or denies the tool.
- **Answering in the terminal:** the request leaves the queue at the session's next event.

Nothing is approved without a click.

## flightdeckd claude and the channel

### How it works

```sh
flightdeckd claude [claude arguments]
# suggestion: alias fd="flightdeckd claude"
```

`flightdeckd claude` (suggested alias `fd`) opens the real `claude` in the same terminal, with
the same arguments and the same exit code, and adds the Flightdeck channel. The channel is an
MCP server (`flightdeckd channel`) that lets the app send messages to that session as if you
had typed them.

- **Arguments:** the wrapper adds `--mcp-config` (a temporary file) and
  `--dangerously-load-development-channels server:flightdeck`, and sets `FLIGHTDECK_LAUNCH_ID`.
  The project's `.mcp.json` is not touched.
- **Config:** since all the arguments belong to `claude`, the daemon config comes from
  `FLIGHTDECK_CONFIG`, or from the default path.
- **No `claude` on the PATH** (nor in `claude.executablePath`): it warns and exits.
- **No daemon:** it warns and opens `claude` anyway, without the channel.
- **With `-p` or `--print`:** it opens plain `claude`, with no channel and no warning. Print mode
  ignores the development channel.
- **Research preview:** the channel is a preview feature of Claude Code. Each launch shows a
  development-channel warning, which has to be accepted.
- **Known warning:** at launch, Claude Code shows
  `server:flightdeck · no MCP server configured with that name`, even though the channel works.
  The warning is evaluated before the `--mcp-config` servers and can be ignored.

| | plain `claude` | `flightdeckd claude` |
| --- | --- | --- |
| shows in the list, with live state | yes (with hooks) | yes (with hooks) |
| approve and deny from the app | yes | yes |
| live transcript | yes | yes |
| send a message from the app | no | yes ("controllable" badge) |

### Why the VS Code extension is left out

The Claude Code extension for VS Code and the Claude Desktop app run `claude` in SDK mode, which
ignores the development channel. In the proof of concept, the channel came up as an MCP server
inside the extension, but no message ever arrived. VS Code's integrated terminal is an ordinary
terminal: there, `flightdeckd claude` works.

## Approvals and always allow

Besides Approve and Deny, an approval, whether from a managed or a terminal session, offers:

- **Allow for this session:** shown when Claude Code suggests permissions with the `session`
  destination, which only apply to that session.
- **Always in this project:** opens the rule for editing before sending it.
  - For Bash, the default is the exact command, which you can replace with a prefix such as
    `npm test:*`.
  - For other tools, the default is the tool name.
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

## Projects

The **Projects** item of the sidebar (between Needs you and Board) lists every project of every
host as a card: its name, host, base branch, the live sessions, the cards in progress, the ones
that need you, the last activity and what it cost over the last seven days. The cost is a dash
when the host does not report costs. Type in the search box to narrow the list by name, host,
branch or folder, and use **Sort by** to order it by last activity, name, cost this week or what
needs attention first.

Click a card to open the project's page. It links the project's **Board**, **Sessions**,
**Workflows**, **Costs** (when the host reports costs) and **Settings** (the host's project
settings, where the folder, base branch, setup and personas are edited).

### Sessions side by side

When the project has sessions that Flightdeck started, the page shows them as **tiles**. The
**Layout** control above them is a row of icons that draw the grid: 2 side by side, 3 columns, a
2×2 grid, a 2×3 grid, and **Auto** (the default), which shows every live session. Hover an icon for
its name; the choice is kept. When the layout holds fewer tiles than there are live sessions, the
page says how many are left out ("+2 not shown"). The sessions that need you come
first, then the running ones, then the idle ones. Each tile has the session's name (a button that
opens it), its status, its **last lines**, the **request** it is waiting on (with **Allow** and
**Deny**) and a small message box: **Enter** sends, **Ctrl+Enter** adds a new line, and the send
icon shows when there is text. From the keyboard, Tab reaches each tile, and **Alt+arrow keys**
move between them (left and right by one, up and down by a row). The tiles follow their sessions
live; the list is the project's, so a session of another project never shows here.

### The sidebar, the tab strip and Settings

- The sidebar keeps **Sessions**, **Needs you**, **Projects** and **Board** on top; the rest is in
  three folding groups: **Work** (Workflows, Costs, Conversations, Teams), **Library** (Personas,
  Snippets, Plugins, Vault) and **Infra** (Connections, History). A group with nothing to offer is
  not drawn, the folded groups are remembered, and the narrow icon rail has no headings.
- With one area, the tab strip sits in the top bar on the breadcrumb's row; with a split, each
  area has its own strip. The strip keeps three tools: the active tab's **Actions** menu (move left
  or right, move to the other area, pin), **New tab** and **Split**.
- **Settings** has a rail of its sections (it takes you to a section and puts the focus there) and
  a search box: typing keeps the sections whose name or settings match.
- **Costs** shows four tiles above the charts: the estimated cost, the tokens, the cache savings and
  the top model with what it cost.

## Board

Each project (a git repository on the host) has a board with five columns: Backlog, In progress,
Needs you, In review and Done. A card becomes a branch `fd/<slug>`, a worktree and a session; the
card moves by itself according to the session and the PR, and it can also be dragged by hand.

### Choosing a folder

**New session** and the project form have a **Browse…** button next to the folder. It opens a
dialog that lists the folders **of the host** (which may be another machine), one level at a
time:

- it starts at the host's `allowedRoots` and only ever shows folders inside them: no files,
  no hidden folders unless you tick **Show hidden folders**, at most 500 per folder;
- a breadcrumb names every step, **↑** goes up, the arrow keys move through the list, **Enter**
  opens a folder and **Backspace** goes up;
- **Choose this folder** hands its path to the form. It is disabled, with the reason beside it,
  until you open a folder;
- when the host is this machine, **Choose with the system dialog** opens the operating system's
  folder dialog too. What it picks is checked by the host against its `allowedRoots`, like
  everything else, and a folder outside them is refused with the folders that are allowed.

Typing the path stays possible. The host command behind it is `fs.dirs`; a symlink that leads
outside `allowedRoots` is neither listed nor followed.

### Registering a project

In the app, the ▦ button next to the host opens **Projects of &lt;host&gt;**. Each project
records:

- **Repository path:** must be a git repository inside `allowedRoots`. **Browse…** opens the
  [folder picker](#choosing-a-folder).
- **Name** and **base branch:** when left blank, they become the folder name and the
  repository's current branch.
- **PR provider:** `github`, `azure-devops` or none.
- **Setup script** (optional, for example `bun install`): runs in the worktree before the
  session, with `cmd.exe` on Windows and `sh` elsewhere. It is the only shell command Flightdeck
  runs on its own, and it only exists if you register one. If it fails, the card goes to Needs
  you with the error output.
- **Instructions template:** appended to every card's prompt. The default asks to work only in
  the worktree and to commit with descriptive messages.

When a card starts, the daemon runs `git worktree add <repo>/.flightdeck/worktrees/<slug> -b
fd/<slug> <base>` and appends `.flightdeck/worktrees/` to the repository's `.git/info/exclude`
(`.gitignore` is not touched). The session's prompt is the card's description plus the template.

### Finding projects

**Find my projects** (on the **Projects** screen, for hosts that announce `projects.scan` and
`projects.clone`) has two parts:

- **Scan allowed folders** looks for git repositories under the allowed folders, two levels deep
  by default, up to 200 repositories. It skips hidden folders, `node_modules`, links and the inside
  of a repository it already found, and never opens more than 2000 folders. Repositories that are
  already projects are left out. Tick the ones you want and press **Add selected**.
- **Clone from an address** runs `git clone` into a folder inside the allowed folders and
  registers the result as a project. Only `https://`, `ssh://` and `user@host:path` addresses are
  accepted; an address that starts with a dash, has spaces, points to a local path or uses
  `file://` or a transport helper is refused, and so is a folder name that is not a plain name or
  a folder that already exists. git runs with password prompts off and stops after five minutes,
  so a private repository needs an SSH key or a credential helper already set up on the host.
  Every refusal says why.


### Starting from GitHub

For hosts that announce `github` there are two places:

- **Hosts, GitHub panel.** **Sign in with GitHub** asks the host's `gh` to start GitHub's device
  flow. The panel shows a one-time code: press **Open GitHub**, type the code on that page and
  confirm. The panel notices by itself and shows **Signed in as <account>**, where the login is
  kept (the system keyring, `gh`'s own file, or an environment variable of the daemon) and the
  permissions (`repo`, `read:project`). Flightdeck never sees your token: `gh` keeps it. **Sign
  out** asks `gh` to forget it; a login that comes from `GH_TOKEN` or `GITHUB_TOKEN` is managed by
  the daemon's environment and cannot be signed out here. If `gh` is not installed on the host the
  panel says so; install it and press **Check again**.
- **Projects, Start from GitHub.** Lists your repositories (or search them), then pick one and,
  if you like, one of its open issues. Choose the allowed folder to clone into and whether to open
  **A board card** or **A session**. The host clones the repository into that folder (or reuses the
  clone already there), registers it as a project, and then:
  - **a card** takes the issue's title, body and link (once per issue); an issue written by
    someone outside the repository's people is marked as third-party content and gets no
    automatic approval;
  - **a session** opens in the clone with the issue quoted in its first prompt, under the same
    mark when it comes from outside.
  Without an issue, only the repository is cloned and registered. A folder with that name that is
  another repository is refused, and every refusal says why.

To try it: on the host's page press **Sign in with GitHub**, confirm on GitHub, then on **Projects** press
**Start from GitHub**, pick a repository, press **Start**.


### Board sync with GitHub Projects

For hosts that announce `boardsync` (it needs the host's `gh` signed in, see **Starting from GitHub**), the **Sync**
button on a project's **Board** links the project to a GitHub Projects (v2) board:

- **Link board.** Pick one of your boards and press **Link board**. Its items become cards (an issue keeps its
  link and, when a stranger wrote it, the third-party mark with no automatic approval); the **Status** of each item puts
  the card in a column. After that the host reads the board every minute, and **Sync now** does it at once.
- **Status mapping.** Each status of the board has a column here: by default Todo and Backlog to Backlog, In Progress to
  In progress, In review to In review, Done to Done. Change a column and press **Save mapping**; a status set to *Not
  mapped* leaves cards where they are. *Needs you* has no GitHub counterpart, so cards that go there are not sent.
- **Read only by default.** Moving a card here changes nothing on the board until you turn on **Push my card moves to the
  board**. Turning it on asks to confirm and needs the `project` permission; if the login does not have it, the message
  says so and nothing is sent. Push only changes the Status of items that already are cards: it never creates, edits or
  deletes an item.
- **Conflicts.** If a card moved here and the item changed there since the last sync, the newest change wins. A tie within
  two seconds goes to the board when push is off and to this side when push is on. The value that lost is never dropped:
  the card's **Sync log** shows it, with both times. A card that is running is not moved by the board (the log says so).
- **On a card.** **Open on the board** opens the item; *No longer on the board* appears when it was archived or removed
  (the card stays); the **Sync log** lists conflicts, skipped moves and pushes that failed.
- **Unlink** stops the sync and keeps the cards, with their links.

To try it: sign in with GitHub on the host's page, open a project's **Board**, press **Sync**, pick a board, **Link board**.

### Card lifecycle

- **In review:** the card enters when a turn ends well. A turn that errors, is interrupted by
  Stop, or a permission request, sends it to Needs you.
- **Completion:** Complete (with confirmation) or a merged PR removes the worktree if
  `git status` is clean. Otherwise the card warns and the worktree stays.
- **Discard:** Discard (with confirmation, and a warning if there are unpushed changes) removes
  the worktree and the local branch.
- **Edit and delete:** the card's **⋯** menu has **Edit…**, which opens the card with its title ready
  to change (the card page also edits the description and, with ROI on, the estimate), and
  **Delete…**, which names the card and asks first. Delete is only for a card that never started
  (no worktree, branch or session). For one that did, the dialog says why and offers **Discard card**
  instead. The cards that waited for a deleted card are freed of it, with a notice.

### PR providers

Open PR runs `git push -u origin fd/<slug>` and then calls the provider's CLI, with the card's
title and description:

- **GitHub:** `gh pr create --base <base> --head fd/<slug>`. State and checks come from `gh pr
  view --json state,statusCheckRollup`.
- **Azure DevOps:** `az repos pr create --source-branch fd/<slug> --target-branch <base>`. State
  comes from `az repos pr show`, and the policy checks from `az repos pr policy list`.

The CLI must be installed and authenticated on the daemon's host (`gh auth login`, `az login`
with the `azure-devops` extension). The daemon only invokes it, looking it up on the PATH. The
merge stays with the provider. Cards with an open PR are polled every 60 s, or every
`board.prPollIntervalMs` from the config. A merged PR moves the card to Done; closed without a
merge, to Needs you.

### Parallel run limit

`maxParallelRuns` (default 2) limits how many of the host's cards run at the same time, so
parallel agents do not exhaust the subscription's quota. Cards started beyond the limit stay in
In progress with the "queued" badge, in order of start. They start when a run finishes, is
interrupted or goes idle.

- Sessions opened outside the board do not count toward the limit.
- The limit lives in the daemon config and can be changed on the Projects screen, which writes it
  back to `config.json`:

```json
{ "maxParallelRuns": 2, "board": { "prPollIntervalMs": 60000 } }
```

### Card dependencies

A card can be **blocked by** other cards of the same project, so an order you keep in your head is
on the board. Open the card, then **Blocked by**:

- **Add a blocker** picks from the project's cards; a card that would close a cycle (it already
  waits, directly or down the chain, for this one) is not offered, and the daemon refuses it too.
  A card has at most 20 blockers.
- A blocker is satisfied when its card is in **Done** (a merged PR moves it there, so does
  Complete), or, if you choose "merged", when its PR is merged. The choice is per blocked card.
- The board shows **Blocked · N** on a card that still waits (hover for the titles), **Blocking N**
  on a card that holds others up, and **Unblocked** on a card whose last blocker just finished.
  The **Blocked** toggle in the board's filters keeps only the cards that wait. The detail lists the
  blockers with their column and PR state, and the chain behind them to three levels ("and 2 more").
- **Start** on a blocked card is refused with a sentence that names the blockers. Nothing starts a
  blocked card: not Start, not the arena, not Claude's `flightdeckd mcp` tool. Moving a card by hand
  is not blocked: it moves a pin and starts nothing, and it is how you override the plan. A PR fix run
  (phase 22) is never held back, since its PR exists already.
- With **Start by itself when unblocked**, the card starts when its last blocker is satisfied,
  through the normal queue (slots, quota and budgets still apply), with the workflow you chose
  there, if any. Without it the card gets the **Unblocked** mark and the desktop notifies you; the
  mark goes when you start the card or dismiss it. A card starts by itself once, also after a
  daemon restart.
- A blocker that is **discarded** leaves the list at once, with a notice on the card, and the card
  is unblocked: it is never held by a card that is gone.
- A card that waited for blockers starts from the base branch **as it is after they merged**: the
  daemon runs `git fetch origin <base>` and starts the worktree from `origin/<base>` when the local
  base is behind it (a PR merged on the remote), and from the local base otherwise (a local merge
  already moved it). It never moves your local base branch. If the fetch fails, the card says so and
  the run starts from the local base.

Dependencies are inside one project: across projects the link would be a reminder, not a build order,
because a session builds on the merged branch of its blocker.

## Reviewing changes

Every session (managed or from the terminal) and every card has a **Changes** tab, next to the
conversation. It is where you check what the agent did and send it back what to fix.

- **What it shows:**
  - for a session whose folder is in a git repository, the working tree against `HEAD`, with the
    untracked files;
  - for a card, the diff against its base, with how many commits it is ahead of and behind it;
  - the files with their status and counts, and the diff unified or side by side, with numbered
    lines. A binary file is listed without a diff;
  - it follows the disk live (the host watches the folder, with a 500 ms debounce), and
    **Refresh** reads it again.
- **Inline comments:**
  - click a line number to comment on it, and shift+click another to extend the range. A removed
    line is commented on its old side;
  - comments stay as drafts, which you can edit or remove, until **Send review**;
  - the review goes to the managed session, to the card's session or to the channel of a terminal
    session started with `flightdeckd claude`. A session that takes no messages gets the text
    copied instead, and the comments count as sent;
  - a comment follows the quoted lines when the file changes, and shows **Outdated** when they are
    gone. Sent comments stay in the list as history.
- **Revert and edit:**
  - **Revert** asks for confirmation, goes back to `HEAD` (or the card's base; a new file is
    removed), keeps a copy in `<dataDir>/review-trash/` for 7 days and offers **Undo** for 30
    seconds;
  - **Edit** opens a plain text editor (text files up to 1 MB). It saves only if the file is as it
    was when opened; if it changed on disk, you can reload the disk's text or overwrite it with
    yours;
  - both work only in the folders of `allowedRoots`; anywhere else the host only reads.
- **Sessions that touched a file:** each file lists the sessions that wrote it, from the
  transcripts (`Write`, `Edit`, `MultiEdit` and `NotebookEdit`; changes made by `Bash` do not
  count).
- **Card against its base:**
  - **Update from the base** rebases the card's branch. On a conflict it aborts, leaves the
    worktree as it was and lists the files;
  - **Merge and archive**, for a card without a PR: `merge --no-ff` (the default) or `squash`. If
    the base is checked out in some worktree (usually `main` in the main repository), the merge
    happens there, and only if that worktree is clean; otherwise it goes through a temporary
    worktree. A conflict refuses and changes nothing. After the merge, the card's worktree and
    branch go away and the card moves to Done.
- **PR comments:** for a card with a PR, the review comments are read from GitHub (`gh api`) or
  Azure DevOps (`az devops invoke`) with each poll of the PR, and listed with file, line, author
  and resolved state. On GitHub, an author who is not the owner, a member or a collaborator gets
  the **External author** badge: treat the text as untrusted. Azure DevOps has no such field, so
  nothing is marked there. The open comments come selected; **Send to the agent** hands the
  chosen ones to the card's session. Nothing is ever posted back to the provider.

The host announces `review` in `host.info`; an older host has no Changes tab.

### `.worktreeinclude`

A new worktree gets the repository's tracked files, but not the ignored ones, such as `.env`. To
take them to the card, create `.worktreeinclude` at the root of the repository, with patterns in
the `.gitignore` format:

```gitignore
.env
.env.local
config/*.secret.json
```

- **What is copied:** from the main repository, the files **ignored by git** that match the
  patterns, up to 50 MB in total. Above that, the card says how many were left out.
- **What is never copied:** anything under `.git/` or `.flightdeck/`.
- **Built-in pattern:** `.claude/settings.local.json`, the project rules from phase 7, is always
  included.
- The project form in the app warns when the repository has no `.worktreeinclude`, with an example.

### Claude Code statusline

`flightdeckd statusline` prints a line like `5h 35% · 7d 27% · today $4.20 · session $0.84`: the
plan quota, the estimated cost of the day and the cost of the session. It reads the JSON that
Claude Code passes on stdin and asks the local daemon, with a deadline of 300 ms. With the daemon
down or slow, it prints an empty line and exits with 0.

Flightdeck **never writes** the statusline configuration. To use the command, put it yourself in
`~/.claude/settings.json`:

```json
{ "statusLine": { "type": "command", "command": "flightdeckd statusline" } }
```

To add it to a statusline you already have, call both in a script and join the lines. The stdin
goes to both:

```bash
#!/usr/bin/env bash
input=$(cat)
mine=$(printf '%s' "$input" | ~/.claude/my-statusline.sh)
fd=$(printf '%s' "$input" | flightdeckd statusline)
printf '%s%s\n' "$mine" "${fd:+ · $fd}"
```

The command uses the daemon's config (`~/.flightdeck/config.json`, or `--config <file>`) and never
creates it.

## Run environment

With several worktrees at once, running the app of two cards breaks on the ports. The run
environment gives each card **scripts** to prepare and run it, **a block of ports of its own** and
a **preview** of the running app. It completes the `.worktreeinclude` (which brings the files in)
with the half that runs. It needs a host with the terminals on (see
[Tabs and embedded terminal](#tabs-and-embedded-terminal)), since each process opens in a tab.

### The run.yaml

A project declares it in `.flightdeck/run.yaml`, committed on the base branch (the file in a
card's worktree is never read: an agent could write it).

```yaml
setup: ["bun", "install"]
run:
  - name: web
    cmd: ["bun", "run", "dev", "--port", "{{port.web}}"]
    ready: { http: "http://127.0.0.1:{{port.web}}/" }
  - name: api
    cmd: ["bun", "run", "api"]
    env: { PORT: "{{port.api}}" }
ports: [web, api]
exclusive: false
```

- Commands are **lists** (argv), never a text for a shell: a plain text is an error. They run in
  the card's worktree.
- `setup` runs once per card, before the first Run. `run` lists the processes.
- `ports` names the ports of the card's block, in order. `{{port.<name>}}` becomes the port in a
  command, a variable or the ready address, and `FLIGHTDECK_PORT_<NAME>` (upper case, `-` as `_`) is
  in every process's environment.
- `ready.http` is the address that tells the app the process answers. It must be http(s) on
  `127.0.0.1` or `localhost`, with no user or password.
- `exclusive: true` is the **non-concurrent mode** of the project: one card runs at a time, and a
  second Run is refused until the first stops.

### Trust

Nothing the file declares runs before you trust it. The card's **Run environment** panel lists the
commands; **Trust this run.yaml** asks, and trusts that exact content (its hash). When the file
changes on the base branch the trust is gone until you review it again. A file with errors shows
them and offers neither Trust nor Run.

### Ports

Each card holds a block of 10 free ports starting at `run.portBase` of the daemon's config (41000
by default; between 1024 and 65526). Blocks are taken in turn, never two cards in one, and a block
with a port in use on the machine is skipped. The block is the card's until it is done, even
between Runs, and survives a restart of the daemon.

### Run and Stop

On a card with a worktree, **Run** runs the setup (if it did not run yet) and then each process,
each in a terminal tab of the host. The panel shows the state (setup, running, ended, failed), the
ports, and for each process its state and **View log**, which opens its tab. A failed setup shows
its exit code and Run tries it again. **Stop** ends the whole tree of each process, including
children that ignore signals (the process group on Linux, `taskkill /T` on Windows). A card that
reaches done stops by itself and gives its ports back.

### Preview

When a process's `ready.http` answers (any HTTP answer counts, even a 404) its row gets **Open
preview**, which opens a **Preview** tab with the app in a frame. The preview only opens
`127.0.0.1` and `localhost` (the address is checked in the daemon, in the app and by the app's
CSP, whose `frame-src` allows only those), is not kept between starts, and **Open in browser**
sends the same address to the system browser. If the process does not answer in a minute the row
says so.

## Workflows

A card can run a workflow instead of a single session: a sequence of steps (agents, checks,
approvals by you), with a budget, followed and approved from the app.

### Declaring

Workflows are `.flightdeck/workflows/<name>.yaml` files, versioned in the repository itself. The
daemon always reads them from the project's base branch (`git show <base>:<path>`). A workflow
written by the agent on the card's branch is never used.

```yaml
name: feature
inputs: [task]
budget: { maxTurns: 80, maxMinutes: 120, maxCostUsd: 15 }
steps:
  - id: plan
    agent: { prompt: "Plan: {{inputs.task}}", permissionMode: plan }
  - id: approve-plan
    gate: { message: "Approve the plan?", show: "{{steps.plan.output}}" }
  - id: implement
    agent: { prompt: "Implement this plan and make commits:\n{{steps.plan.output}}" }
  - id: tests
    loop:
      max: 3
      until: { check: "bun test" }
      do:
        agent: { continue: implement, prompt: "The tests failed:\n{{loop.lastCheck.output}}" }
  - id: review
    parallel:
      - agent: { persona: seguranca, prompt: "Review the diff with a focus on security." }
      - agent: { persona: revisor, prompt: "Review the diff with a focus on readability." }
  - id: pr
    pr: {}
```

| Step | What it does |
| --- | --- |
| `agent` | Opens a session in the card's worktree. With `continue: <id>`, sends the message to that step's session. With `persona: <id>`, the session opens in that persona. The output is the assistant's text in the turn. |
| `check` | Runs the command in the worktree. Keeps the exit code and the last 8 KB of output. If the command fails, the run fails. |
| `gate` | Pauses until you approve or reject, with an optional note. The note is the gate's output. |
| `loop` | Runs the `check` of `until`. While it fails, runs the `do` (at most `max` times). When `max` is exhausted, the run pauses. |
| `parallel` | Runs the items at the same time, within `maxParallelRuns`. The outputs arrive in `outputs`, in the declared order. |
| `pr` | Pushes and opens the PR through the project's provider. |

Interpolation accepts only `{{inputs.*}}`, `{{steps.<id>.output}}` (`outputs` in a `parallel`)
and `{{loop.lastCheck.output|exitCode}}`, the latter inside a loop's `do`. An unknown reference,
an unknown field, a step without an `id`, or a `continue` pointing to a step that is not an
earlier `agent` are validation errors. An interpolated value larger than 8 KB is truncated.

### Trusting

`check` steps run shell commands: `cmd.exe /d /s /c` on Windows and `sh -c` elsewhere, like the
setup script. That is why every workflow must be trusted before its first run. On the Projects
screen, **Workflows of &lt;project&gt;** lists the base branch's workflows with their validation
and their `check` commands. **Trust** shows those commands and asks for confirmation.

- **What is stored:** trust stores the file's hash (sha256).
- **If the file changes on the base:** the hash changes, and the workflow asks for trust again.
- **Before each check:** the daemon verifies that the command is literally in the run's workflow
  and that this content is still trusted. Any other command is refused before reaching the shell.

### Running and following

In the card detail, pick the workflow (or **None (plain card)**), fill in the `inputs` and click
Start.

- **Timeline:** the detail shows each step with its status, attempt, duration and, for an
  `agent`, the turns and estimated cost. Clicking opens the step's conversation or the `check`
  output.
- **Open gate:** moves the card to Needs you and frees the host's slot. It shows on the card
  itself and in **Needs you**, with Approve, Reject and a note.
  - Once approved, the run goes back to the host's queue and carries on.
  - Rejected, it ends as `rejected`.
- **`pr` step:** moves the card to In review. The merge moves it to Done and closes the steps'
  sessions.
- **Daemon restart:** the run resumes where it stopped.
  - An agent in the middle of a turn resumes the session and resends the prompt, preceded by "The
    run was interrupted; continue where you left off."
  - A check runs again.
  - A gate stays open.

### Budget of a run

`budget` limits the whole run, summing all its sessions:

- **Turns:** counted across all sessions.
- **Minutes:** the wall-clock time of the turns.
- **Cost:** what the SDK reports (`total_cost_usd`). On a subscription, it is a useful estimate
  as a ceiling.
  - The value is cumulative per session: the last total of each session is what counts.
  - A resumed session counts only the difference.

The budget is checked before each turn. When exceeded, the run pauses in Needs you with the
reason. A paused run does not continue: start the card again. The meter in the card detail shows
turns, minutes and estimated cost. (Not to be confused with the host and project
[budgets in US$](#budgets).)

### The flightdeckd mcp MCP server

`flightdeckd mcp [--config <file>]` is a stdio MCP server for the Claude Code on the same host.
It reads the daemon's config and connects to the local daemon over the protocol, with the
config's token. That lets a Claude session create cards and trigger workflows. Tools:

- `list_projects` and `list_workflows`;
- `create_card` and `start_card` (with `workflow` and `inputs`);
- `get_card` and `get_run`;
- `move_card` (to `backlog`, `in_progress`, `waiting`, `review` or `done`, by the same rules as
  dragging a card in the app), `update_card` (title, description), `comment_card` (appends a
  dated note to the description) and `finish_card` (`done` completes the card, `discard` throws
  it away with its worktree and branch).

A session manages only the cards of **its own project**, and its own card when it names none (the
session runs in a card's worktree); another project's card is refused with the reason. The board
in the app updates live. `finish_card` with `discard` is irreversible, so it always asks for your
approval in the session: the automatic approval never takes it, and no "always allow" is offered
for it.

There is no tool to approve permissions or to answer gates: that stays with you, in the app. To
register it in Claude Code:

```sh
claude mcp add flightdeck -- flightdeckd mcp
```

Sessions that Flightdeck starts itself (a team's coordinator and workers, board cards and plain
sessions) get this server with no setup: the daemon adds it to the session, next to your own MCP
servers. You only need the command above for a `claude` you open in a terminal outside Flightdeck.
The Doctor's "Team tools" line tells you when the daemon's program is no longer where sessions
expect it.

## History

Each host's daemon indexes that host's Claude Code transcripts, including the sessions that were
born outside Flightdeck (terminal, VS Code, Desktop). Transcripts are only read: nothing is
edited, deleted or copied between hosts. The only write to `~/.claude` is the hooks', by explicit
command (see [Claude Code hooks](#claude-code-hooks)).

### What is indexed

- Each `<id>.jsonl` file in `~/.claude/projects/<folder>/` is a session; the id is the
  `claudeSessionId`. The project folder comes from the lines' `cwd` field.
- The search covers the text of user and assistant messages, plus one `[tool Name]` line per tool
  call. Tool results are not included, and each message is cut at 8 KB.
- The format is internal to Claude Code. Unknown line types are stored raw and left out of the
  search; lines that are not JSON are counted as errors and skipped.
- Reading is incremental (only what was appended), by file watching and by a sweep every 10 s. A
  file that shrank is read again from scratch.
- The search uses SQLite's FTS5; without it, the daemon falls back to `LIKE` and logs the
  decision at boot.
- A session is marked **possibly in use** when its file changed in the last 2 minutes.

The roots live in `history.roots` in the config, defaulting to `["~/.claude/projects"]`:

```json
{
  "history": {
    "roots": ["~/.claude/projects"],
    "excludeCwds": ["~/clients/confidential", "C:/Users/me/private"]
  }
}
```

### Excluding folders

Sessions whose `cwd` is a folder in `history.excludeCwds`, or lies inside one, never enter the
index. The comparison uses the `cwd` recorded in the lines, never the directory name under
`~/.claude/projects`. On Windows and macOS it ignores case and the slash type. Changed the list?
[Rebuild the index](#rebuilding-the-index): sessions already indexed only leave, and files
already excluded only come back, after that.

### Rebuilding the index

```sh
flightdeckd history reindex [--config <file>]
```

Deletes the history index and reads every transcript again, printing how many sessions and
messages went in. Stop the daemon first: with another process on the same `dataDir`, the command
exits with code 3.

### In the app

- **Per-host history** (🕘 next to the host name): indexed sessions with title, folder, date of
  the last message, origin (`Flightdeck` or `terminal`) and the "possibly in use" badge; filters
  by folder, period (whole days, in UTC) and origin. The **List/Cards** buttons (the same choice as
  the Sessions screen) draw each session as a card with title, folder, host, date, origin, the
  "possibly in use" badge and, on hosts that report costs, the estimated cost.
- **Global search** (`Ctrl+K` inside the app, or "Search the history"): it is the last section of
  the [palette](#palette-ctrlk). Enter, with nothing selected, queries every online host in
  parallel and merges the hits by date, with host, folder and a highlighted snippet. A host that
  is offline, or does not answer within 5 s, shows as "no answer" without blocking the rest.
- **Reader:** read-only, with the chat's look, loading pages as you scroll. Coming from the
  search, it opens at the hit; otherwise it opens on the latest messages, and "Load earlier" brings
  the ones before without moving what you are reading.
- **Where a conversation opens:** a session (managed, terminal or from the history) opens on its
  latest message and stays at the end while images, code and panels settle. If you scroll up, it
  stays where you are and the **Jump to latest** button counts the new messages ("3 new"). When you
  come back to a tab, the conversation is where you left it.
- **Continue in Flightdeck** turns the transcript into a managed session with `resume`. If the
  session is possibly in use, the app asks for confirmation first, because two processes writing
  to the same conversation corrupt it. **Copy command** copies `claude --resume <id>` for use in
  the terminal.
- **Global shortcut:** see [Global shortcut](#global-shortcut).

## Checkpoints and agent configuration

Two things from Phase 12: going back in time inside a session (the **timeline**), and configuring
the agent of a project (the **Agent screen**). Both need a daemon that announces the
`checkpoints` and `agentcfg` features (0.12.0 or later); with an older one the buttons simply do not
show.

### Snapshots

At the start and at the end of every turn, when the session's folder is inside a git repository,
the daemon takes a **snapshot**: a copy of HEAD plus every change, untracked files included and
ignored files left out. It is built in a temporary index and kept as a commit that only
`refs/flightdeck/snapshots/<session>/<n>` points to, so your index, your files and `git status`
never change and nothing shows up in `git log`.

- Managed sessions take them by themselves. Terminal sessions take them from the
  [hooks](#claude-code-hooks) (`UserPromptSubmit` before the turn, `Stop` after it), so the hooks
  must be installed.
- A turn that changes more than 200 MB is skipped, with the reason. A folder outside a repository
  has no snapshots.
- The daily maintenance keeps 50 snapshots per session and 30 days, and deletes the refs nothing
  uses any more.

### The timeline

The **Timeline** button in the header of a session (managed or terminal) opens a side panel with
its turns, oldest first. Each turn shows its number, the local time, the prompt, and whether it
changed files: **Changed files**, **No file changes** or **In progress**. **Show files of turn N**
lists the files that turn changed, with what happened to each (changed, created, deleted) and the
lines added and removed.

### Rewinding files

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

### Forking

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

### The Agent screen

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

## Issues, automations and arena

Three things from Phase 13, on the board and in the projects list. Each shows up only when the
daemon announces the feature (`issues`, `automation`, `arena`; daemon 0.13.0 or later). With an
older daemon the buttons are simply not there.

### Issues

The **Issues** button in the board header opens a side panel with the project's issues from
GitHub (through `gh`) or Azure Boards (through `az`). Connect a provider first, from the same
button: **Connect issues** asks for the provider and an optional search (blank means the open ones
assigned to you), and can allow the daemon to comment on the issue when the PR opens (off by
default, because it writes to the provider).

- **Filter issues** narrows the list by title, label or author.
- **Create card** makes a card in Backlog from the issue and keeps its link: the row then offers
  **Open card**, the card shows the issue (a button that opens it in the browser) and a PR that
  closes the card closes the issue (`Fixes #n` or `AB#id`).
- An issue from an **External author** is marked. Its text is third-party content: the card's
  automatic approval stays suspended until you resume it.
- Only `http` and `https` addresses are ever opened.

### Automations

In **Projects**, each project has an **Automations** button (on a daemon that announces
automation). The screen lists the project's automations, each with its trigger, action, daily
limit, an **Accepts outside authors** mark and an on/off switch.

- **New automation** is a guided form in three steps: trigger (schedule with cron and time zone, a
  new comment on a card's PR, a card's PR checks that failed, or a new issue with a label), action
  (start a workflow, send the event's content to the card's session, or create a card from the
  issue; the list only offers the actions that fit the trigger) and limit (name, firings per day,
  and whether to also act on outside authors, off by default).
- An automation **always starts off**, also after an edit. Turning it on shows the trigger and the
  action first and needs **Turn on**; turning it off needs nothing.
- **History** lists the firings: Ran, Failed, Ignored, Skipped, Daily limit or Missed (a schedule
  that fell while the daemon was stopped; it is recorded, not recovered).
- A firing that fails does not repeat by itself, and the quota and budget queues still apply.

### Arena

On a card that has not started, **Start in arena** runs the same request in 2 to 4 **variants**,
each with its own model and effort (blank means the host default), in its own worktree and branch
(`fd/<slug>-a`, `-b`...). **Add variant** and **Remove variant** change the count. Each variant takes
one slot of the parallel run limit and waits in the queue when there is none.

The card then shows the **Arena comparison**: one column per variant with its model and effort,
state, duration, estimated cost, files changed and workflow checks, and **Show changes** for the
variant's own diff. **Choose variant X** is available once the variant has stopped; it asks for
confirmation, makes that worktree the card's own and stops and removes the others.

## Risk-graded approval

Every permission request carries a **risk seal**, set by a fixed rule list in the daemon (no AI):
**Low risk** (reads inside the project), **Medium risk** (most commands, writes inside the project,
anything that reaches the network, unknown tools and MCP) and **High risk** (for example `rm -rf`,
`git push --force`, `sudo`, command substitution, a pipe into a shell, or any access to credential
paths). You can add patterns in the host configuration (`risk.extraHigh`); the built-in ones cannot
be lowered.

- A **High risk** request is red and **Approve** becomes **Hold to approve**: hold the button for 2
  seconds. The A key does not approve it; N still denies.
- The tray never approves a high-risk request: it only offers **Open**.
- With automatic approval on, an approval that nobody gave by hand shows in the session's
  timeline as "Approved automatically", with who decided and why. A high-risk request or one that
  reaches the network always comes to you.
- On a host whose daemon has automatic approval, the host page has an **Automatic approvals**
  button. The screen lists what the daemon decided, newest first: the tool, the risk, whether it
  **Approved** or **Asked you**, who decided (the rule or the AI and its model) and why. Filter by
  project, or by tool or reason in **Filter decisions**. **Suspended sessions** lists the sessions
  where automatic approval stopped because third-party content arrived, with the reason; **Resume**
  asks for confirmation before turning it back on.
- The tray tooltip adds how many automatic approvals the app has seen.

## Background sessions

Claude Code can run a session with no terminal (`claude --bg`), under its own supervisor, and list
them with `claude agents`. Flightdeck shows those sessions on the host and lets you act on them.
It needs a `claude` that has the command (2.1.139 or later); on a host whose `claude` does not, the
app shows nothing and asks nothing.

- **In Sessions:** a background session is a row of the origin **Background** (the **Origin**
  filter has it). Its state comes from `claude agents --json`: working is running, blocked (a
  question, a permission, an error only you can clear) needs you, done is idle, failed and stopped
  are ended. The hub asks the host again every 10 seconds while it is open. A session the host
  already shows as a Flightdeck or terminal session stays there.
- **Its screen:** a row that has a Claude session opens its screen, with a **Background session**
  panel: its state, what it waits for, its cost (from the usage of its transcripts, since the
  listing has no cost), and
  - **Stop** and **Restart** (`claude stop` and `claude respawn`, which resumes the saved
    conversation and picks up the current Claude Code);
  - **Bring to the terminal** (when the host's terminals are on): opens `claude attach <id>` in a
    terminal tab, where a permission dialog can be answered;
  - **Message**: through the Flightdeck channel when the session was started with
    `flightdeckd claude`, or, for a session with no process, by continuing it with the message as
    its prompt. A background session that is running and has no channel cannot be written to:
    Claude Code has no command for it, and the app says so.
- **Approving:** a permission a background session asks should be answered like a terminal
  session's when the Claude Code hooks of Flightdeck are installed, but this has not been
  confirmed on a real background session yet (see DECISIONS); the sure way is **Bring to the
  terminal** and answering there.
- **Starting one:** tick **Start in the background** in the new-session form (the host must offer
  it), press **Start in the background** on a card that has no session yet (Claude Code puts it in
  its own worktree; the card's text is the prompt), or run `flightdeckd claude --bg "prompt"`. The session runs with the Flightdeck channel and
  the persona, and shows up in Sessions.
- **Good to know:** Claude Code moves a background session that edits files into its own git
  worktree under `.claude/worktrees/`. Shutting down or restarting the machine stops them (they
  show failed, then stopped); sleeping does not. The files `flightdeckd claude --bg` writes for the
  channel and the persona stay, because the session keeps reading them.

## Session trace and replay

The history says what was said; the **trace** says why a run was slow or expensive. It is built
from the transcripts the host already reads (the session's, and the subagents' in
`<session>/subagents/`), so it works for any session on the host, including old ones.

- **Opening it:** the **Trace** tab of a session (**Rastro** in Portuguese), on a host that
  announces `trace`.
- **The tree:** each turn (one per prompt) with, in order, its thoughts, the tool calls and the
  subagents it started; a subagent shows its own tools and subagents under it. Every node has its
  time, its cost and its tokens (a turn's and a subagent's include everything under them), and a
  bar for the time against the longest call of the turn. The turn or subagent that cost most is
  marked **costliest**, and the call that took longest **slowest**. The **Tool** filter keeps the
  calls to one tool and the turns and subagents they sit in.
- **Where the numbers come from:** the time of a call is the gap between the assistant line that
  asked for it and the line with its result, or the real time the telemetry reported when the host
  receives it (see Session timing). Cost and tokens are the ones Costs already computes, once per
  message. A call to the `Task` or `Agent` tool becomes a subagent when its transcript is found,
  by the agent id in the result or by the parent line of the subagent's first record; otherwise it
  stays a plain call.
- **Replay:** **Replay** walks the trace one node at a time: **Previous**, **Next**, **Play** and
  **Pause** at 1x, 2x or 4x. On a host that keeps checkpoints, each step also lists the files its
  turn changed, with the lines added and removed.
- **Export:** **Export trace** saves a JSON with the structure and the numbers only: no prompt,
  tool input, result or thought. With **Include content** the text comes too, and every field goes
  through the secret scan first: a field that holds a secret is replaced by `[redacted: ...]` and
  the number of such fields is shown.
- **Limits:** the transcript format belongs to Claude Code and changes, so a line or field this
  does not know is skipped; a thought appears only when the transcript has it as text.

## Session timing (telemetry)

Claude Code can export OpenTelemetry (OTLP). The daemon receives it on this machine and uses it to
show the **time**, the **cost** and the **bottlenecks** of sessions opened in a terminal: a slow
tool, the time Claude waited for you to answer a permission, an API error.

- **Where it listens:** `127.0.0.1` only, on `telemetry.port` (`hooks.port + 1` when absent), with
  a token of its own that is not the hooks token or the app's. A request without the token is
  refused, and so is a body over 1 MiB. It listens only while telemetry is on (`telemetry.enabled`,
  on by default) **and** the hooks are installed, so a daemon without them opens no extra port. If
  the port is taken the daemon logs it and carries on without the receiver.
- **Turning it on for a session:**
  - `flightdeckd claude` gives the claude it opens the exporter variables
    (`CLAUDE_CODE_ENABLE_TELEMETRY`, the OTLP exporters for metrics and logs, the endpoint, the
    header with the token and short intervals). It adds nothing over an exporter you already set
    yourself, and nothing in print mode (`-p`).
  - For a plain `claude`, use **Install telemetry** in the **Telemetry** panel of the host page (it asks first, naming the file and the backup), or run `flightdeckd telemetry install`: it writes the same eight keys into
    `env` of `~/.claude/settings.json`, after a copy in
    `settings.json.flightdeck-telemetry-backup`. If any of those keys already holds a value of
    yours it stops, names the keys and changes nothing. `flightdeckd telemetry status` says
    `installed`, `absent`, `outdated` or that an exporter of yours is there;
    `flightdeckd telemetry uninstall` (or **Remove telemetry**) takes out only Flightdeck's keys and **changes the token**,
    so a copy of the old one stops working.
- **What is kept:** for each event the session, the prompt, the time, how long it took, the cost,
  the tokens, whether a tool worked, the error type or HTTP status, and who answered a permission.
  **Prompts, answers, tool parameters and API bodies are never collected.** Flightdeck never sets
  an `OTEL_LOG_*` variable, and if an exporter sends such text anyway it is dropped on arrival.
  Events are kept for 30 days (`telemetry.retentionDays`).
- **The Time tab:** in a session with data, **Time** (**Tempo** in Portuguese) lists each prompt
  with its steps in order: the API requests, the tools with their time (a bar shows each against
  the longest step of the prompt), the permissions and how long you kept Claude waiting, and the
  API errors. The wait is an estimate: the gap between the step before and your answer.
- **In Costs:** **Time per project** shows, per project, the time spent waiting for permissions
  and the slowest tools (average, maximum, calls). A notice appears when a session's cost in the
  telemetry is far (over 10% and US$ 0.05) from the one computed from the transcripts, for the
  stretch of the session the exporter was on.
- **Limits:** only sessions that sent telemetry have data; the metrics the exporter sends are
  accepted and not kept. For developers, `bun run smoke:otel` runs the whole path with a fake
  claude.

## Connections

**Connections** (sidebar, for hosts that keep SSH destinations) lists the **destinations** saved on
the first online host that announces them, and opens each in a terminal screen running the OpenSSH
client of that host. Flightdeck has no SSH client of its own: it builds the `ssh` command as an
argument list, with no shell in between, and never stores a password or a key, only a reference to
one (a key file path).

- **Connect** first checks the server key. A server never seen shows its **SHA256 fingerprint**
  and waits for **Confirm server key**; only then does the terminal open. Later connections use a
  known-hosts file of Flightdeck's own and require the key to match. A **changed key blocks the
  connection** and shows the kept fingerprint and the new one; nothing connects until you open the
  destination and choose **Forget server key**.
- **New destination**, **Edit**, **Duplicate** and **Remove** (with a confirmation). A destination
  has a name, host, port, user, authentication (the host's **SSH agent**, or a **key file** by its
  path), the host that opens it, an optional **jump** (another destination), tags, and a short
  fixed list of options: keep-alive seconds, compression, local forwards as text and
  **ForwardAgent**, which is off and asks you to confirm before it turns on.
- **Test connection** (in the edit form) runs `ssh` without a terminal and says "Connection ok." or
  the error in words. It does not cover passwords.
- **Import from SSH config** reads the host's `~/.ssh/config` (read only, never written), lists the
  names it found, marks the ones already saved and creates only the ones you tick. Wildcard
  entries (`*`, `?`) are defaults for the others, not destinations.
- **Search** by name, host or user; filter by tag and by the host that opens the destination.
  **Ctrl+K** also offers **Connect to <name>** for each destination.
- The terminal tab of a destination is named "SSH · name" and carries its tags. A destination
  tagged `prod` or `produção` gives that **tab a red border**, so a production server is hard to
  mistake for another.

A destination can also use **Password** authentication: when ssh asks, the app opens a masked
dialog (or one for a key passphrase). The answer goes to the host once, is never stored or logged,
and **Cancel** makes ssh fail at once. With the Vault, **Vault key** authentication picks an SSH key of the vault
(and **Password** may point at a password of the vault, which then answers ssh without a dialog).
The key goes to the host that runs ssh, in the connect command and nowhere else, only if the
secret is allowed for that host and the connection is `localhost` or Tailscale; each use shows in
the vault's **Usage** tab as purpose `ssh`, asked by **You**.

A destination with a **host that opens it** other than the one that keeps it runs ssh there (for
example a VPS, to reach its internal network): Flightdeck keeps a copy of the destination on that
host, and says so on screen if the host is offline or has no SSH support.
## Vault

The **Vault** (sidebar) keeps secrets: SSH keys, passwords, tokens and sets of environment
variables. A secret's **value** lives in the system credential store (Windows Credential Manager),
never in the app's files and never in a log. The list on the screen holds only the name, the type,
the tags and a description of the secret.

- **New secret** asks for a name, a type, the value and tags. **Generate SSH key** makes an
  `ed25519` pair with the `ssh-keygen` of this computer, keeps the private key in the vault, deletes
  the temporary file and shows the public key, ready to **Copy public key**. **Import key file**
  reads a key file you choose in the system dialog; the original stays where it is unless you tick
  **Delete the original file after importing**.
- Each row shows what is safe to show: a key's public key fingerprint, a token's start and end
  (`ghp_…WXYZ`, and nothing for a short one) or the names of an env set. A password shows nothing.
- **Reveal** asks you to type the word `reveal`, then shows the value for 10 seconds. **Copy** puts
  the value on the clipboard and clears the clipboard 30 seconds later. **Remove** asks you to type
  the secret's name and deletes the value from the system store as well.
- **Usage** is a log of every request made of the vault: the secret, the host, the purpose, who
  asked (you, Claude, an automation or a workflow) and the result (delivered, denied or used). It
  never holds a value. Filter it by secret or by who asked.
- **Backup** exports the vault to a `cofre.fdvault` file, encrypted with the passphrase you type
  (at least 12 characters, confirmed twice). **Import vault** reads such a file with its
  passphrase and shows a preview of the **New**, **Same** and **Conflicting** secrets before
  anything changes; a conflict keeps what is in the vault unless you choose **Replace with the
  backup**. A wrong passphrase and a changed file are both refused.

A secret reaches a daemon only when the app sends it, only to a host in the secret's allowed hosts,
and only over `localhost` or Tailscale; the daemon keeps it in memory for at most 60 seconds. In
this version no daemon feature asks for secrets yet, so every request from a daemon is denied.
## Actions: Claude uses a secret without seeing it

An **action** is a command you declare, with places for vault secrets and for parameters. Claude
calls it by name and only chooses the parameters you allowed. The daemon applies the secret on its
side and hands Claude the exit code and the output (up to 32 KB) with the secret masked as
`•••(name)`. Actions need the vault (a secret stored in the app) and a daemon that has them: the
**Actions of <project>** button on a project appears only then.

```yaml
# .flightdeck/actions.yaml (versioned, no secrets) or the project's Actions screen
- name: deploy-staging
  description: Deploys the branch to the staging VPS
  run: ["./scripts/deploy.sh", "{{param.branch}}"]
  cwd: /srv/app
  env:
    DEPLOY_TOKEN: "{{secret.deploy-token-staging}}"
  params:
    branch: { pattern: "^[a-zA-Z0-9._/-]{1,80}$", default: main }
  timeoutS: 600
  approval: first-per-session   # always | never | first-per-session
```

- `run` is a list of arguments and never goes through a shell. A secret goes only to `env` or to a
  temporary file (`{{secretFile.x}}`, deleted afterwards), never to an argument, because arguments
  show in the process list.
- Each parameter must match its whole `pattern`, and a `{{param.*}}` cannot sit where an
  interpreter reads code (after `-c`, `-e`, `/c`, `-Command`, `-EncodedCommand` or `eval`).
- `ssh: <destination>` runs the action on a phase 15 SSH destination of that name, where Claude has
  no shell. The command arrives quoted word by word and the environment goes over stdin; a
  destination that logs in with a key from the vault gets it for that run only. A destination
  with a password cannot run actions.
- `approval` defaults to `first-per-session` for an action with a secret and `never` for one
  without.

### The Actions screen

- Each action shows its description, where it runs (this host, a named host or an SSH
  destination), how it asks for approval, the secrets and parameters it uses, and whether it was
  **Made in the app** or is **Versioned**. Problems in `.flightdeck/actions.yaml` are listed above
  (the valid actions still load).
- **Trust.** An action made in the app is trusted as it is saved. A versioned one shows **Not
  trusted** until you press **Trust <name>** and confirm; the confirmation shows what it runs.
  Trust pins the declaration and the sha256 of `run[0]` and of every file in the argv that is
  inside a git repository, and the daemon checks them again right before each run. If one changed,
  the action shows **Changed since it was trusted** with what changed, and runs again only after
  you trust it again.
- **New action** opens a form: the name, a description, the command one argument per line, an
  optional SSH destination, folder, time limit and approval, the environment variables fed by a
  secret of the vault (the picker shows names and tags, never a value) and the parameters with
  their pattern and initial value. The daemon checks it and what it refuses shows in the form.
  **Edit** and **Remove** (which asks first) are on the actions made in the app; a versioned action
  is changed in its file.
- **Production warning.** An action that runs on this host with a secret tagged `prod` says so on
  its row: a Claude session with Bash on this host could read the secret while it runs. Prefer an
  `ssh:` action for it.
- **Runs.** **Runs of <name>** opens the history, newest first: when, who asked (You, Claude,
  Automation or Workflow), the exit code, the duration and the output, already masked by the
  daemon.

### Approving a request

When Claude, an automation or a workflow runs an action that needs a secret, the request shows in
**Needs you** with a notification: who asked, the action and its parameters (or the command, the
secrets and the host). **Approve** delivers the secret for that run only; **Deny** fails the run
at once. An action with `approval: never` runs without a question, `first-per-session` asks once
and is then remembered until the app restarts, and `always` asks every time. A `run_with_secret`
is high risk: hold the button for 2 seconds to approve it, and the tray only opens it.

### Usage rules per secret

Each secret has an ordered list of rules: the first that matches a use decides, and without one
the safe default applies (you: allow; Claude with a declared action: ask once per session;
`run_with_secret`: ask every time; automations and workflows: deny; a `prod` tag: ask every time,
holding the button). **Rules of <secret>** on the vault screen edits them: who asks, the purpose,
the action (with `*`), host, tags, project, session, the decision (once per session with **Ask**),
a time window on this computer's clock with what holds outside it, limits per hour and per day,
and an expiry. Move a rule with **Move up**, **Move down** or by dragging.

- **The ceiling:** a rule can loosen a default, but never allow `run_with_secret`, nor allow a
  `prod` secret without a window. The hosts check the rules when you save, and what they refuse
  shows with the reason.
- **What happens if…** under the rules asks a connected host what the saved rules decide for a
  use: the decision, its reason, whether it asks once per session, holds the button or hit a
  limit.
- **Approving:** the request shows the rule that decided and why. Where the rule allows it,
  **Approve and don't ask again this session** approves the rest of that session. **Create a rule from this**
  opens the secret's rules with a new first rule for that requester, purpose and action.
- **Report:** the vault's **Report** tab shows the last 30 days by secret, requester and outcome,
  with **Export CSV**, and each decision with who let it through. A first use by a new requester
  shows an alert, even where a rule allowed it.

### How Claude calls an action

- **MCP (`flightdeckd mcp`):** `list_actions` (name, description and parameters, never secrets),
  `run_action { name, params }` and `run_with_secret { command, secrets, host }`. The last one is
  a command written by Claude itself, with the secrets in its environment: it **always** asks for
  your approval, with the command, the secret names and the host, and it is never automatic, not
  even with automatic approval. It has no "allow always".
- **The `flightdeck` mod** (`mods/flightdeck`, install it with `/plugin install`) registers the
  same tools for terminal sessions without the MCP, shows an "action running" band and the
  `/flightdeck` command. Its tools are `mcp__flightdeck__*`, the same prefix as an MCP server
  added as `flightdeck`, so turn on only one of the two in a session. (Before phase 21 it was
  called `flightdeck-actions`.)
- **The mask** replaces the delivered value, each line of a multi-line value, and its base64,
  URL-encoded and hex forms. A secret transformed another way (a hash, a cut in the middle) is not
  caught, which is why a declared action is the safe path and a free command is not.

### The limit: the same system user

The guarantee is that the secret never reaches the transcript or the model's context through
Flightdeck. It is not isolation from a hostile process of the same user: while an action runs,
its environment (`/proc/<pid>/environ` on Linux) and its temporary file can be read by another
process of the same operating-system user, and a Claude session with Bash on the **same host** can
read them. Keep production secrets in `ssh:` actions.

In a terminal, an action is masked when it runs through `flightdeckd action run` (what the
`flightdeck` mod uses): what it prints is the daemon's masked result. Anything else a
terminal shows is not masked.

## Notification center

The bell at the right of the top bar keeps every notification the app sends: a request that
needs you, a session that ended, a budget or quota alert, a PR watch result, a card that was
unblocked. A badge on the bell counts the unread ones.

- Click the bell to open the panel: newest first, grouped by day (Today, Yesterday, then the date).
- Click an entry to mark it read and open its screen (a request opens on its card; a quota alert
  opens the host). A budget alert opens Costs already filtered by its host and project, or by
  its client; a team alert opens Teams with that team first and marked. A card's entry (a PR watch
  result, an unblocked card) opens the PR in your browser when the card is gone.
- **Mark all as read** keeps the list; **Clear** empties it. The list is kept on this computer
  (the newest 500) and survives a restart. Esc closes the panel.
- The OS notifications are unchanged. The center only keeps a copy, so one that is never sent
  (the window had focus) is not in it either.

## Snippets

**Snippets** are saved commands and prompts. The **Snippets** screen (sidebar, for hosts that keep
them) shows the host's snippets; choose a **Project** to add that project's own and those of its
versioned `.flightdeck/snippets.yaml`, or **Global (this app)** for the ones kept in the app.

- **New snippet**: a name, a type (**Command**, one line, or **Prompt**), the text, tags and where
  to keep it (on the host, in the project, in the project's versioned file, or in the app). Write
  `{{name}}` for a value asked when the snippet is used; the editor shows the fields as you type,
  and each can have a default and a list of options. `{{cwd}}`, `{{branch}}`, `{{file}}` and
  `{{selection}}` come from where the snippet is used.
- A snippet never holds a secret: one is refused with the reason, and **Turn into an action**
  opens the project's Actions with a new action filled in: the command without the secret and an
  environment variable for it, whose vault secret you choose.
- The versioned file is shared with the repository. Until you **Trust the file**, its commands
  only paste, they do not run; changing the file takes the trust away. Entries the app cannot read
  are listed with the reason.
- **Import from the shell history** lists the commands of the host's bash, zsh and PowerShell
  histories, most used first (read only). A line with a token, a key, a password or a value of the
  vault is hidden and cannot be imported; **Reveal hidden lines** shows only the ones the patterns
  found, still locked. The ticked lines go to the host's snippets or to the app's, never to the
  versioned file.
- **Import from a file** reads a YAML or JSON list of snippets (the format of the versioned file), shows what it found and what it left out, and saves the snippets to the host or to the app.
- Favorites (the star) come first, then the most recently used. **Use** on a row opens the snippet to fill and use.

To use one:

- **Ctrl+K**: **Snippet: <name>** (the search also matches tags and content) opens the snippet with
  its fields. A command **pastes into the terminal** on screen (with or without **Enter**), or
  **runs in a new tab** at the folder you give; a prompt is **sent to the session** on screen (managed or a terminal session you can write to), or opens a **New session with this prompt**.
  **Copy** works for both.
- In a terminal tab, **Ctrl+Shift+Space** lists the command snippets of that host and of the app.
- In a session's message box, **/** lists the prompt snippets; the chosen one goes into the box,
  filled from the session's folder, or as written when a field still needs a value.
- Claude can read snippets with the `list_snippets` and `get_snippet` tools of the Flightdeck MCP.
  Flightdeck never runs a snippet for Claude: a command Claude runs goes through Claude Code's own
  permissions.

## Personas

A **persona** is an engineering role Claude takes in a session: a name, a description, an icon, a
suggested model, effort, tools and permission mode, and the instructions of the role. The
**Personas** screen (sidebar, for hosts that keep them) lists them by where they live:

- **Pack**: eleven come ready, in English and Portuguese (architect, security reviewer, QA, SRE,
  performance, code reviewer, docs, frontend, DBA, the team coordinator of phase 21 and the
  **Developer**, the one that writes the code: test first, small scoped changes, follows the
  project's CLAUDE.md and ADRs, runs the project's checks before saying done, never pushes). Editing one
  keeps your version on the host (**Pack, edited**); **Restore original** brings the pack's back.
- **Host**, **Project** (choose one: its own and the versioned `.flightdeck/personas/*.md`, which
  you **Trust** first) and **Global (this app)**, kept in the app.
- **New persona** and **Edit** open the editor with a **Preview** of what the session gets. A
  persona never holds a secret: one is refused with the reason.
- **Publish as agent** writes the persona to `.claude/agents/persona-<id>.md` through the
  agent editor, with confirmation, so it also works for plain `claude`.

Using one:

- **+ New session**, **Ctrl+K** (**New session as <persona>**), **Card persona** next to **Start**
  (it suggests the Developer when the host has it; pick **None** to start without one),
  and each variant of **Start in arena** have a **Persona** field. The session opens in it: the
  instructions go after the system prompt, with the model, effort and tools it suggests. A persona
  only takes away: its tools are a subset of the session's, and its permission mode counts only
  when it is less permissive.
- **Claude here** has its own picker and runs `flightdeckd claude --persona <id>` (the host's, the
  project's and the pack's; the app's own have no id on the host).
- On an open session (managed, or a terminal session you can control), **Apply persona** sends the
  role as a message, and **Back to normal** ends it. The app says so: in an open session the persona
  is an instruction of the conversation, not of the system. After each press it also says how the
  instruction went: **sent** to an idle session, **queued** behind the current step or a pending
  permission request (it is sent once that is answered), or **sent to the terminal session** (it
  shows in the conversation when Claude takes it, after any pending request). **Claude here** with
  a persona is different: it starts a new terminal session with the persona in the system prompt.
- **Personas as subagents** on the project's agent screen: **All** (the pack's, the host's and the
  project's), **Only the project's** or **None**. They reach the sessions as `persona-<id>` agents,
  for Claude to delegate to.
- The project form has a **Default persona** per board column: a card that starts from that column
  opens in it, unless you chose another.
- The session list shows each session's persona and filters by it; **Costs** has **By persona**.

## Memory, context and plugins

Two extensions of the project's **Agent** screen (phase 12) and a screen for Claude Code's plugins.

### Memory and context

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

### Plugins

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

## Watching and fixing a PR

A card with an open PR has **Watch and fix**. It is off by default: turn it on in the card, or make
it the default of a project in **Settings**. Hosts that offer it (`watch` in the host page) watch
the PR at every `board.prPollIntervalMs`:

- the **builds** and the **policy evaluations** (Azure DevOps, through `az devops invoke`; GitHub,
  through `gh pr checks`), the **conflicts** with the target branch and the **new comments** of
  people you trust (the card's identity, or owners, members and collaborators);
- only what **got worse** starts a round: a build that fails, a new conflict, a new comment. The
  first look counts everything as new.

A **round** opens the card's session as the `revisor` persona, with the names of the failed checks,
the end of the build log (16 KB), the conflict and the comments. The log and the comments reach it
as quoted data, never as instructions. The session fixes and commits, the **local checks** of the
project run in the card's worktree, and only if they all pass does the host push, to the card's own
branch, never forced and never to the base. Merging stays with you. The card shows **Watching the
PR**, each round with its result (**Round 2 · failed**) and why it asks for you.

A round stops, and the card goes to **Needs you** with the summary, when a limit is reached: 3
rounds per PR, US$ 5 per PR, 30 turns, US$ 20 per day and project, two failed rounds in a row, or
the quota queue. It also stops by itself when the PR is merged or closed, or when you turn the
watch off. **Watch again** puts it back.

**Settings** has **Watch and fix PRs · <host>**, one block per project: watch by default, rounds per
PR, cost limit per PR and per day (empty is no limit), the time limit per check (1 to 60 minutes,
10 by default) and the **local checks**, one per line. A check is a command with its arguments, with
no quotes, pipes, `;`, `&`, `$` or redirections: anything else is refused. A check that runs out of
time is killed with everything it started, and the round says so. A pushed round lists the checks
that passed.

Two more things come with it:

- **Open PR** on a card first shows the **PR description**, made from the card's sessions, to edit.
  Lines that look like a secret are taken out and counted. Nothing is opened until you click **Open
  the PR with this text**.
- **Ctrl+K**: paste a PR link (Azure DevOps or GitHub) and choose **Open the PR from the link**. The
  hosts are asked: the card opens if the PR is from one; otherwise the transcript of the first
  session the history knows for it; otherwise a message says nothing has it.

## Teams and messages between sessions

Claude Code sessions can message each other through Flightdeck, on the same host or across hosts.

- **The tools** come from the MCP (`flightdeckd mcp`) or the `flightdeck` mod:
  - `list_sessions`: the sessions this one may see, with their address (`host/id` or the alias);
  - `send_to_session`: the answer is delivered, queued or refused with the reason;
  - `notify_when_idle`: one notice when the other session ends its turn;
  - `read_session`: read only;
  - `team_status`: the state of a team.
- **Who is sending** comes from the session's environment: `FLIGHTDECK_SESSION` in managed
  sessions, `FLIGHTDECK_LAUNCH_ID` in those opened by `flightdeckd claude`.
- **Delivery on one host** needs no app:
  - a managed session in the middle of a turn gets the message when the turn ends;
  - a terminal waiting for a permission gets it after that.
- **Delivery across hosts** goes through the app, which carries the message from one daemon to the
  other. With the app closed, the message waits up to 24 hours. A plain `claude` (no channel)
  receives nothing.
- **Known limit:** only session messages cross hosts. STOP, resume and the idle notice work on the
  team's host, and `read_session` and `notify_when_idle` only see sessions of the same host.
- **In the app:**
  - **Conversations** (sidebar) lists the messages newest first, with filters by state and team;
  - each session has a **Messages** tab with what it sent and received;
  - from that tab, **Send to another session…** sends a message from the session to another one.

### Standard session names

- **Every session gets a name** when it appears: `project · persona · number`, for example
  `flightdeck · revisor · 3`.
  - Without a persona, the persona is `geral`.
  - A card's session takes the card's number: `flightdeck · autor · card 42`.
- **Every session also gets an alias:** `project-persona-number`, for example
  `flightdeck-revisor-3`. The alias addresses the session, alone or as `host/alias` across hosts.
- **A number is never reused**, not even after the session is gone.
- **Renaming a session** changes its name and adds an alias. The old alias keeps working.
- **In Sessions:**
  - a host that has names shows them;
  - inside each project, sessions are sorted by name, after the ones that need you and the pinned
    ones;
  - **Filters → Persona** keeps one persona;
  - a name you gave a session still wins.

### Who may message whom

- **The default:** only sessions of the same project or of the same team talk.
- **Settings → Messages between sessions on <host>:**
  - adds exceptions by session, project, team or host, one way or both ways (**Both ways**);
  - sets the **retention** of the history (30 days by default);
  - lists the **pairs paused for a loop**, with **Free**.
  - If the host refuses a change, the section says why.
- **Limits:**
  - 20 messages per hour per pair, and 100 per hour per session;
  - 32 KB per message.
- **A loop pauses the pair:** more than 10 messages back and forth in 10 minutes.
  - You get a notification, and the pair waits in **Needs you**.
  - **Free the pair** lets the pair talk again.
- **A message is never an approval:**
  - its header says it comes from another session, not from you;
  - no message answers a permission request.
- **Third-party content:** a session that received third-party content passes that mark on, and
  automatic approval stays off for whoever it messages.

### Teams

- **A team** is a coordinator session and its workers. Each worker runs in a card, with its own
  worktree.
- **Teams** (sidebar) creates a team: the project, the goal, a name and, if you want, the
  coordinator's persona and model. The workers are rows: each has its own persona and model, and
  you add or remove rows (the number of rows is the number of workers, 1 to 8). A worker's
  persona starts as the Developer when the host has it; pick **None** for the plain default. With no choice,
  the model is the persona's. Each member's model shows on its line.
- **The coordinator's cycle:**
  1. split the goal into tasks, each with what "done" means;
  2. send one task to each worker, and ask to hear when it goes idle;
  3. check the work itself, with the project's checks or the team's commands, in the worker's
     worktree;
  4. accept only a green commit;
  5. integrate in the agreed order;
  6. tell you when something is your decision.
- **From the team's row you can:**
  - pause it (STOP to every member) and resume it;
  - send a message to everyone;
  - change a member's persona;
  - add a worker, choosing its persona and model (the coordinator is told its name and card);
  - take a member out: its session is stopped, the coordinator is told, and its card stays on the
    board;
  - close the team, with a confirmation.
- **The quota:** when the plan quota crosses the limit (`quota.pauseAt`), the team pauses by
  itself. You get a notification, and the row says "paused by the quota". When the window
  restarts, the team resumes and tells you.

## Costs, budgets and quota

### The Claude account of a host

The host page has an **Account** card, above the usage panel, that shows which Claude account the
host's own `claude` is signed in to. Flightdeck never signs you in and never sees a token: it asks
the `claude` already installed on the host (`claude auth status`, plus the account and usage
reports of the Agent SDK), and Anthropic's terms keep a login out of third-party apps.

#### Which account is this host using?

- The card shows the account's email, the organization, the plan (Pro, Max, Team, Enterprise) and
  two bars, **5 hours** and **7 days**, with the percentage used and when each resets (hover for
  the exact time). The 7-day Opus and Sonnet bars show only when the host reports them.
- It is read when you open the page and again every 5 minutes while the page stays open, and at
  once when a managed session ends a turn. "Last read 2 min ago" tells how fresh it is. **Refresh**
  reads now; it waits 30 seconds between reads.
- Each host has its own account. The email is shown on this card only: it is not put in
  notifications, the window title, the status line or the tray, and the daemon keeps it in memory,
  never in its database or logs.
- If a read fails, the card keeps the last reading and says "Could not refresh". If the host is
  offline, it says so instead of showing an old reading.

#### What if the host is not signed in?

The card says "This host is not signed in to Claude." and shows the command **`claude auth login`**.
Open the host's terminal (the **Open terminal** button does), run it there, follow the steps, and
come back: the card updates. **Copy command** copies it. The card has no form and never asks for a
code or a token.

A host that uses an API key or a cloud provider (Bedrock, Vertex, a gateway) shows "Plan limits do
not apply": it has no plan windows. If the card says the account could not be read, check that
`claude` is installed on that host and press **Try again**.

### Plan quota

Each turn of a managed session carries the Claude plan's quota. All of a host's sessions use the
same login, so the quota belongs to the host. The daemon keeps the last reading of each window
(5 hours, 7 days and any others that come along), and a reading stops being valid when its
window resets.

- **In the app:** the top of the Sessions screen shows, for each online host, the 5-hour and
  7-day bars, with the percentage, the reset time and the age of the reading ("read 12 min
  ago").
  - The bar turns red from `quota.pauseAt`.
  - Crossing `pauseAt` raises a notification, once per window.
- **Terminal only:** the hooks do not carry the quota. Anyone who only uses terminal sessions
  sees empty or stale bars until a card or a managed session runs on the host.

### Quota queue

```json
{ "quota": { "pauseAt": 0.9 } }
```

While any valid window is at or above `pauseAt` (or was refused by the plan):

- a started card is queued with the badge "waiting for the quota until HH:MM" and starts by
  itself when the window resets;
- a running workflow waits before the next agent turn, at the same point where it checks the
  budget;
- manual sessions are not blocked; the app only shows the warning.

`"pauseAt": null` turns the quota queue off.

### Usage

The host screen shows the last 7 days of usage, per day (in the host's timezone) and per
project. On a Phase 8 or later host (one that announces `costs`), the panel reads the costs of all
sessions (see [Costs](#costs)). On a Phase 7 host, it shows the usage of managed sessions:
estimated cost, tokens and turns.

- **Cost:** it is the difference of the total the SDK reports for each session, never the sum
  turn by turn.
- **Project:** the same as on the Sessions screen (the `origin` remote, or the repository path).
- **Grouped by project:** each project is one block with its total (the most expensive first) and
  its days below, newest first. Dates and costs never wrap.
- **Hidden:** temp folders (`temp`, `tmp`, `/var/folders`) and agent worktrees
  (`.claude/worktrees`) are not listed.
- **Open the sessions:** click a day to open History filtered by that project's folder and that
  day. A project known by its remote (shared by several folders and worktrees) opens History
  filtered by the project itself, so every one of its folders is listed; a "Project: name" chip
  above the list shows it, and **Clear project** takes it off.
- **Not in the usage:** terminal sessions, because the hooks carry no cost.

### Costs

The **Costs** screen, in the side menu, shows the cost of all of a host's sessions: terminal,
app, cards and workflows, subagents included.

> **Estimate:** the value is the API-price equivalent, estimated. On a Claude subscription,
> none of it is charged.

- **Source:** the Claude Code transcripts in `~/.claude/projects`, the same as the history.
  - Each message counts once, even when the transcript repeats it across several lines.
  - On the first boot of this version, the daemon reads the existing transcripts in the
    background and keeps answering meanwhile.
- **Period:** today, 7 days, 30 days, current month or a range, always in the host's timezone.
- **Filters:** host, project, model and origin (terminal, app, card, workflow, subagent).
- **What it shows:**
  - the estimated cost, the tokens and the cache savings (how much less the cache read cost than
    the same volume as normal input);
  - a per-day chart stacked by project, and the breakdowns by project, model and origin;
  - the most expensive sessions, and clicking one opens it;
  - the estimated cost also shows in the session list, the open session, the card and the
    workflow run.
- **Export CSV:** saves, through the system dialog, one row per day, project, model and origin.
- **Warnings:**
  - models with no price show as "no price", with the name;
  - for managed sessions, the daemon compares the computed cost with what Claude Code itself
    reports, and if the difference exceeds 10% (and US$ 0.05), the screen warns that the price
    table may be out of date.
- **Retention:** usage is kept for `retention.usageDays` days (default 400).
- **Go to Costs** in the [palette](#palette-ctrlk) appears when the app has the Costs screen and
  some host announces `costs`.

### Prices

The default table is the API price list of 2026-10-06, in US$ per million tokens:

| Model | Input | Output | Cache read |
| --- | --- | --- | --- |
| `claude-fable-5-1` | 10.00 | 50.00 | 0.25 |
| `claude-opus-5-5` | 4.00 | 20.00 | 0.20 |
| `claude-sonnet-5-5` | 2.00 | 10.00 | 0.20 |
| `claude-haiku-5-5` | 0.10 | 0.50 | 0.01 |

- **Cache write:** 1.25x the input price for the 5-minute cache and 2x for the 1-hour cache,
  which is what Claude Code uses.
- **Haiku 5.5:** goes to 0.50 and 2.50 above 100 thousand prompt tokens.
- **Fast mode:** Opus 5.5's costs 2x.

To override, use `pricing` in the config, model by model:

```json
{
  "pricing": {
    "models": {
      "claude-opus-5-5": { "input": 4, "output": 20, "cacheRead": 0.2 },
      "claude-haiku-5-5": {
        "input": 0.1, "output": 0.5, "cacheRead": 0.01,
        "tiers": [{ "abovePromptTokens": 100000, "input": 0.5, "output": 2.5 }]
      }
    },
    "cacheWrite5mMultiplier": 1.25,
    "cacheWrite1hMultiplier": 2,
    "fastMultiplier": { "claude-opus-5-5": 2 }
  }
}
```

- **What changes:** a model in the config replaces that model's default. Models that do not
  appear keep the default.
- **Recompute:** the `costs.reprice` command rereads the config and recomputes the cost of all
  entries. No daemon restart needed.

### Budgets

In **Settings**, each host with costs has the **Budgets** section:

- **Setup:** each budget belongs to the host or to a project (the project key from the Sessions
  screen), per day or per month, in the host's timezone, with a limit in US$.
- **What counts:** the estimated cost of all origins. The list shows how much has been spent in
  the period and the percentage.
- **Alerts:** at 50%, 80% and 100%, once per period each, as a system notification and in the
  "Needs you" banner.
- **Action:**
  - **notify:** alerts only;
  - **hold new cards:** at 100%, new cards of that scope wait in the queue with reason
    `budget`. They leave by themselves in the next period or when the limit goes up.
  - Terminal sessions and manual sessions are never held.

### Quota history

Every quota reading from a managed session is kept for 30 days. Identical readings less than
5 minutes apart are merged into one.

- **On the Costs screen:** the **Quota** section shows the 5-hour and 7-day windows over time.
- **Projection:** with at least 3 readings of the current window:
  - "at the current pace, the 5 h window runs out at HH:MM";
  - or "won't run out before HH:MM", when the pace does not reach 100% before the reset.
- **Tooltip:** the bars at the top of the Sessions screen show the same projection.
- **Who used the window:** each project's share of the estimated cost since the start of the
  current 5-hour window. It is an approximate attribution, because the plan does not say who used
  the quota.

### Return on cost

For hosts that announce `roi`, the project's board page starts with a **Return on cost** card and the Costs screen
gains a **project table**, a **people table** and a settings block. It answers one question first: *did we deliver more
for what it cost?* Every figure is correlated and estimated: hours and rates are typed, not measured, and a card done is
not a verified result. The screens never call it profit or savings.

- **The card.** Choose 7 days, 30 days or this month. The first line says how many items were delivered (cards done,
  split into *planned*, which were on the board before the period began, and *unplanned*, created and done inside it),
  what the agents cost, and whether that is more, fewer or about the same (within 5%) as the period before, with the
  cost per item of both. Below it: cards done and PRs merged, cost per card and per PR, the rework line (fix rounds and
  their cost), estimated hours and value marked as an estimate, and an 8-week trend with a text alternative.
  **How is this computed?** lists each number with its inputs.
- **Optional signals.** In the card's **Hours and rate** block, each project can switch on *agent commits* (commits of
  the period with a `Co-Authored-By: Claude` trailer; approximate, because a person can add the trailer too) and *issues
  closed* (asked of the host's `gh`, kept for an hour; the card says when `gh` is missing or signed out). Both are off by
  default.
- **The Costs table.** One row per project of the chosen client scope: cost, cards, PRs, cost per card and per PR,
  estimated hours, estimated value and return on cost (estimate). Click a column header to sort, again to reverse. A
  dash means the figure cannot be computed (no cards, no rate). The footer adds up the rows. **Export the project table
  as CSV** saves one row per project, with a column that says how each figure was made; the file always uses a dot as
  the decimal mark.
- **People.** *Tokens against delivery, by person* groups hosts into a named person (for example, the host that
  someone's agents run on) with a monthly token and/or cost limit. It shows the month's use against the limit, what was
  delivered, and tokens per card. People are listed by name: it is a view, not a ranking, and hosts are not people.
  Nothing is enforced; the existing host and client budgets are the ones that stop work.

#### Where do I set the hourly rate?

The rate is the person's own money figure and stays in the app; the hosts never see it. The project's own rate wins,
then its client's, then the default.

- **Default and review time:** Costs, **Return on cost settings**. There you also choose whether *your* review time
  counts as cost (at most the cap you set for each decision; off by default, and the card shows the waiting time as
  information either way) and manage the people.
- **A client:** the **Clients** screen, **Hourly rate for this client**.
- **A project:** the card's **Hours and rate** block on the board page, which also holds the hours each card is worth by
  default. A single card's hours are set in the card's detail, **Estimated hours for this card**.

#### Why is there no ROI for a project?

- **No rate:** the card says *Set an hourly rate to see the estimated value*; the cost per card and per PR still show.
- **No hours:** done cards without an estimate and without a project default are counted and named, and add no hours.
- **Nothing delivered:** the card says so and still shows what the agents cost.
- **No cost yet:** the ratio needs a cost above zero.
- **The host is offline or does not announce `roi`:** its figures are missing; the others still add up.

## Clients: grouping work across hosts and projects

A **host** is a machine and a **project** is a repository (or a folder). If you work for several
clients, with several machines and many folders, a **client** groups projects across hosts: it is
kept by the app, crosses hosts, and is **never required**. With no client defined, the app looks
and behaves as before (the only difference is one line in **Settings**). Hosts are not grouped under
clients, since one machine often serves several of them.

**Creating clients.** Open **Manage clients** (the line in **Settings**, **Ctrl+K**, or the
switcher once a client exists). **Create client** takes a name (unique, ignoring case); each client
has a color, can be renamed, moved up or down, and deleted (its projects go back to the rules of
the others, or to no client; nothing is deleted from the hosts). The order of the clients is the
order their rules are tried in.

**Rules.** A project joins a client by the first rule that matches it:

- **Remote**: a prefix of the project's remote, with `*` at the end (`github.com/acme/*`,
  `dev.azure.com/orgb/*`) or one exact repository. The same repository on two machines is one
  project, so one rule covers both.
- **Folder**: an absolute folder prefix (`/home/me/work/acme`, `C:\work\acme`), for any host or
  for one (picked by name). There is no `~`: a host does not tell the app its home folder. A
  folder rule also claims a project known by its remote when any folder its sessions ran in is
  inside the prefix. A rule whose host was removed or paired again shows **unknown host** and
  matches nothing. If two hosts share a daemon name, a project known only by its folder does not
  match a rule for one host, and the screen says so.
- **By hand**: **Assign** on a project with no client pins it to a client, and **Projects pinned by
  hand** lists the pins (**Let go** undoes one). A pin beats the rules.

Each rule form shows how many projects it matches right now. **Suggest from what I have** offers
one client per owner of the remotes the app has seen (`github.com/acme`, an Azure DevOps
organization), largest first; nothing is created until you click, and an owner that already has a
client gets the rule added to it. Projects no rule or pin claims are **No client**; the screen
counts them. **Export clients** shows the setup as text and **Import** merges pasted text by
client id (new ones added, the same id replaced, nothing deleted), to move to another desktop.

**The switcher.** Once a client exists, a menu under the brand in the sidebar picks **All
clients**, one client (with its running or waiting sessions) or **No client** (with its project
count). A mark beside it counts requests waiting in *other* clients. The choice is kept between
starts, and **Ctrl+K** has **Client: <name>** entries. **Alt+Shift+C** switches to the next one: all
clients, each client in order, **No client**, then all again (it does nothing before a client exists).

**What the choice filters.** Sessions (and a client chip on each project header while all clients
are shown), the Board and Workflows project picker, Conversations (a message shows when either of
its sessions is in the client), Budgets (a host's own budgets always show, and a line counts the
ones hidden), Costs, and the Vault. It never filters **Needs you**, the tray, notifications,
budget alerts or the global search, and each request there wears its client's chip. A host's own
**Projects** screen always lists every project.

**Costs and budgets.** On **Costs**, **All hosts** adds the hosts up, **By client** splits the
spend (with **No client**), and a selected client narrows everything; a host that is offline, has
no costs or does not answer is named. The CSV export and the quota charts stay per host. Each
client can have a **monthly limit** (US$): the app looks at it when a host with costs comes online,
when you change it and every ten minutes, warns once a month at 50%, 80% and 100% (a notification
and a line in **Needs you**), and **does not hold cards**: the limits of each host and project stay
on the hosts.

**Defaults.** Each client can set a **default persona** (preselected in **New session** from the
folder you choose, and in **Claude here**; you can change it, and a persona the screen was opened
with wins) and a **snippet tag** (the client's snippets come first on **Snippets** and in
**Ctrl+K**, and a new snippet starts with it). Cards keep the project's persona per column.

**Vault.** A client can name a **vault tag**: with the client selected, secrets with the tag come
first in the **Vault**, then those of no client, then other clients' (nothing is hidden), and a new
secret starts with the tag. The Clients screen lists, read-only, a tagged secret with a rule that
allows or asks for another client's project, or whose allowed hosts include one that holds none of
the client's projects. **Keep the secrets with this tag in the client's projects only** is opt-in:
after a confirmation that shows how many rules each secret gets, the app sends the hosts, in front
of the secret's own rules, an **ask** rule per project of the client and a **deny** for Claude,
automations and workflows anywhere else (your own use in the app is not denied, and the daemon
still holds the rules to its ceiling). These rules are generated, not saved: the rules editor shows
only yours and says how many come before them, they follow the client's projects (with a notice),
and turning the scope off sends exactly your own rules again. The scope holds only while **this**
desktop writes the secret's rules: if another app saves them on a host, the app notices on connect,
says so and sends them again; a host that refuses them (the daemon takes at most 200 rules per
secret) is named, and the secret is then not held in its client on that host.

## Session summary and webhooks

A terminal session's page shows a short **summary**, and the app can post a message to **Slack,
Discord or any HTTPS endpoint** when something needs you.

### The summary

- It is built by the host from the session's transcript, **with no model call**, so it costs
  nothing: what was **asked** (your first real prompt), what was **done** (Claude's last text), the
  **files** it edited or wrote (at most 12, then "and N more"), the **cost** (from the usage the
  host already indexed) and the **open question** when a request is waiting.
- Each field is cut to a fixed size. A field that holds a secret (a token, a key, a password typed
  on the line, a vault value) is replaced by `[secret hidden]`, in the app and in every message.
- **Copy summary** puts the lines on the clipboard. A host without the feature shows no panel.
- It is a card in the session's header: **open the first time** you see a session, then **folded to
  one line** (the done text, cut) until you open it with the arrow. It pushes the conversation down and never overlaps it.
- It shows on terminal sessions and on the sessions Flightdeck starts (once Claude Code has named the session).

### Webhooks

Open **Settings → Webhooks**.

- **Add a webhook:** a name, a type, the address, the hosts and the events.
  - **Slack:** an incoming webhook (`https://hooks.slack.com/services/...`).
  - **Discord:** a channel webhook (`https://discord.com/api/webhooks/...`). Nobody is pinged by a
    session title.
  - **Generic JSON:** your own endpoint, with a **signing secret**.
- **Events:** *needs you* (a permission or a question), *session ended*, *session failed*, *budget
  alert* and *PR watch* (a watched PR needs you). Each webhook picks the ones it wants.
- **Hosts:** *all hosts*, or one. An event from a host goes to the webhooks of all hosts and to that
  host's.
- **The address is a secret.** It is kept in the vault, never in the settings, a log, an export or a
  print. The list shows only the host it sends to (`hooks.slack.com`). On *Edit*, an empty address
  field keeps the current one. Removing a webhook deletes its secret.
- **Test** sends a sample message once and shows the HTTP status and the time, never the answer's
  body. A good test also gives a stopped webhook a fresh start.
- **Only while the app runs.** Webhooks are sent by the app, because the vault is the app's. If the
  app is closed nothing is sent, and the screen says so. They also need one online host: the app
  hands the address to it for that one post, over the vault's transport (loopback or Tailscale), and
  the host never stores or logs it.

**How it sends.** One message at a time per webhook, at most one per second. Several events of the
same kind that wait together become one message ("3 × needs you"). A network error, a timeout, a
`5xx` or a `429` is retried after 2 s, 8 s and 32 s (more if the receiver sent `Retry-After`), up to
four tries. Any other `4xx` or a redirect stops the webhook at once and marks it *failing*, with the
status: fix the address, or press Test or Edit, to start again. At most 100 messages wait per
webhook; the oldest are dropped.

**What the host refuses.** The host posts only to `https://` addresses (plain `http://` only to
`localhost`, `127.0.0.1` or `[::1]`), without a user or password in the address, without following a
redirect, with a 10-second limit, and **never to a private, loopback, link-local, shared (100.64/10)
or reserved address** after resolving the name. Such a request counts as a permanent failure (shown
as HTTP 400). Only `Content-Type` and `X-Flightdeck-*` headers go out, and a body is at most 100 KB.
One limit: the name is checked, then connected to; a receiver that changes its DNS answer between
the two is not caught.

**The generic message.** A `POST` of JSON: `id`, `kind`, `host`, `project`, `title`, `at`, `detail`
and `summary`. The headers carry the event (`X-Flightdeck-Event`), a unique id to ignore repeats
(`X-Flightdeck-Delivery`), the time in Unix seconds (`X-Flightdeck-Timestamp`) and the signature
`X-Flightdeck-Signature: sha256=<hex>`, the HMAC-SHA256 of `<timestamp>.<body>` with your signing
secret. To verify: recompute it from the raw body, compare in constant time, and refuse a timestamp
older than five minutes (so a captured message cannot be replayed).

```js
const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
const fresh = Math.abs(Date.now() / 1000 - Number(timestamp)) < 300;
const ok = fresh && timingSafeEqual(Buffer.from(signature), Buffer.from(`sha256=${expected}`));
```

## Tabs and embedded terminal

### Tabs

Every screen opens in a tab, as in a browser. Each tab keeps its own back and forward history.

- **Opening:** a normal click changes the current tab. `Ctrl+click`, the middle mouse button or
  **Open in new tab** (in the host's menu and in a session row's menu) opens a new one. The **+**
  button at the end of the bar opens a new tab on the `Ctrl+K` palette.
- **The bar:** each tab shows its type's icon and title, and a badge when a session in it needs
  you, is running, or answered while no tab showed it (**Unread**). **Pin** keeps the tab at the
  left with its icon only. The pin, move and close buttons after the tabs act on the active one;
  the middle button closes any tab. Drag a tab onto another to reorder it. While dragging, a bar marks where the tab will land. The order is kept between sessions.
- **Shortcuts:**

  | Shortcut | Action |
  | --- | --- |
  | `Ctrl+T` | new tab, on the palette |
  | `Ctrl+W` | close the tab |
  | `Ctrl+Shift+T` | reopen the last closed tab (the last 20 are kept) |
  | `Ctrl+Tab` / `Ctrl+Shift+Tab` | next and previous tab |
  | `Ctrl+1`…`Ctrl+9` | go to that tab (`Ctrl+9` is the last one) |
  | `Ctrl+Shift+PageUp` / `PageDown` | move the active tab left or right |
  | `Ctrl+Shift+←` / `→` (on a focused tab) | move that tab left or right; a screen reader is told its new place |
  | `Ctrl+\` | split the window or join the areas |

  In the demo's web entry, Chromium keeps `Ctrl+T`, `Ctrl+W` and `Ctrl+Shift+T` for itself: use
  the buttons there.
- **Kept between starts:** the tabs, which ones are pinned, the active tab, the split and the
  divider come back when the app opens again. Each tab comes back on its screen, without its
  history. The host form is never kept, since it can hold a token. A tab of a host that is not
  connected yet shows **Connecting to <host>…** until it is.

### Split view

`Ctrl+\` or **Split the screen** (at the end of the first tab bar) divides the window in two
areas, side by side; **Split horizontally** stacks them instead, and **Join the areas** puts every
tab back in one. Each area has its own tab bar.

- The new area starts on the screen of the active tab.
- A click in an area makes it the focused one: what you open from the sidebar, the palette or a
  link goes there.
- Drag the divider, or focus it and use the arrows, to give an area between 20% and 80% of the
  window.
- **Move tab to the other area** sends a tab across; an area left empty closes.

### Embedded terminal

A daemon from version 0.14 opens real terminals (a PTY) on its host, and the app shows them in a
tab, with no SSH.

- **On or off:** a terminal is a full shell on the host, as the daemon's user. It is on by itself
  only when the daemon listens on loopback; with `bind` open to other networks it is off. The
  host page's **Terminal** panel turns it on (it asks first) or off (which ends the open
  terminals); the daemon writes the choice to `terminal.enabled` in its config.
- **Opening:** **New terminal** on the host page, or **New terminal on <host>** in the palette,
  opens the host's default shell (`pwsh` or `powershell` on Windows; `$SHELL`, `bash` or `sh` on
  Linux) in its first allowed folder. The panel also lists the live terminals, each with
  **Open**.
- **In the tab:** copy and paste with `Ctrl+Shift+C` / `Ctrl+Shift+V` or the right button's
  menu (**Copy**, which needs a selection, **Paste** and **Select all**; `Ctrl+C` goes to the
  process). Search with `Ctrl+Shift+F`: matches are highlighted as you type, with the current one
  in another color and its position ("2 of 5") beside the box; Enter or **Next match** goes to
  the next one, Shift+Enter or **Previous match** to the previous, Esc or **Close search**
  closes. Links in the output open in the browser (`http` and `https` only). The font is the
  system monospace; its size is in Settings (**Terminal font size**, 10 to 24).
- **Detach and reopen:** a terminal survives the app: it keeps the last 2 MB of output, and
  attaching again shows them. Closing a terminal tab asks: **Detach** (the default; the process
  keeps running on the host) or **End process**. A terminal shown as detached or ended has
  **Reopen**.
- **Limits:** 10 live terminals per host (`terminal.max`), and a terminal nobody is attached to is
  ended after 120 minutes (`terminal.idleMinutes`). Terminals do not survive a restart or an
  update of the daemon. Their content never goes to the log or to the database.

### Claude here

When the host's terminals are on, every **Open in terminal** button (session, card, project,
checkpoint) gets a companion:

- **Open Claude here (terminal)** opens `flightdeckd claude` in the folder (the card's worktree
  for a card) in a terminal tab. The session is born in the central, controllable: you approve
  and send messages from the app while you watch the terminal.
- **Continue in the terminal** resumes a session with `flightdeckd claude --resume <id>`; ended
  terminal sessions and history sessions have it in the reader.
- The terminal tab of such a session has **View as session**, and the session has **View
  terminal**: both are the same Claude, tied by the launch id.

The outside terminal ([Open in terminal](#open-in-terminal)) stays next to them.

## Daily use

### Needs you, host page and notifications

- **Needs you:** in the sidebar, with the count of open requests across all hosts. The screen
  lists the requests, oldest to newest, and the selected request's card sits next to it: **A**
  approves, **N** denies and **Esc** closes the detail. **Open session** takes you to the
  conversation.
- **Host page:** click the host name to see system, versions, active sessions, heartbeat
  latency, rename, reconnect and remove. A host that passes the API key on to Claude gets a ⚠
  badge. The uptime keeps counting while the page is open.
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

### Tray

The tray icon has Open, the **Needs you (N)** submenu and Quit. The submenu lists up to 10 open
requests, from managed and terminal sessions, oldest to newest, as `host · session · tool: input
summary` (for example `pc · api · Bash: npm test`).

- Each request opens a submenu with **Approve**, **Deny** and **Open**. Approve and Deny answer
  on the request's host, without opening the window; Open brings the app to the session, with
  the approval card.
- Workflow gates appear only with **Open**: they need reading, and the answer is given on the
  card.
- Above 10, the last row is **and N more…**, which opens the app.
- The submenu is rebuilt half a second after the list stops changing.
- **Request notification:** carries the link `flightdeck://request?host=…&request=…`, which opens
  the app focused on the request. In the desktop app, Tauri's notification plugin does not
  report clicks on Windows or Linux: there, the tray is the quick path. Opening the link from
  outside (for example `start flightdeck://request?...`) works.

### Open in terminal

The **Open in terminal** button appears on the session (managed and terminal), on the card (its
worktree) and on each project of the Projects screen. The session is resumed with
`flightdeckd claude --resume <id>`, and the project opens a fresh `claude` in the folder.

| Host | What runs |
| --- | --- |
| This Windows (daemon on `127.0.0.1`) | `wt.exe -d <folder> <flightdeckd> claude --resume <id>`; without Windows Terminal, `cmd.exe /c start "" /d <folder> cmd /k <flightdeckd> claude …` |
| Supervised WSL (Linux daemon on `127.0.0.1` inside a distro) | `wt.exe wsl.exe -d <distro> --cd <folder> -- <flightdeckd> claude …` (without Windows Terminal, through `cmd /c start`) |
| Any other | the button becomes **Copy command**: `cd <folder> && <flightdeckd> claude --resume <id>` |

- `<flightdeckd>` is the stable binary (`~/.flightdeck/bin/flightdeckd`, from the
  [update](#updating-with-flightdeckd-update)) when it exists on the host, otherwise
  `flightdeckd` from the PATH. The daemon reports both, and the WSL distro, in `host.info`.
- The command comes from the app's Rust shell, with the arguments as a list, without going
  through a shell, except for the fallback's `cmd /k`. It only accepts `wt.exe` and `cmd.exe`.

### Palette Ctrl+K

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
- With nothing typed, a **Recent** section comes first with the last five entries you opened
  (kept between runs). **Actions** also has **Go to Sessions / Needs you / Projects**, **Show the
  keyboard shortcuts** and, while a request waits for you, **Approve the oldest request** and
  **Deny the oldest request** (a high-risk request is opened to be held, as in the tray). Each
  command shows its keys at the right.

### Keyboard shortcuts

`?` (outside text fields) opens a sheet with every shortcut, by group. The go-to chords press `g`
and then a letter within about a second and a half: `g s` Sessions, `g n` Needs you, `g p`
Projects, `g c` Costs, `g ,` Settings. Other shortcuts: `Ctrl+K` palette, `Alt+←`/`Alt+→` back and
forward, `Alt+Shift+C` next client, `Ctrl+T`/`W`/`Tab`/`1…9` tabs, `j`/`k`/`Enter` in lists and
`A`/`N` on a request. None of them fires while you type in a field.

### Global shortcut

`Ctrl+Alt+F` brings the app to the front with the global search open, even with it in the
background or in the tray. To change it, open **Settings → Global shortcut**, type the
combination and click **Save shortcut**.

- Format `Modifiers+Key`, for example `Ctrl+Shift+Y`. The key is a letter, a digit or `F1` to
  `F24`, and at least `Ctrl`, `Alt` or `Super` is required.
- `Ctrl+K` is refused: it opens the search inside the app and, as a global shortcut, would
  collide with the browser and VS Code.
- If another program already uses the combination, the app warns and opens Settings for you to
  choose another. The shortcut is only saved after the system accepts it.

## Interface

### Design and navigation

The app follows a single design, in the style of Linear: bundled Inter (no network), a 13 px
base, layered surfaces, a single accent token and the session state as an 8 px dot (running in
blue, needs you in amber, idle in gray, ended faded, error in red).

- **Sidebar:** logo, navigation (Sessions, Needs you with its counter, Board, Workflows, Costs,
  History), the hosts, the pinned sessions and, at the bottom, search (`Ctrl K`), Settings and
  the theme. It collapses to a 56 px icon rail, by itself below 960 px.
- **Three columns** in Sessions, Needs you and History: the list on the left (adjustable,
  remembered width), the session, request or transcript on the right. Board, Costs, Settings and
  the host pages use the full width. The header shows the path (Sessions > session, History >
  host, Board > project > card).
- **Keyboard:** `J` and `K` move through the list, `Enter` opens, `Esc` closes the detail, `A`
  and `N` approve and deny, `Ctrl K` opens the palette, `Alt+←` and `Alt+→` go back and forward.
- **Density:** compact rows (32 px, the default) or comfortable (40 px), in Settings.
- **Theme:** Light, Dark and System (the default), in Settings, in the sidebar and in the
  palette. The choice is remembered.
- **Language:** the system's (`pt-BR` for any `pt-*`, `en` for the rest), switched in Settings or
  in the palette, without restarting. Dates and times are always shown in local time. The
  vocabulary is in [`docs/GLOSSARY.md`](../GLOSSARY.md).
- **Permission modes** are shown with a name and a one-line explanation, never with the technical
  value; "Bypass permissions" warns in red and is offered only on a host that allows it.

### Demo mode, screenshots and end-to-end tests

```bash
bun run demo         # starts two fake hosts (fake runtime, seeded data) and the app's web entry,
                     # already paired, at http://localhost:1420
bun run demo:shots   # the screenshots, in 2 themes and 2 languages, in
                     # apps/desktop/screenshots/ (and axe-core, which fails serious and critical)
bun run e2e          # the five journeys in a real browser, in 2 languages, and the layout check
                     # at 1280x800 and 800x600 (runner: @playwright/test; E2E_ONLY=a,b picks
                     # journeys; -- --repeat-each 5 repeats them; report in playwright-report/)
```

Nothing leaves the machine and no real data is used. The scripts use the installed Chrome (or
Edge) through `playwright-core`; in CI, the `screenshots` job runs all three and publishes the
screenshots.

### Performance

What keeps the app and the daemon light, and the numbers you can read yourself.

- **Long lists.** The hub shows the first 200 sessions of a host; **Show N more** adds the rest.
  A host reconnecting, or another host's summary changing, does not redraw the screens that do
  not show it.
- **Live text.** The daemon groups the streamed words of a reply into one frame every 25 ms
  instead of one frame per word, so a phone over a slow link keeps up. The order and content are
  the same; a client that is behind is resynced, not left to fall further.
- **Terminal.** The daemon stops reading a terminal's output while the app is far behind (a
  `yes` or a `cat` of a big file), and resumes when the app catches up. A terminal whose app
  never catches up is resynced from its saved output. The keys you type stay responsive.
- **On demand.** The editor, the Markdown renderer and the age library load when you first open
  something that needs them, so the app starts faster. A daemon with nothing to do keeps no
  running timers for features that are off (automations, budgets, PR watch).
- **Debug measures.** To time the five most used actions (open a session, a board, a card; send;
  approve), run `localStorage.setItem("flightdeck.debug.measures", "1")` in the console of a
  debug build and reload. The entries `fd:open-session`, `fd:open-board`, `fd:open-card`,
  `fd:send` and `fd:approve` then show in the browser's Performance panel (or
  `performance.getEntriesByType("measure")`). Nothing is written to the log or the console, and
  with the flag off nothing is measured. `send` and `approve` end when the daemon has answered.
- **Numbers for developers.** `bun run perf:baseline` prints the baseline,
  `bun run bundle:budget` the size of each chunk (the build fails above the budget) and
  `bun run smoke:perf` runs the daemon against a flood of output.

## Host operations

### Versions and compatibility

- **One version:** the app, the daemon and the protocol ship with the same version (0.14.0 in
  this documentation). `flightdeckd --version` prints `flightdeckd <version> (protocolo 1)`.
- **In the app:** the host page shows the daemon version, the app version and the `claude`
  version. A daemon of a different version gets the **≠** badge ("different version from the
  app's") in the sidebar: it works, but update when you can.
- **Protocol:** the app sends its protocol version in `hello`. If the daemon does not accept it,
  the host becomes **incompatible: update the daemon**, with the command on the host page. It
  does not try to reconnect and drops out of the lists (sessions, search) until it is updated and
  reconnected.
- **Features:** `host.info` announces what the daemon has (`central`, `workflows`,
  `maintenance`…), and the app hides what the host does not announce. A daemon older than Phase 7
  announces nothing and keeps showing up as before, without the Maintenance section.

### Updating with flightdeckd update

```sh
flightdeckd update --from <new binary> [--allow-downgrade] [--config <file>]
```

`update` always installs to `~/.flightdeck/bin/flightdeckd` (`flightdeckd.exe` on Windows):

1. Runs `<new binary> --version` and refuses anything that does not answer as a `flightdeckd`. A
   version lower than that of whoever runs `update` only passes with `--allow-downgrade`.
2. With the daemon running outside the service, it refuses: "stop the daemon and run again".
   With a service:
   - asks the daemon for `daemon.shutdown` and stops the service;
   - waits for the daemon to release the `dataDir`;
   - if the lock stays held, it terminates the process, but only if it is the service's
     executable.
3. Keeps the current binary as `flightdeckd.old` (`.exe.old`) and puts the new one in place.
4. If the service pointed to another path (for example `dist/` or `~/.local/bin`), it reinstalls
   the service at the stable path, with the same `--config`. The Claude Code hooks are rewritten
   only if they were already installed and point elsewhere. The output says what was rewritten.
5. Starts the service and waits for `GET /health` to answer for up to 30 s. Without `--config`
   on `update`, the port comes from the service's config. If the new daemon does not come up:
   - the `.old` goes back into place;
   - the service goes back to the previous path and config and starts again;
   - the command exits with 1.

   The `.old` of a successful update is deleted on the next one.

Without an installed service, `update` only installs the binary and says how to start it. Use the
installed binary to run `update` (it compares the new version with its own); the first time, run
the new binary itself.

- **Windows:** `bun run build:daemon`, then
  `~\.flightdeck\bin\flightdeckd.exe update --from dist\flightdeckd-windows-x64.exe` (the first
  time, `dist\flightdeckd-windows-x64.exe update --from dist\flightdeckd-windows-x64.exe`).
- **WSL:** copy the Linux binary into the distro and run `update` there:
  `cp /mnt/<drive>/<repo>/dist/flightdeckd-linux-x64 ~/` and
  `~/.flightdeck/bin/flightdeckd update --from ~/flightdeckd-linux-x64`.
- **Remote Linux (VPS, Orange Pi):** `scp dist/flightdeckd-linux-arm64 <host>:~/` and, on the
  host, `~/.flightdeck/bin/flightdeckd update --from ~/flightdeckd-linux-arm64`.

### Signed automatic update

Each release ships the installers and the daemons signed with the project's key (minisign,
generated by `tauri signer`). The public key is in
[`release/flightdeck.pub`](../../release/flightdeck.pub), and the app and the daemon only accept
what it signed. This applies to updates: the Windows installer itself has no Authenticode
signature (see [Installation](#from-the-release-binaries)).

- **The app:**
  - looks for a new version on open and every 6 h, in the latest release's `latest.json`;
  - with a new version, shows the banner "Flightdeck X available", with the notes, **Install and
    restart** and **Later**;
  - an invalid signature or a broken download shows up in the banner, and nothing is installed;
  - in **Settings**: **Check for updates now** and **Notify about updates** (on by default).
- **The daemon:**
  - checks `daemon-latest.json` on start, when asked, and every `updates.checkIntervalH` (6 h by
    default);
  - on the host page, the app shows **Update daemon to X** when there is a new version, and asks
    for confirmation;
  - the host page also shows when the daemon last checked, and the error of that check if it
    failed, with **Check for updates**: it asks the daemon to look at the manifest now (command
    `daemon.update.check`). When the app is newer than the daemon, the page does this once by
    itself when you open it, at most once every 10 minutes per host. A daemon from before this
    command refuses it, and the page says why; update that one by hand with `flightdeckd update`;
  - the daemon downloads the binary for its own system to `<dataDir>/updates/`, verifies the
    sha256 and the signature, and runs `flightdeckd update --from` outside the service, to
    survive its own stop: a one-off `Flightdeck\update` task on Windows and `systemd-run --user`
    on Linux;
  - the host shows "updating…" until it reconnects on the new version.
- **Order:** with the app and the daemons both out of date, the banner suggests updating the app
  first.

```json
{ "updates": { "manifestUrl": "https://github.com/jnerytech/flightdeck/releases/latest/download/daemon-latest.json",
               "checkIntervalH": 6 } }
```

Only the compiled `flightdeckd` checks GitHub by default. When running from source there is no
binary to update, and the default `manifestUrl` is `null`.

**When it fails:**

- **"the daemon does not run as a service":** updating from the app needs the service. Install it
  with `flightdeckd service install`, or update by hand with `flightdeckd update --from`.
- **Verification refused** (sha256 or signature): the downloaded file is deleted and nothing
  changes. Download again from the Releases page and check `SHA256SUMS`.
- **The host does not come back in 2 minutes:** the host page shows the manual command. On the
  host, run `~/.flightdeck/bin/flightdeckd service status` and, if needed,
  `flightdeckd update --from` with the release binary. `update`'s automatic rollback restores
  the previous version when the new one does not come up.

### Retention

```json
{ "retention": { "eventsDays": 90, "externalSessionsDays": 30 } }
```

- **Deletes:** events and permission requests of managed sessions ended more than `eventsDays`
  days ago, and external sessions ended more than `externalSessionsDays` days ago. `0` deletes as
  soon as the session ends.
- **Never deletes:** live sessions, pinned sessions, sessions of cards outside Done (including the
  workflow steps of those cards), the cards, the workflow runs, and the session names and marks.
  The history index follows the transcripts and is left out.
- **When:** at daemon boot and every 24 h. By hand, `flightdeckd db prune [--dry-run]` shows the
  count per table; in the app, the host page's **Maintenance** section has **Simulate** and
  **Clean** (which asks for confirmation).
- A cleaned conversation shows up as "conversation removed by retention".
- Cost usage has its own retention: `retention.usageDays` (see [Costs](#costs)).

### Backup and restore

```json
{ "backup": { "enabled": true, "keep": 7 } }
```

- **Automatic:** once a day, `VACUUM INTO <dataDir>/backups/flightdeck-<YYYYMMDD-HHmmss>.db`
  (UTC time), keeping the last `keep`. Works with the daemon running.
- **By hand:** `flightdeckd backup [--out <file>]`, or **Back up now** in the Maintenance
  section. The files are owner-only (0600 outside Windows).
- **Restoring:** `flightdeckd service stop`, then `flightdeckd restore <file>`, then
  `flightdeckd service start`. Without a service, stop the daemon by hand before `restore`. The
  command refuses to run with the daemon up, checks integrity and that the backup does not come
  from a newer version, and keeps the current database as `flightdeck.db.before-restore`. Any
  missing migrations run on the next boot.
- **`config.json` is not in the backup**, because it holds the tokens: keep a copy separately.

## Deploy

`bun run deploy <alias>` reads `deploy.hosts.json` at the root (outside git):

```json
{ "pi": { "ssh": "ubuntu@orange", "target": "linux-arm64", "path": "~/.local/bin/flightdeckd" } }
```

It builds the target, copies it with `scp` to `<path>.new`, swaps the binary, restarts with
`systemctl --user restart flightdeckd` over `ssh` and checks `systemctl --user is-active`.

After the first [`flightdeckd update`](#updating-with-flightdeckd-update), the service starts
running `~/.flightdeck/bin/flightdeckd`: set the `path` in `deploy.hosts.json` to that path.

## Releases

- **Continuous integration** ([`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)):
  every push to `main` and every pull request run, on Ubuntu and Windows:
  - typecheck, lint and the tests with 100% coverage;
  - all the smokes (`smoke`, `smoke:multi`, `smoke:history`, `smoke:board`, `smoke:central`,
    `smoke:workflow`, `smoke:ops`, `smoke:limits`, `smoke:update` and `smoke:costs`);
  - on Windows, also the app's `cargo check`.

  A separate job, `screenshots`, runs `demo:shots` and `e2e` on Ubuntu and publishes the
  screenshots.
- **Version:** `packages/protocol`, `apps/daemon` and `apps/desktop` are bumped together, and
  `tauri.conf.json` reads the desktop's version. A test fails if the versions diverge.
- **Publishing:** only the orchestrator pushes the `v<version>` tag, after the version is on
  `main`. [`.github/workflows/release.yml`](../../.github/workflows/release.yml) runs on Windows:
  1. `bun run release:version <tag>`, which refuses a tag that does not match the product
     version;
  2. `bun run release:tauri-config`, which builds the app's build config with the public key and
     the updater endpoint, and fails if `release/flightdeck.pub` is not a valid public key;
  3. `bun run build:daemon`, which produces the three daemons;
  4. `bun run release:sign`, which signs the daemons;
  5. `bun run tauri build --bundles nsis,msi` in `apps/desktop`, which produces the installers
     (with the updater's `.sig` signature);
  6. `bun run release:assets`, which gathers the files, the signatures and the manifests
     (`latest.json`, `daemon-latest.json`) in `release-assets/` with the `SHA256SUMS`;
  7. `gh release create <tag> --generate-notes`, with those files.
- **Re-running a publication:** through `workflow_dispatch`, passing the tag, which must already
  exist.
- **Environment:** the job uses the `GITHUB_TOKEN`, with `contents: write`, and the secrets
  `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, only to sign the updates
  (minisign). The Windows installers ship without an Authenticode signature.

## Development

```sh
bun run typecheck      # tsc in every workspace and in the scripts
bun run lint           # Biome
bun test               # all tests, with a 100% coverage threshold (lines and functions)
bun run test           # bun test + makes sure no source file was left out of the measurement
bun run smoke          # end to end with the real daemon and --runtime fake; prints SMOKE OK
bun run smoke:multi    # two daemons, one client, permission via session.summary; SMOKE MULTI OK
bun run smoke:history  # indexes, searches, resumes and sees history.changed; SMOKE HISTORY OK
bun run smoke:board    # card with a fake gh and a local remote up to the merged PR; SMOKE BOARD OK
bun run smoke:central  # hooks, flightdeckd claude with the fake claude, approval and channel; SMOKE CENTRAL OK
bun run smoke:workflow # the whole example workflow, fake check and gh, up to the merged PR; SMOKE WORKFLOW OK
bun run smoke:limits   # quota and quota queue, project rule, bypass refusal and hook with updatedPermissions; SMOKE LIMITS OK
bun run smoke:ops      # host operations: maintenance (backup, prune), incompatible protocol, restore
bun run smoke:update   # local release server, daemon-latest.json, signed binaries and refusal of a tampered one
bun run smoke:costs    # costs from fixture transcripts, a budget that holds a card, CSV export
bun run tdd:audit -- --since fase-5   # every feat/fix has a test commit of the same scope before it
bun run build:daemon   # binaries in dist/
bun run build:desktop  # Vite frontend in apps/desktop/dist
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml   # requires apps/desktop/dist
```

Since Phase 2, development is TDD ([`docs/TDD.md`](../TDD.md)): each area's test is born red,
runs on its own with `bun --config=bunfig.area.toml test ./<file>` (same bunfig, without the
global coverage threshold) and is committed as `test(<area>)` before the `feat(<area>)`. The
preload of both bunfigs installs a guard that fails the suite if any test runs the real `claude`,
and another that points `HOME`/`USERPROFILE` at a temporary folder, so no test reads the real
`~/.claude`. The check guard (Phase 6) only lets a workflow `check` reach the shell if the
command is a fake installed by the test itself. The smokes (except `smoke:real`) use the same
guards. The transcript fixtures live in `apps/daemon/test/fixtures/history/` and are written by
hand.

Tests and smokes use only the `FakeRuntime`. `bun run smoke:real` repeats the script with the
real Claude in a throwaway folder. It is manual, spends quota and is not part of the acceptance
criteria.

Other `package.json` scripts: `bun run coverage`, `bun run format` (Biome with `--write`),
`bun run ui:lock` (writes `apps/desktop/components.lock.json`, the hash of each shadcn/ui
component as the CLI generated it), `bun run release:version`, `bun run release:assets`,
`bun run release:tauri-config` and `bun run release:sign` (the last four are used by the
[release](#releases)).

## Simple mode

Simple mode is a calmer face of the same app, for people who do not use a terminal. It changes only
how a host looks, not what it can do: the sessions, the permissions and the files are the same.

**What you see.** A narrow menu with three places: *Home*, *Files* and *Settings*.

- *Home* asks "What do you want done?" and shows ready-made tasks as cards (summarise a folder,
  draft a report, review a document, compare files). A card asks for one to three things, such as a
  folder, and starts the task. Tasks that wait for you come first, then your recent tasks.
- A *task* shows what it is doing in a line, asks its questions in plain words with **Yes, go ahead** and
  **No, don't** (and says when something cannot be undone), and when it is done shows a summary and the
  files it made. Open a file, show it in its folder, or ask for changes. *Show details* opens the
  full view of the session.
- *Files* lists what your recent tasks made, newest first.
- *Settings* has the language, the theme, the folders tasks may use, notifications and *Show
  everything*, which goes back to the full app after a confirmation.

**Safety.** A task never skips questions: it can only read, ask before it changes things, or edit
the chosen folder. Results go to a *Flightdeck results* folder next to your files. Simple mode hides
things, it does not protect them: a person in full mode can do everything the host allows.

**Switching.** In full mode, open a host's page and use the *Simple mode* panel: *Use simple mode on
this host* is your own choice, kept in this app. *Make simple mode the default for this host* sets
what the next person sees. *Lock this host to its mode* removes the switch for everyone: a locked
host stays in its mode and *Show everything* is not offered. Unlock it from the same panel.

**Your own templates.** A host can add tasks as Markdown files in `templates/` inside the daemon's
data folder: a header with the title, icon, fields, preset and whether to plan first, then one
prompt section per language (`# en`, `# pt-BR`). A file with a problem is skipped and the host's
health check (*doctor*) lists it.
