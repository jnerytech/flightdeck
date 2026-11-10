# Host operations

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/host-operations.md)

## Versions and compatibility

- **One version:** the app, the daemon and the protocol ship with the same version (0.14.0 in
  this documentation). `flightdeckd --version` prints `flightdeckd <version> (protocolo 1)`.
- **In the app:** the host page shows the daemon version, the app version and the `claude`
  version. A daemon of a different version gets the **≠** badge ("different version from the
  app's") in the sidebar: it works, but update when you can. Hovering a host in the sidebar, or
  moving the keyboard focus to it, shows its daemon's version in a tooltip (in the narrow rail,
  after its name).
- **Protocol:** the app sends its protocol version in `hello`. If the daemon does not accept it,
  the host becomes **incompatible: update the daemon**, with the command on the host page. It
  does not try to reconnect and drops out of the lists (sessions, search) until it is updated and
  reconnected.
- **Features:** `host.info` announces what the daemon has (`central`, `workflows`,
  `maintenance`…), and the app hides what the host does not announce. A daemon older than Phase 7
  announces nothing and keeps showing up as before, without the Maintenance section.

## Updating with flightdeckd update

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

## Sessions a restart interrupted

When a host's daemon restarts (an update, a reboot, a service restart), the sessions that were
running are left in `error` with the reason *the daemon restarted*. When the app reconnects to a
daemon that offers it, one dialog, **Resume interrupted sessions**, lists the ones from the last 24
hours, grouped by project folder, each with its persona, how long it ran and its last request. All are
ticked. The dialog says what resume does: it reattaches each session and sends *Continue where you
left off.*; the original request is never sent again. **Resume selected** resumes the ticked ones
(each row ends as *Resumed*, or as *Could not resume: <reason>* with a **Retry** button, and the
others are not affected); **Not now** closes the dialog and does not bring it back until another
restart (the host's page keeps a *Resume interrupted sessions (N)* button to reopen it); **Dismiss
all** drops the offer for good. The host's page also has a switch, **Resume automatically after a
restart**, off by default: with it on no dialog appears, the sessions are resumed at once and a
notice lists them. Not yet: a *queued* state when the parallel limit is reached, a team's coordinator
resumed before its workers, and a status-bar entry to reopen the offer.

## Signed automatic update

Each release ships the installers and the daemons signed with the project's key (minisign,
generated by `tauri signer`). The public key is in
[`release/flightdeck.pub`](../../../release/flightdeck.pub), and the app and the daemon only accept
what it signed. This applies to updates: the Windows installer itself has no Authenticode
signature (see [Installation](installation.md#from-the-release-binaries)).

- **The app:**
  - looks for a new version on open and every 6 h, in the latest release's `latest.json`;
  - with **Update automatically** on (the default), it downloads the new version in the
    background, checks its signature, and then shows a card in the bottom-right corner:
    **Update available**, "Flightdeck vX is ready.", "Your sessions will not be interrupted." (they
    run in the hosts' daemons), **Release notes** (the version's page on GitHub), one **Update**
    button and a close button (×) that puts it away until the next check (#490). Nothing restarts
    by itself (#280). Quitting
    from the tray with a version downloaded installs it on the way out, without starting the app
    again (#402);
  - with it off, the banner says "Flightdeck X available", with the notes, **Install and
    restart** and **Later**, as before;
  - an invalid signature or a broken download shows up in the banner, and nothing is installed; a
    failed download is tried again at the next check;
  - in **Settings**: **Check for updates now**, **Notify about updates** and **Update
    automatically** (both on by default).
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
  - the host shows "updating…" until it reconnects on the new version;
  - **by itself** (`updates.auto`, on by default; #280): when a check finds a newer version, the
    daemon applies it only while the host is idle, with no session or run going on, and otherwise
    waits. It never applies an older version. A failed apply keeps the old binary and is tried
    again at the next check. The host page has **Update this host automatically** (the same
    setting, kept by the daemon) and says whether the update is off, current, waiting, started or
    failed, and why.
- **Order:** with the app and the daemons both out of date, the banner suggests updating the app
  first.

```json
{ "updates": { "manifestUrl": "https://github.com/jnerytech/flightdeck/releases/latest/download/daemon-latest.json",
               "checkIntervalH": 6, "auto": true } }
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

## Retention

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
- Cost usage has its own retention: `retention.usageDays` (see [Costs](costs-budgets-and-quota.md#costs)).

## Backup and restore

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
