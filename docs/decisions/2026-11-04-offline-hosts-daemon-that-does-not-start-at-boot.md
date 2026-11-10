# Offline hosts and a daemon that does not start at boot (issue #106)

- **Why a host is offline is inferred, not read.** A browser WebSocket only reports that the socket closed, so the app
  classifies a failed try by what came before it: it was online (`lost`), the watchdog gave up on a hello nobody answered
  (`timeout`), or it never opened (`refused`, the usual "daemon not running"). The state is `{ kind, lastTryAt, nextRetryAt }`
  on the connection, copied to the host view, and cleared on `online`.
- **Hints are by kind and address.** The Linux/WSL commands (`systemctl --user status flightdeckd`,
  `sudo loginctl enable-linger $USER`, `systemd=true` in `/etc/wsl.conf`) show for a refused connection to a loopback address
  or a host last seen as Linux; other kinds get a generic line. Not done here: retrying at once on window focus or when the
  network returns (item 4 of the issue); the backoff keeps trying on its own.
- **Uptime is aged in the app.** `host.info` is a snapshot, so the app keeps when it arrived (`infoAt`) and shows
  `uptimeSec + elapsed`, ticking each second, instead of re-asking the host.
- **Linger is a doctor failure, not a prompt.** `setup` never runs `sudo`. It ends with a WARNING block (printed last) and the
  doctor reports `linger` as a failure with the command, on Linux only (`loginctl show-user -p Linger`; other platforms and
  an unreadable answer add no check).
- **PATH on Linux and macOS.** `setup` appends `export PATH="<home>/.flightdeck/bin:$PATH"` to `~/.profile`, once (it looks
  for the exact line first), keeping the rest of the file, and prints the line instead when it cannot write. A shell that reads
  only `~/.bashrc` or `~/.zprofile` still needs a new login; the output says to open a new terminal.
- **Retry on wake-up.** The window gaining focus, the page becoming visible and the browser's `online` event call `wake()` on
  each connection. It acts only on a connection that is waiting out a backoff (`offline`), clears the timer, restarts the
  backoff from the first delay and connects at once; a connection that is online or already trying is left alone. A wake-up
  within 2 s of the last one that acted is ignored, so focus spam cannot storm a host. The listeners are set in `init()` (it
  begins with `dispose()`), not in the constructor, which would be undone by it.
