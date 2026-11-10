# Daemon update check on request (issue #37)

A daemon that started before a release said nothing about it for up to a day, because it checked its manifest only at boot and every 24 hours, so a host page could warn "different version from the app's" with no update button.

- **`daemon.update.check`** re-runs `UpdateChecker.check()` now and answers the new `UpdateStatus` (also the `update` of the next `host.info`). A check on request moves the next scheduled one to a full interval, so one timer waits at a time. A daemon that does not check (no manifest URL, as when running from source) refuses with the reason `feature_off` (`updater`).
- **Default interval 6 hours** (`updates.checkIntervalH`), down from 24; an existing config keeps its own value.
- **The app asks on its own** once when the host page opens, only when the app is newer than the daemon and the daemon checks at all, and the store allows it at most once per 10 minutes per host (a map in memory, so it resets with the app). The page also has **Check for updates** whenever the daemon reports an update status, and it shows when the daemon last checked and the error of that check.
- **Not covered:** a daemon from before this command (such as the 0.32.0 in the report) refuses `daemon.update.check` as an unknown command, so the page shows why and that host is updated once by hand with `flightdeckd update`; the fix applies to every daemon from this version on. The rate limit lives in the app, not the daemon: the daemon answers each request.
