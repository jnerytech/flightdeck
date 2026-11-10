# Service

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/service.md)

## First run: flightdeckd setup

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

## Installing as a service

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

## WSL from Windows

The Windows daemon can keep the daemon of each WSL distro running (and the distro awake):

```json
"wsl": [{ "distro": "Ubuntu", "command": "~/.local/bin/flightdeckd start", "port": 7430 }]
```

Each item becomes `wsl.exe -d <distro> --exec bash -lc "<command>"`, restarted with backoff from
1 s up to 60 s, logging to `dataDir/logs/wsl-<distro>.log`. The WSL daemon listens on
`127.0.0.1:7430`, which Windows reaches through `localhost`. If that daemon also receives hooks,
its `hooks.port` must differ from Windows's (see [Claude Code hooks](session-hub-and-claude-code-hooks.md#claude-code-hooks)).

**Setting up the WSL daemon.** Run `flightdeckd setup` inside the distro. WSL shares `localhost`
with Windows, so setup detects WSL (`WSL_DISTRO_NAME`, or `/proc/version`) and moves the ports
that are still at the Windows daemon's defaults up by 10: `port` 7430, `hooks.port` 7431 and
`telemetry.port` 7432 (Windows keeps 7420, 7421 and 7422). They are written to `config.json`, so
nobody edits it by hand; a port you set yourself stays, and running setup again changes nothing.
A new config in WSL also names the host "<hostname> (WSL <distro>)", so the two daemons are easy
to tell apart in the app.
