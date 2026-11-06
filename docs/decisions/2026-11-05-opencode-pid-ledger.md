# A ledger of OpenCode's process groups (issue #250)

- **Why.** When the daemon is killed with SIGKILL, `opencode acp` exits (its pipe closes) but a command it was running survives as an orphan in the same process group. systemd clears the cgroup on a stop or restart; other setups do not.
- **How.** `runtime/process-ledger.ts` keeps `opencode-groups.json` in the data folder: the pid, the start time (clock ticks, from `/proc/<pid>/stat`) and the command line of each `opencode acp` the daemon starts, written once the process has answered `initialize` (right after the spawn /proc may still show the parent's command). When the process ends, whatever is left of its group is killed and the entry goes. At the next start, before anything else (even with OpenCode off), every remaining entry is checked and its group killed with SIGKILL.
- **Pid reuse.** A leader still there is killed only if its start time and command line are the recorded ones and it leads its own group. A leader that is gone leaves its group's members: Linux does not hand a pid to another process while a group of that id has members, so those members, if they started after the leader, are what it left. Anything else is dropped as stale and nothing is signalled.
- **Elsewhere.** On macOS and Windows `/proc` is not there, so nothing is recorded or reaped (Windows ends the tree with `taskkill` at close, as before). A ledger that cannot be written only loses the cleanup.
- **Also.** `store.test.ts` now tests the `sessions.runtime` migration on a database from before the column (the old rows are Claude's).
- **Not covered.** `runCommand`'s short OpenCode commands (`models`, `--version`) are not in the ledger: they have a deadline that ends their group, and live seconds.
- **Security review (2026-11-06).** The ledger file is the user's to edit, so an entry is read only
  as `add` writes it: a group id above 1 (0 is the caller's own group, and -1 in `kill(-pid)`
  reaches every process of the user), a tick count, a command line and the boot id. An entry from
  another boot is stale, since start ticks begin again at zero. The daemon's own pid and group are
  never killed. Left as they are for now: the file keeps the default umask (it lives in the
  daemon's data folder), the password goes to the URL the server printed on its own stdout (always
  `127.0.0.1`, since the daemon passes `--hostname 127.0.0.1`), and a daemon killed between the
  spawn and the server's "listening" line leaves that one `opencode serve` group unwritten.
