# Start at boot from the app: install and enable for the next boot or login, never a live handover (issue #1200)

**Decision (fd-coordinator, 2026-11-08):** while a host is connected, a missing **Start at boot**
row gets **Turn it on** in the host's health check. The daemon installs itself as a service and
enables it for the **next boot or login**. It does not start the service now, and the daemon that
answered keeps running.

**Why not start it now:**
- `systemctl --user enable --now` would start a second daemon against the running one, and the
  two would race for the port and the data lock.
- A live handover (start the service, then exit) has no way back: the running daemon is not under
  systemd, so if it exited and the service failed, the host would drop offline and the app could
  not reach it to fix anything.
- The Windows task already has only a logon trigger, so Windows behaves the same.

**What the person sees:**
- The confirm dialog names what is written (`~/.config/systemd/user/flightdeckd.service`, or the
  `Flightdeck\flightdeckd` task) and says the running daemon stays as it is.
- After the install, a note says when the service first runs: the next boot (Linux with linger
  on) or the next login.
- On Linux with linger off, the note says so, gives `sudo loginctl enable-linger <user>` to copy,
  and says the app never runs sudo. The health row stays red until linger is on, since a service
  that waits for a login does not start at boot.

**Where it is offered:** only by a daemon running as its stable binary
(`~/.flightdeck/bin/flightdeckd`), the file the service starts, and only on Linux with systemd or
on Windows (`appCanInstallService`, the `serviceInstall` feature in `host.info`). A daemon run from
source (the demo, the e2e journeys) never offers it, so no journey or print runs `systemctl` or
`schtasks`. Offline, the row keeps its terminal command. The command needs `confirm: true` and is
refused with a reason otherwise (`service_confirm`, `service_unsupported`). The service gets
`--config` only when the daemon was started with one, and the `claude` it will use is written to
the config, as `flightdeckd service install` does.
