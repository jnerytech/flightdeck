# Hosts and daemon configuration

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/hosts-and-daemon-configuration.md)

A host is a machine that runs a `flightdeckd`. The app connects to as many hosts as you register.

## The configuration file

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

## Starting the daemon

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
For it to survive a reboot and a closed SSH session, [install it as a service](service.md#installing-as-a-service).

## Connecting the desktop app

In the app, click **Add host** and paste the pairing link (see [Pairing](pairing.md#pairing)), or enter a
name, address (`127.0.0.1`, or the configured `bind`), port (`7420`) and token (the `token` value
in the daemon's `config.json`). **Test and add** performs `hello` and `host.info` before saving
and shows the reason when it fails (token refused, host down). Once the pasted link is read, the
field shows it with the token as dots (`token=••••`), as the **Token** field does, so a screen
share or a screenshot of the form shows no token. A link typed by hand is shown as typed and
masked when you leave the field. The link shown cannot be copied with its token: copy it again from
the daemon. Editing the dotted link keeps the token it was read with, but only for the same address
and port: another address asks you to paste that host's link, and taking the token out of the link
takes it out of the form too. A pasted link that does not read yet (a bad port, say) shows its
values as dots and keeps no token: fix it and paste it again. **Test and add** waits while the
link field shows an error: fix the link or empty the field. A token with a `•` in it cannot go in
a link: use the fields by hand.

The token is kept in the operating system's credential store (Windows Credential Manager,
Keychain, Secret Service), not in plain text. Then use **+** next to the host to create a
session: a folder inside `allowedRoots`, a name, a permission mode and a first prompt. Tool
requests show up as inline cards with **Approve** and **Deny**. The app reconnects by itself
(from 1 s to 30 s) and resumes each session from the last event it saw.

### The first host

With no host yet, the app shows four steps instead of the usual screens: install and start the
daemon (`flightdeckd setup`), copy the pairing link it prints, paste it and press **Test and
add**, and then the app opens the host's own page. There you read **Health & dependencies**
(the app checks by itself) and add the project folders in **Allowed folders**. **Find my projects** (in **Projects**)
then fills the Board without typing a path.

### Checking a host

**Health & dependencies** (on the host's Overview tab) is one section for what the host needs and how
it is doing. The app reads it by itself when the host connects, when you open the host's page (if
the last reading is over five minutes old) and after a daemon update, and says "Checked 3 min
ago"; **Check again** reads it now. The dependencies come in **Required** (Claude Code and its
sign-in, git, the service that starts the daemon at boot, an allowed folder) and **Optional**
(GitHub, Azure, SSH, Tailscale, PowerShell on Windows, the hooks); the checks of the daemon itself
(configuration, daemon, Tailscale, templates, team tools, version against the app's) are under
**Checks**. Every row has an icon and a word (OK, warning, failed, outdated, missing, not
applicable), what stops working without it and a plain step to fix it. Where the app already has the
action, the row has a button: **Install hooks** (it asks first), **Update daemon to X** (it asks
first) and **Add folder** (it opens Settings with the folder box focused and in view; **Install
hooks** also refreshes the hooks status shown in Settings). What needs `sudo` or an installer is only shown to copy: the app never
runs it. A missing program shows the package-manager line where one exists (apt, brew, winget) and
an **Install page** button that opens the official page; Flightdeck never offers a download piped
into a shell. The advice is true for the system it is shown for: **GitHub** counts as outdated below
gh 2.31 (the first with `gh project`, which board sync needs), and on Linux it points to the install
page because the apt package of an LTS can be older than that; **OpenSSH** on Windows says to run its
`Add-WindowsCapability` line in an elevated PowerShell (Run as administrator); on a Linux without
systemd the **service** row says there is no service to install here and to start `flightdeckd` at
login with the system's own tools, instead of offering a command that fails. The same checks run in
a terminal with `flightdeckd doctor`.

### Comparing hosts

With two or more hosts, the host's **Overview** tab also has **Compare hosts**, a band as wide as
the tab under its two columns. **Show comparison** opens one table with a column per host and a row
each for the operating system, the daemon version, the Claude Code version, the hooks, the Claude
sign-in, `gh`, `az`, Start at boot and the features. Opening it (and **Refresh**) reads each online
host again, which runs the same checks as **Health & dependencies**; nothing else asks the hosts.
Hooks read Installed, Outdated or Absent, as in that section. A cell that differs from what most
hosts have is marked, and it says why in words ("Differs from most hosts, which have 1.4.0"). When
what is marked is lacking (hooks, sign-in, `gh`, `az` or Start at boot missing or outdated) or is an
daemon older than the newest one in the row, the cell has a **Fix on** button with the host's name,
which opens that host's page, where Health & dependencies has the install, the turn-on or the update; on the host's own page it scrolls there.
With no majority (two hosts that differ, or an even split) every cell that differs is marked and
says so ("Differs, with no majority among the hosts"); the features row then names, on each host,
what it lacks and what it has that another host does not. A host that is not
online says so once ("Not compared: offline."), in place of a dash in every row, and a value an
online host does not report shows as a dash and is never marked. The features row shows how
many features a host has and, when it differs, names them in words: the ones it lacks and the ones
it adds compared with most hosts ("no stall, no checkLoop"). A long list shows the first 3 and
"and N more", which opens the whole list in place.

## Trusting a project

A project (a repository) can carry its own configuration: hooks that run commands by themselves,
MCP servers that start programs, settings with allowed tools, a `CLAUDE.md`, agents, skills and
commands. In a session Flightdeck starts, that configuration loads **only in a folder you trusted**.
Folders you were already working in when this arrived (your board projects and the folders of your
earlier sessions) are trusted; a repository you clone later, or a folder you add, starts untrusted.

- In an untrusted folder the session loads your own settings, not the project's, and **neither your
  own MCP servers nor your plugins** (Claude Code is told to use only the MCP server Flightdeck
  gives it). The project's `CLAUDE.md`, agents and skills do not load either. A notice at the top
  of the session says so, with **Review and trust**.
- A project with no cards opens its page with one line and one button, **Next: create the first
  card**, which opens the Board's New card. Cards run whether or not the project is trusted:
  trusting adds the project's own configuration to its sessions.
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
- Below it, **Claude Code setup** lists, as a checklist, what helps Claude Code work well in the
  project: `CLAUDE.md`, hooks (and whether one runs a formatter after edits, or checks `git add` or
  secret files before a tool runs), skills, subagents, permissions (how many allow and deny rules) and MCP servers.
  Each is **Found** or **Missing**, and the card says how many of the six are there. It only reads:
  nothing in the project changes, and environment variables are never shown in it. When some of
  the project's files cannot be read, it says so: a part shown as missing may be there.
- On a host that can keep setup templates, **Share as template** under the checklist asks for a name
  and keeps the project's `CLAUDE.md`, agents and skills as a template any project on that host can
  start from. Settings (hooks, permissions, MCP servers) are never shared, every file is checked for
  secrets first, and a name already taken is refused.
- A host's page also lists its **Claude Code setup templates**, the ones shared from a project's setup,
  with their files and size. **Delete** asks first and removes only that template: the projects set
  up from it keep their files. It works from this computer or over Tailscale, not from afar.
- When the host has setup templates, the set-up dialog's **Start from** choice picks one instead of
  Flightdeck's own files. The preview then shows that template's files, lists under **Left out of
  the template** any file it did not propose and why (front matter that could run a command or grant
  a permission, a secret, an import from outside the project, a command that runs as it loads), and
  does not offer the CLAUDE.md draft.
- **Project knowledge** lists the project's PRDs, RFCs, ADRs and specs (the Markdown files in
  `docs/decisions`, `docs/adr`, `docs/rfc`, `docs/prd` and `docs/specs`), each with its title, path,
  type and the status it says it has in its front matter (`status: valid`, `transitional` or
  `obsolete`). A document without a status is **Not classified**. The filters count the documents of
  each status, and a note appears when a valid document points at an obsolete one. It only reads:
  nothing in the project changes. Only the first 500 documents are shown.
  A session that Flightdeck starts in a **trusted** project (`flightdeckd claude`, "Claude here",
  background sessions) is also given a short index of those documents in its system prompt: the
  path and title of each **valid** document, and of each **transitional** one marked as such.
  Documents without a status and obsolete ones are never given. The index is capped at 4 KiB, and a
  line says how many documents were left out. The titles are marked as the repository's data, not
  instructions. A worktree is read from the trusted main folder, not from the branch. A system
  prompt you pass yourself (`--append-system-prompt`) is left alone, with no index beside it. The
  panel says whether the project is given the index, and **Turn off** / **Turn on** switch it for
  that project only. The choice is kept in the host's config file as
  `"knowledge": { "feedOff": ["/path/to/project"] }`, and a folder in that list switches off
  everything inside it too: a project off through a folder above it says so, and is switched on
  by editing that entry in the file. An untrusted project is not given the index, on or off.
  Each document has a status picker and a **Change** button: choosing a status only picks it (the arrow
  keys can browse the list without writing anything), and **Change**, on while the choice differs from
  the file's status, writes it. It writes only the `status:` line of that file's
  front matter (a document with no front matter gets a block holding that line), keeps the rest of
  the file as it is, and leaves the change in the project's folder, not committed: review it with
  git. It is refused when the file changed since the list showed it (reload and try again), when
  its front matter is not clear enough to edit safely, or when the file is over 1 MB or not text.
  While the list loads the panel says so; when the host cannot read it, the panel says what to check
  (the host is online, the project's folder still exists) and **Try again** reads it again. **Make a
  card** on a spec stays focusable while the card is made, and the panel then says which card was made,
  with an **Open** button. Turning the index on or off, and a switch that could not be changed, are
  read out by screen readers.
  Only the documents the list shows can be changed; a link, a credential name or a file outside
  the library folders cannot.
  **New document** starts a document from a template: pick a kind (ADR, RFC or PRD), type a title
  and press **Create from template**. The file goes in `docs/adr`, `docs/rfc` or `docs/prd` of the
  project (an ADR or RFC is numbered, `0004-<title>.md`; a PRD is `<title>.md`), as a draft with
  `status: transitional`, and is left uncommitted. It never replaces a file that is there, and it
  is refused when `docs/<kind>` is a link or lies outside the project.
  **Draft ADR**, in a session's summary, starts a decision record from what the session did: the
  summary is the first text, the assistant's wand can write an ADR (Context, Decision,
  Consequences) from it, you edit it and give it a title, and **Save as ADR** writes it to
  `docs/adr` of the project as a draft, uncommitted, the same way as above.
- Trusting a folder does not trust a parent: a clone inside it that has its own `.git` is its own
  project, and a folder that holds your allowed roots cannot be trusted at all. An allowed root
  that is itself one project (a `.git` of its own and no other repository inside) can be trusted,
  and its trust shows at once; if you later clone another repository inside it, the trust stops
  applying until you move that clone out. A session in a
  trusted folder says "Trusted folder" at the top. Background sessions follow the same rule as
  the sessions in the app.
- This trust is Flightdeck's own and decides only what a session run by Flightdeck loads. The
  question Claude Code asks in a terminal (or in VS Code) is separate: accepting it there does
  not trust the folder here.
- A card's worktree always reads its project configuration from the project's main folder, so a
  branch never brings hooks of its own, trusted or not.
- Trusting works only from the host's own computer or over Tailscale (like allowing a folder or sessions without prompts); revoking works from anywhere.
- The decision lives on the host (`project_trust` in its database), per host, and is logged. A
  host that does not announce `projectTrust` loads everything, as before.

## Keeping the computer awake

While a session of a host runs, or waits for your answer, the host asks its computer not to go to
sleep, so approvals and notifications keep arriving and a long run is not paused by a nap. The
host's **Settings** tab has **Keep this computer awake** to turn it off or on again; the choice is saved in the
host's config (`keepAwake`, on by default) and applies at once. The host releases the computer when
the last session stops and when the daemon exits.

- It stops the computer from sleeping when idle; the screen may still turn off, and closing the lid
  follows the system's power settings.
- On Linux it uses `systemd-inhibit`, on macOS `caffeinate` and on Windows PowerShell
  (`SetThreadExecutionState`). When none of them is there, or it cannot start, the page says why and
  the computer sleeps as usual.
- It works for the host's own computer: a host on another machine keeps that machine awake, not
  yours.
- Inside WSL it holds nothing: a lock taken there does not keep Windows awake, so the page says so
  and the switch is for the Windows host.

## Sessions without permission prompts

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
