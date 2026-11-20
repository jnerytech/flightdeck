# Where the CLI reads the host list and the token for `--host` (issue #3429)

## The question

`flightdeckd <command> --host <name>` must reach a host the person paired in the app, with no second pairing.
The app keeps the host list in the WebView's storage (`hosts.ts`, `HOSTS_KEY`) and each host's token in the OS
credential store (`lib.rs`, service `dev.flightdeck.app`, account = the host id, `keyring` 3.6.3 with the
features `apple-native`, `windows-native`, `linux-native`). The CLI is a Bun process with neither. The CLI that
does this runs on the machine of the app (the person's PC). A host such as the Orange Pi has no app, so it has
no paired tokens: `--host` there exits 1 with "no hosts paired on this machine" and lists no names.

The security review of the first draft (2026-11-20) found that reading the store with each OS's own tool is
wrong or fragile (the Linux build uses the kernel keyring, not a secret service; a macOS item belongs to the
app's ACL) and that a `hosts.json` carrying addresses lets a file write steal a token. The decision below
changes both.

## Decision

1. **One reader, built on the same crate.** A small Rust helper, `flightdeck-cred`, in the app's Cargo workspace
   with the same `keyring` version and features, shipped next to the app. `flightdeck-cred get <id>` prints the
   token to stdout, `flightdeck-cred url <id>` its address, and nothing else: no listing, only a UUID id. It
   refuses to print to a terminal, which only guards against an accidental echo (any process can pipe it).
   Writer and reader share one backend and one naming, so there is no per-OS drift (no PowerShell `CredRead`,
   no `secret-tool`, no `security -w`). The CLI finds the helper at a fixed place, never from a file and never
   by PATH: beside its own executable (`process.execPath`), else the OS install folder
   (`%LOCALAPPDATA%\Programs\flightdeck`, `/Applications/Flightdeck.app/Contents/MacOS`). It spawns it only if
   the folder is not a symlink, is owned by the user or root, and is not group- or world-writable. A change in
   `src-tauri` runs `tauri-rust-reviewer`.
2. **The address comes from the store, with the token.** The app writes the host's address as a second entry
   (account `<id>:url`) whenever it writes the token, and once for every host at start, for hosts paired before
   this change. The CLI uses that address, never the one in a file. So a write to a file cannot point a token at
   another place.
3. **Host list: the app writes a name index for the CLI.** `<config dir>/hosts.json`: `{hosts: [{id, name}]}`.
   No token, no address, no path. The directory is created 0700 and the file is written 0600 at
   creation, atomically, each time the list changes (a removed host leaves it in the same write that deletes its
   store entries) and once at start. The CLI refuses a file that is a symlink or owned by another user. On
   Windows the mode is not enforced; the folder inherits the user profile's ACL. The CLI never reads the
   WebView's storage.
4. **`--host` takes a name.** Matched exactly against `hosts.json`. An address, a name nobody has, or a name two
   hosts share is refused with exit 1 and the list of known names. The `id` of a match must be
   `^[0-9a-f-]{36}$` (the app's `crypto.randomUUID()`; any other id is `unknown_host`), is passed to the helper as one argv element after `--`,
   and is never put into a script or a shell string.
5. **No store, no remote.** A store that is missing, locked or not reachable in this session (a headless Linux
   login, a locked Keychain) gives exit 1, "no credential store: pair from the app". The CLI never falls back to
   a token in a file, the environment or the command line.
6. **Plain `ws://` only where the path is private.** A new rule of the CLI only (the app has none: it builds
   `ws://host:port` for any host, `host-draft.ts`). The CLI refuses `ws://` unless the parsed hostname (URL
   host, no userinfo, no trailing dot) is an IP literal in loopback, a private range or Tailscale's
   `100.64.0.0/10`, or is `localhost` or a `*.ts.net` name. Any other DNS name over `ws://` is refused with the
   reason `cleartext_remote`: the token is sent in `hello` and would cross the network in the clear. `wss://` is
   always allowed.
7. **Exit codes.** Unknown, ambiguous or refused address: 1. A host that does not answer: 2 (as `card`). A
   refused or revoked token: 1, "pair this host again in the app". With `--json` the failure carries a stable
   `reason` (`unknown_host`, `ambiguous_host`, `no_store`, `cleartext_remote`, `unreachable`, `token_refused`).

## The token never leaves the connection

- The helper is run with a fixed argv, stdin ignored, stdout piped, stderr piped and thrown away (never
  inherited). The output is read as UTF-8 (anything else is refused), trimmed of its final newline and capped
  in length, then used for one connect.
- The token goes into the `hello` frame and nowhere else: not argv, the environment, a log line, an error,
  `--json`, a crash trace or the process title. It is held in a closure variable, never in an object that is
  logged, spread or `JSON.stringify`d, and the `DaemonClient` is not given it as a property.
- CLI errors are built from fixed words plus the host's name, never from a message of the helper or the
  socket. A refusal from the daemon is shown by its code and detail as now.
- A test captures stdout, stderr, the log, the `--json` output and the uncaught-error output of every failing
  path (unknown host, no store, helper error, refused token, unreachable) and looks for a token of a known
  shape. Tests use a fake helper and a fake spawn; nothing real is read.

## What each OS gives (and what is checked)

- **Windows.** The Credential Manager has no per-application access: any process of the user can read the
  entry, with the helper or without it. Verified in the crate (`windows.rs`): target `<id>.dev.flightdeck.app`,
  UTF-16LE, no terminator. The helper uses the crate, so this does not matter to the CLI.
- **macOS.** The item belongs to the app's ACL. The first read by the helper prompts; if the person chooses
  "Always Allow", the helper is on the ACL and any process that can run it reads the tokens. A locked
  Keychain or a session with no interaction is "no credential store". Unverified on a device.
- **Linux.** The build uses the kernel keyring (`keyutils`), not a secret service. The token is a key described
  `keyring-rs:<id>@dev.flightdeck.app` in the user's session keyring, with a persistent link where the kernel
  has it (the crate's default entry uses the session keyring; the persistent variant is a different build). It does not survive a reboot or reach another login session (SSH, a unit), so "no credential store"
  is the common result there. Linux is not the app's first target; this is stated, not fixed here.
- The manual check of the helper on Windows (and macOS when a device is at hand) is done before the PR that adds
  `--host` merges, not after.

## What it does not stop

- **Reach.** An agent that runs the CLI on the person's PC reaches every host the app paired, with its token.
  On Windows any process of the user can already read the tokens; on macOS the first read prompts and an
  "Always Allow" makes it as easy; the CLI makes the reach easier, not new. The person decides which agents
  run on their PC. A high-risk approve on the other host still needs the device proof of #3439.
- **Same user.** `hosts.json` carries no address and no path, so a write to it can hide or rename a host and
  nothing more; a rename can send a token only to another of the person's own hosts. The store is another
  matter: on Windows and Linux (keyutils) a process of the user can write the `<id>:url` entry and so redirect
  a token. Decision 6 and `wss://` bound what such a redirect leaks; storing address and token as one entry
  would make an attacker overwrite both, and is left to the implementing PR to weigh.
  The helper sits in the install folder; the check in decision 1 refuses a folder the user's other processes
  can swap.
- **No server identity.** The daemon does not prove itself to the client. A TLS pin is out of scope; `wss://` or
  a private path (decision 6) is what protects the token on the wire.
- The list of known names in a refusal tells whoever runs the CLI every host's name. It is the same view the
  person's own account gives.
- A host list stored by the daemon, pairing from the CLI and printing a token stay out of scope.

## Order of work

1. This record, `security-reviewer` again on its changes, before code.
2. The helper and the app's writes (`hosts.json`, the `<id>:url` entry), with `tauri-rust-reviewer`; both
   languages for any text.
3. The read in the CLI (`TokenStore` port, the fake, the leak test), then `--host` on `host` and `sessions`.
4. `--host` on `requests`, `send`, `approve`, `deny`. The manuals (`flightdeckd-commands.md`, pt-BR twin) with it.
