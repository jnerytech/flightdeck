# Fix: `setup` puts the stable binary's folder on the PATH (issue #1711, moved from DECISIONS.md)

- The stable binary was already named `flightdeckd.exe` / `flightdeckd`; the bug was that nothing
  put `~/.flightdeck/bin` on the PATH, so `flightdeckd` was not found after the first run.
- Windows: the user `Path` in `HKCU\Environment` is read and written with `reg.exe` through the
  injected context, never `setx` (it cuts a value at 1024 characters) and never .NET's
  `SetEnvironmentVariable` (it rewrites the value as `REG_SZ`, losing `%VARIABLES%`). The value's
  type is kept (`REG_EXPAND_SZ` when the value is new). Entries are compared ignoring case, a
  trailing slash, the slash's direction and `%USERPROFILE%`. A `WM_SETTINGCHANGE` broadcast
  (PowerShell) tells open programs; terminals opened before it still need to be reopened.
- A failed write or broadcast never aborts `setup`: it prints the manual step. A `reg query` that
  fails is read as "no Path value yet" (the usual cause is that the value does not exist).
- Linux and macOS: `setup` prints the `export PATH=...` line and edits no rc file.
- `service uninstall` removes the entry (all spellings); `--dry-run` only says so.
- `setup` no longer keeps any stable binary that is already there: it asks it for `--version`
  (the same probe as `update`). Older, or no answer, is replaced after the service's daemon stops
  (a daemon that will not stop aborts with the way out), keeping `.old` like `update`; the same
  version or a newer one stays and is named. A real Windows test found an old binary on the PATH
  that `setup` had kept as the service.
- A transcript the host has not indexed yet is a normal state (the indexer catches up after a
  session's first turn): `history.get` refuses with the reason `transcript_not_indexed` (the app
  translates it) and the app raises no toast for it; the summary panel says the summary appears
  after the first turn and asks again every 8 s while it has none. A session page with no name,
  folder or indexed title is titled "New session", never its id.
- Known leftover: about 60 `FlightdeckError` details in the daemon are still Portuguese and have
  no `reason` (board, review, checkpoints, personas, names, memory and others). They show in the
  app as the refusal's detail. Giving each a reason and a dictionary text is a separate change.
