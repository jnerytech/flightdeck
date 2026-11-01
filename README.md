# Flightdeck

English | [Português (Brasil)](README.pt-BR.md)

[![CI](https://github.com/jnerytech/flightdeck/actions/workflows/ci.yml/badge.svg)](https://github.com/jnerytech/flightdeck/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Quality Gate](https://sonarcloud.io/api/project_badges/measure?project=jnerytech_flightdeck&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=jnerytech_flightdeck)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=jnerytech_flightdeck&metric=coverage)](https://sonarcloud.io/summary/new_code?id=jnerytech_flightdeck)
[![Bugs](https://sonarcloud.io/api/project_badges/measure?project=jnerytech_flightdeck&metric=bugs)](https://sonarcloud.io/summary/new_code?id=jnerytech_flightdeck)
[![Vulnerabilities](https://sonarcloud.io/api/project_badges/measure?project=jnerytech_flightdeck&metric=vulnerabilities)](https://sonarcloud.io/summary/new_code?id=jnerytech_flightdeck)
[![Maintainability](https://sonarcloud.io/api/project_badges/measure?project=jnerytech_flightdeck&metric=sqale_rating)](https://sonarcloud.io/summary/new_code?id=jnerytech_flightdeck)

**One desktop app to see, approve and drive every Claude Code session on all your machines.**

## What is Flightdeck

Flightdeck is a desktop app (Tauri 2 + React, Windows first) that centralizes your Claude Code
sessions across several hosts. Each host runs a small daemon, `flightdeckd` (Bun + TypeScript,
SQLite, WebSocket), that hosts sessions through the official Agent SDK and watches the ones you
start in a terminal. The app connects to every daemon, so you can follow, approve and message
sessions from one place, without opening each machine.

![The Flightdeck session hub](docs/images/hub-dark-en.png)

## Features

**Sessions**

- One hub for the sessions of all your hosts, grouped by project, with live state and a summary
  line for each.
- Sessions started in a terminal show up too, through opt-in Claude Code hooks.
- Approve or deny tool requests from the app, and send messages to terminal sessions started with
  `flightdeckd claude`.
- "Always allow" rules written to the project's local Claude Code settings, never to your global
  ones.

**Work**

- A board per project: each card is a git worktree plus a session, with pull requests on GitHub
  and Azure DevOps.
- YAML workflows with agents, checks, approval gates, loops, parallel steps and budgets.
- Issues from GitHub or Azure Boards turned into cards, automations (schedules, PR comments,
  failed checks, labels), and an arena that runs one request in 2 to 4 variants to compare and choose.
- Risk seals on every permission request: a high-risk one asks you to hold the button for 2 seconds.
- SSH destinations (Termius-style, with the host's OpenSSH): import `~/.ssh/config`, check and pin
  the server key, connect in a terminal screen, and a red border for `prod`.
- A vault for secrets (SSH keys, passwords, tokens, env sets): values live in the system credential
  store, are revealed only after you type a word, and leave in an encrypted backup you choose.
- Actions: you declare a command with places for vault secrets and parameters, and Claude calls it
  by name (MCP tools `list_actions` and `run_action`, or the `flightdeck` mod) without ever
  receiving the secret. It gets the exit code and the output (up to 32 KB) with the secret masked.
- Messages between sessions, on any host: a session lists the others it may see, sends to one
  (`send_to_session`), asks to hear when one goes idle and reads one (MCP tools or the `flightdeck`
  mod). Across hosts the app carries them, and a message waits up to 24 hours for it. Every session
  gets a standard name, `project · persona · number` (`flightdeck · revisor · 3`), and an alias
  that addresses it (`flightdeck-revisor-3`).
- Teams: a coordinator session splits a goal into tasks, dispatches each to a worker in its own
  card, checks the work itself and accepts only a green commit. The app has Conversas, Times and a
  Mensagens tab per session; a team pauses by itself when the plan quota crosses the limit.
- Snippets: saved commands and prompts (global, per host or versioned in the project), used from
  Ctrl+K, a terminal tab or `/` in a session, imported from the shell history with secrets hidden.
- Memory, context and plugins: the Claude Code memory of a project (read, edited with a hash and a
  confirmation, with cleanup suggestions) and the budget of what enters the context at the start;
  the plugins of the host, each shown with what it installs (hooks, monitors, skills, agents,
  commands, MCP) before any install, update or removal.
- Personas: engineering roles Claude takes in a session (a pack of ten, plus your own per host,
  project or app), chosen when a session, card or arena variant starts, applied to an open session,
  or offered to Claude as subagents.
- Watch and fix a card's PR: when a build, a policy, a conflict or a trusted comment gets worse,
  the card's session fixes it within round, cost and time limits, runs your local checks and pushes
  only the card's own branch. Paste a PR link in Ctrl+K to find its card or sessions.
- A run environment per card: scripts to prepare and run it from a trusted `.flightdeck/run.yaml`,
  a block of ports of its own so two cards run side by side, each process in a terminal tab, and a
  preview of the running app (loopback only).
- Clients: group projects across hosts by rules (a remote prefix or a folder), with a switcher that
  filters sessions, board, costs, budgets, conversations and the vault, a cost and month-limit
  roll-up per client, and defaults (persona, snippets, vault tag) that never hide an approval.
- Search the history of every host, including sessions that were not started in Flightdeck.
- Review what a session or a card changed: comment on diff lines and send the review to the agent,
  revert or edit files, bring the PR comments to the agent and merge the card locally.
- A timeline per session: go back to the files of any turn (with a preview and an undo), fork the
  conversation from a turn, and edit the project's MCP servers, `CLAUDE.md`, agents and skills.
  Going back covers files only: it does not undo a database, the network or a `git push`.
- Files that are not tracked (such as `.env`) can follow a card into its worktree: list them in
  `.worktreeinclude` at the root of the repository.
- A Claude Code statusline with your quota and cost: set `statusLine` to
  `flightdeckd statusline`. Flightdeck never writes that setting; to keep a statusline you already
  have, call both in one script and join the lines (see the manual).

**Cost and quota**

- Estimated cost per project, model and origin, with CSV export.
- Plan quota bars with a projection of when the window runs out, a quota queue, and budgets in
  US$ that alert you or hold new cards.

**Desktop**

- Tabs with their own history, pinned, reordered and kept between starts, and a split view with
  two areas side by side or stacked.
- An embedded terminal on any host, in a tab, with no SSH: it survives the app and reattaches
  with its scrollback. "Open Claude here" runs `flightdeckd claude` in it, and the session is
  approvable from the app.
- Tray menu to approve requests without opening the window, and a `Ctrl+K` palette.
- Signed auto-update for the app and for the daemons.
- A trace of any session: the tree of its turns, tool calls and subagents with time, cost and tokens, the costliest and slowest marked, a step-by-step replay and an export for a bug report.
- Time and cost of the sessions opened in a terminal, from Claude Code's own telemetry (OTLP, received on this machine only): a slow tool, the time spent waiting for your permissions, API errors.
- Claude Code background sessions (`claude --bg`) in Sessions, with stop, restart, bring to the terminal and a message, and "Start in the background" for new ones.
- Light on resources: long lists, live text and terminal output are capped and batched, heavy pieces load on demand, and `bun run perf:baseline` prints the numbers.
- Light and dark themes; English and Portuguese.

## Screenshots

| Approval, with Always allow | Light theme |
| --- | --- |
| ![Approving a tool request](docs/images/approval-dark.png) | ![The hub in the light theme](docs/images/hub-light.png) |

| Board | Costs |
| --- | --- |
| ![The board](docs/images/board-dark-en.png) | ![The costs screen](docs/images/costs-dark-en.png) |

## Install

Download from the [Releases](https://github.com/jnerytech/flightdeck/releases) page:

| File | What it is |
| --- | --- |
| `Flightdeck_<version>_x64-setup.exe` (or `.msi`) | the desktop app for Windows |
| `flightdeckd-windows-x64.exe`, `flightdeckd-linux-x64`, `flightdeckd-linux-arm64` | the daemon, one per host |
| `SHA256SUMS` | the SHA-256 of each file |

1. **Verify the download.** On Linux: `sha256sum -c SHA256SUMS --ignore-missing`. On Windows
   (PowerShell): `(Get-FileHash .\<file>).Hash.ToLower()`, compared with the line in `SHA256SUMS`.
2. **Run the app installer.** It has no Windows code signature, so SmartScreen shows "Windows
   protected your PC". With the hash verified, click **More info**, then **Run anyway**.
3. **Install the daemon on each host**, with Claude Code installed and logged in. See the Quick
   start below.

Building from source is covered in the [manual](docs/manual/en.md#from-source).

## Quick start

1. **Install the daemon as a service** (on Linux, `chmod +x` the binary first). On Windows use
   `flightdeckd-windows-x64.exe` and `~\.flightdeck\bin\flightdeckd.exe`.

   ```sh
   ./flightdeckd-linux-x64 update --from ./flightdeckd-linux-x64   # installs to ~/.flightdeck/bin
   ~/.flightdeck/bin/flightdeckd service install
   ```

   The commands below assume `~/.flightdeck/bin` is on your `PATH`; otherwise use the full path
   (`~\.flightdeck\bin\flightdeckd.exe` on Windows). The first run creates
   `~/.flightdeck/config.json`. Set `allowedRoots` there to the folders
   where sessions may run (with an empty list no session can be created), then restart:
   `flightdeckd service stop && flightdeckd service start`. For a host other than this machine,
   also set `bind` and `allowedNetworks`
   ([remote access](docs/manual/en.md#remote-access-over-tailscale)).

2. **Pair.** Print a link and QR code for the app:

   ```sh
   flightdeckd pair
   ```

3. **Add the host in the app.** Click **Add host**, paste the `flightdeck://` link, and confirm
   with **Test and add**.

4. **Install the hooks** (opt-in) so terminal sessions show up. You can also use the **Install
   hooks** button on the host page, which needs no restart:

   ```sh
   flightdeckd hooks install    # run service stop / service start if the daemon is already running
   ```

5. **Start Claude Code through Flightdeck** to let the app send messages to the session:

   ```sh
   flightdeckd claude          # same arguments as claude; suggested alias: fd
   ```

## How it works

Each host runs one `flightdeckd`. It starts Claude Code sessions through the Agent SDK, receives
events from the Claude Code hooks, indexes the Claude Code transcripts that already exist on the
host, and stores everything in a local SQLite database. The desktop app opens one WebSocket per
daemon and merges them into a single view. Hosts are independent: nothing is copied between them.

```text
┌───────────────────────┐   WebSocket + token   ┌────────────────────────────────┐
│ Flightdeck app        │◄─────────────────────►│ flightdeckd, host A            │
│ (Tauri 2 + React)     │                       │  Agent SDK sessions            │
│                       │                       │  Claude Code hooks receiver    │
│  hub · board · costs  │   (over Tailscale     │  history index (SQLite)        │
│  tray · palette       │    for remote hosts)  │  git worktrees · PRs           │
│                       │                       └────────────────────────────────┘
│                       │◄─────────────────────►┌────────────────────────────────┐
└───────────────────────┘                       │ flightdeckd, host B  (same)    │
                                                └────────────────────────────────┘
```

## Security model

- **Token per host.** The app connects with a random token stored in the operating system's
  credential store. Tokens never appear in the logs, and `flightdeckd pair --rotate` replaces one.
- **Folders.** Sessions can only be opened inside `allowedRoots`; paths are resolved with
  realpath, so `..` and symlinks out of the roots are refused.
- **Networks.** By default only loopback connections are accepted. Any other origin needs an
  explicit `allowedNetworks` entry, and exposing a port to the open internet is not supported.
- **Opt-in hooks.** The only thing Flightdeck writes to `~/.claude` is the hook entries, and only
  when you ask (`flightdeckd hooks install`). It keeps a backup and `hooks uninstall` removes
  them. Transcripts are only read. "Always in this project" writes to the project's own
  `.claude/settings.local.json`, not to `~/.claude`.
- **Terminals.** An embedded terminal is a full shell on the host. It is on by itself only when
  the daemon listens on loopback; turning it on for a host reachable from other networks asks
  for confirmation. Its content never goes to the log or to the database.
- **Run commands are trusted by hash.** What `.flightdeck/run.yaml` declares runs only after you
  review and trust that exact content, as argv with no shell, in the card's worktree; the preview
  opens only `127.0.0.1` and `localhost`.
- **Nothing is approved without a click.** Workflow `check` commands run only if you trusted the
  workflow, and a changed file asks for trust again.
- **Secrets stay out of the transcript.** An action runs `run` as a list of arguments, never
  through a shell, and a secret goes only to its environment or a temporary file, never to an
  argument. A versioned `.flightdeck/actions.yaml` runs only once you trust it, and the trust pins
  the sha256 of the script it runs, checked again right before each run. `run_with_secret` (a
  command written by Claude) always asks for your approval and is never automatic. The mask covers
  the literal value and its base64, URL-encoded and hex forms, not a value transformed another way.
  **The limit is the operating-system user:** while an action runs, another process of the same
  user (a Claude session with Bash on the same host) can read its environment or temporary file.
  Keep production secrets in `ssh:` actions, which run on a remote host where Claude has no shell.
- **Usage rules per secret.** Each secret has ordered rules (who, for what, when, how often) over
  safe defaults; no rule can allow `run_with_secret` or a `prod` secret outside a time window, and
  a high-risk use always asks.
- **A message is never an approval.** Its header says it comes from another session, not from
  you, and no message answers a permission request. By default only sessions of the same project
  or team talk (exceptions in Settings), with limits per pair and per session; a loop pauses the
  pair and tells you. A session that received third-party content passes that mark on, and
  automatic approval stays off for whoever it messages.
- **Signed updates.** The app and the daemon install only updates signed with the project's key
  ([`release/flightdeck.pub`](release/flightdeck.pub)). The Windows installer itself is not
  code-signed.

## Documentation

- Manual: [English](docs/manual/en.md) | [Português (Brasil)](docs/manual/pt-BR.md)
- Roadmap and specs: [`docs/SPEC.md`](docs/SPEC.md)
- Decisions and deviations from the specs: [`docs/DECISIONS.md`](docs/DECISIONS.md)

The specs, decisions and glossary are written in Portuguese.

## Development

Prerequisites: [Bun](https://bun.sh) 1.4 or newer, and Claude Code installed and logged in. For
the desktop app, stable Rust and the
[Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/).

```sh
bun install
bun run typecheck      # tsc in every workspace and in the scripts
bun run lint           # Biome
bun run test           # tests with 100% coverage + a check that no source file is left out
bun run smoke          # end to end against the real daemon with the fake runtime
bun run build:daemon   # binaries in dist/
bun run demo           # two fake hosts and the app's web entry, at http://localhost:1420
```

Development is test-first: every area's test is committed red before its implementation. The
rules are in [`docs/TDD.md`](docs/TDD.md). The other smokes, the build and the release flow are in
the [manual](docs/manual/en.md#development).

## Roadmap

The roadmap, with the phases already delivered, is at the end of [`docs/SPEC.md`](docs/SPEC.md).

## License

[MIT](LICENSE).
