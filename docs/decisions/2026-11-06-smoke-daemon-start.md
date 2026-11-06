# The smokes wait for the daemon's port with a measured limit (issue #347)

- **The symptom.** On Windows CI two smokes failed at "daemon anunciar a porta" (`smoke:ops` on
  #298, `smoke:history` on #320): the daemon had not printed its `listening on` line in the 10 s
  every smoke gave every step. A rerun passed; Linux and main were fine.
- **Where the time goes.** On a slow board (the Pi), about 360-420 ms pass before `startDaemon`
  runs at all (the process starting and loading its modules), and then only 100-230 ms of the
  daemon's own work until the announcement: reading the config, the lock, opening SQLite (35-140 ms),
  the services, the first maintenance pass. Nothing there takes seconds. A stall of 10 s or more is
  the process itself not getting going (Defender scanning the runtime and the sources on a cold
  runner, disk waits), which no reordering of the daemon's work can move.
- **What CI shows.** 300 daemon starts in ten Windows runs: median 1.2 s, 90th percentile 1.8 s,
  95th 2.3 s; the slow ones came in runs where the whole runner was slow (13-17 s in one run).
- **So the work stays where it is, and the wait changes.** Every smoke reads the announcement
  through `scripts/lib/smoke-daemon.ts` (`readListenUrl` for a pipe, `awaitListenUrl` for a smoke
  that collects the output itself) with `DAEMON_START_MS` = 30 s, about twice the worst start seen,
  instead of the 10 s step limit. The other steps of a smoke keep their 10 s.
- **A failure says what happened.** The error names the limit and the last 300 characters the
  daemon printed (or that it ended), instead of only "timeout". The daemon's own line now ends with
  `boot N ms` (milliseconds since the process started), so the next slow start shows in the log
  whether the process or the daemon's work was slow.
- **No smoke keeps its own copy.** A test fails when a smoke defines its own `readListenUrl` or
  parses the `listening on` line itself (the real-OpenCode smoke, which reads a log file and has a
  60 s limit of its own, is the one exception).
