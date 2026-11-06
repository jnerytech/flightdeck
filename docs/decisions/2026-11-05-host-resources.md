# Host resources: memory, disk, sessions and orphans (issue #154)

- **One data source: `/proc`.** The daemon reads `stat` (name, parent, CPU ticks, start, resident pages), the `cwd` link and `uptime`,
  through an injected `ProcReader` (`resources/procfs.ts`); the reader has no method that returns a command line or an environment,
  so none can leak into a payload, a log or the UI. Tests use a fake reader or a temp directory shaped like `/proc`; a booted daemon
  takes `resourcesProc` so no test reads the machine.
- **Windows and macOS: not measured.** Per-process numbers need `/proc`. Those hosts report the host's memory, disk (`statfs` of the data
  directory) and load (macOS; Windows has no load average) and `measured: false, reason: "platform"`; the panel says so. Doing it with
  `ps`/`wmic` was left out: another parser to keep, and the heavy-host case that motivated this is a Linux box.
- **No timer in the daemon.** `resources.get` takes one snapshot on demand; CPU % needs two readings, so the sampler keeps the
  previous CPU ticks of each pid between calls (null on the first). The app asks every 5 s only while the panel is on screen and the
  host online. `resources.watch` (a push) was not built: polling by the panel meets "no timer when nobody watches" without a
  subscription to manage.
- **Matching a session to its process.** The SDK starts `claude` as a child of the daemon and gives no pid. A session is matched to a
  `claude` direct child by working folder (`/proc/<pid>/cwd`), several in one folder by start order against `createdAt`. That can swap
  the numbers of two sessions in one folder, and a short-lived query (the permission judge) can look like an extra process: an orphan
  must be at least 60 s old. Capturing the pid through the SDK's `spawnClaudeCodeProcess` would be exact but replaces how the process
  is started; not done here.
- **Orphans.** A `claude` that is a direct child of the daemon, owned by no active session and no terminal, older than 60 s. Ending
  one (`resources.endOrphan`, SIGTERM) re-reads the processes first and refuses anything that is not in that list: a session's, a
  terminal's, one outside the daemon's tree, the daemon itself.
- **Terminals** are matched by the PTY's pid and measured with everything under the shell.
- **Not built:** the status bar segment (#118 is not on this base), a "memory above 90% for 2 minutes" notice (it needs something
  watching while the panel is closed, which the no-timer rule forbids until the status bar exists), End session per row, the session
  view's own line, Windows and macOS samplers. The Resources panel is on the host page's single page; when the tabbed host page lands
  (`host-page-sessions`), pass `active={tab === "usage"}` so a hidden tab does not poll.

### Host resources: the OpenCode security review (issue #154)

Findings F1 to F8 of `opencode-resources-review.md`, all fixed test-first (`resources-security.test.ts`; each guard was removed once to see its test fail).

- **F1/F2: fail closed.** An orphan is a `claude` that is a direct child of the daemon, with a *readable* folder, in a folder where *no active
  session* lives (`<path> (deleted)` counts as the path), older than 60 s, not a terminal's root. Where a session and one or more
  processes share a folder, none is called an orphan: which is whose cannot be told. An ended session's lingering process is still an
  orphan. The rows may still swap the numbers of two sessions in one folder; that no longer decides what is killed.
- **F3.** The orphan carries `startTicks`; `resources.endOrphan {pid, startTicks}` is refused unless that very process is listed, and the
  process is read again right before `kill` (same start, still a child of the daemon, same name). ESRCH is "ended"; any other error is
  not hidden. SIGTERM goes to the root pid only (grandchildren survive, though the row shows the tree's memory).
- **F4.** One shared snapshot: whoever asks while it is being read gets the same promise, and it is kept for 1.5 s (which also gives every
  reader the same CPU window). `/proc` is read 32 processes at a time, `children` is built with push, and the tree walk keeps a visited set.
  `endOrphan` reads on its own and never touches the CPU samples. The panel does not ask again while a read is out. A per-connection rate
  limit was not added: the cache already makes extra callers free.
- **F5.** `resources.endOrphan` requires the vault transport (loopback or Tailscale). `resources.get` stays open. The test pins the guard in
  the source because a test connection is always loopback.
- **F6.** Guards now pinned: the `claude` name filter, a terminal whose program is `claude`, an unreadable folder, a shared folder, a
  `(deleted)` folder, the start-time check, the re-read before the kill, ESRCH, the batch size, the visited set, the request's validation
  (pid 0, -1, 1.5, a missing start, an extra key), and a snapshot taken through the real `/proc` reader over a readable command line and
  environment that must not appear.
- **F7.** A daemon that is pid 1 lists no orphans. A process name is cleaned of control characters and cut to 32.
- **N1/N2 (re-review): an orphan needs positive evidence.** "No active session in that folder" also fitted the daemon's other `claude`
  children (a plugin install of 60 to 120 s, the account idle query, an action that runs `claude`) and a live session whose folder was
  moved. Now a `claude` is an orphan only when its folder equals the folder of a session that is over (`ended` or `error`) and it started
  between that session's creation and its last update, with 10 s of slack each side (the process start comes from `/proc` ticks and the
  uptime, the session's times from the store). Not done: recording the pid of the `claude` the manager starts (the SDK's
  `spawnClaudeCodeProcess` would give exact ownership, but replaces how every session is spawned); a leftover whose session was renamed or
  touched long after it ended can match a later one-shot in the same window, which the 60 s age and the 10 s slack make rare. N3 (a
  cached check before `endOrphan`'s fresh read) and the weak tests (N4) are left as they are.
- **F8.** The page size and clock ticks come from `getconf PAGESIZE` and `CLK_TCK` (4096 and 100 when it cannot say); `parseStat` refuses a
  pid that is not positive.
