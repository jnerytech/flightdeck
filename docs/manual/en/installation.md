# Installation

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/installation.md)

## From the release binaries

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
[automatic update](host-operations.md#signed-automatic-update).

1. **Verify the download** before running it:
   - Linux: `sha256sum -c SHA256SUMS --ignore-missing`.
   - Windows (PowerShell): `(Get-FileHash .\<file>).Hash.ToLower()`, and compare it with the
     file's line in `SHA256SUMS`.
2. **App:** run the installer. It has **no Windows code signature (Authenticode)**, so SmartScreen
   shows "Windows protected your PC". With the hash verified, click **More info** and then **Run
   anyway**. (The minisign signature of the updates is a different thing: see
   [Signed automatic update](host-operations.md#signed-automatic-update).)
3. **Daemon:** on each host, with Claude Code installed and logged in:
   - on Linux, `chmod +x` the binary before using it;
   - run `<binary> setup` (on Windows, `.\flightdeckd-windows-x64.exe setup` from the download
     folder, after `Unblock-File` if Windows blocks it; afterwards `flightdeckd` works in a new
     terminal): it copies the binary to `~/.flightdeck/bin`, asks for your project
     folders, installs and **starts** the service and prints the pairing link (see
     [First run: flightdeckd setup](service.md#first-run-flightdeckd-setup)).

## From source

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
