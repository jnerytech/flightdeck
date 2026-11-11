# No blocking IO in runtime code (issue #1711, moved from DECISIONS.md)

The maintainer's rule: nothing in the daemon or the app waits on the disk or on a process while the
event loop (or the window) has other work. `scripts/lib/no-sync-ratchet.ts` counts the fs `*Sync`,
`execSync`, `execFileSync` and `spawnSync` calls per file in `apps/daemon/src` and
`apps/desktop/src`; `scripts/test/guards/no-sync-ratchet.test.ts` compares the counts with a baseline that
only goes down, so a new call fails and a removed call forces the baseline down. Scripts and tests
are out of scope. This supersedes item 4 of the blocking-call audit: the sync fallbacks of
`memory.ts` and `board/worktree.ts` are gone, not kept as a cold path.

- **`ProjectKeys.known(cwd)` may answer with a provisional key.** The key of a folder comes from
  `git` (the remote, else the repository root). `keyFor` ran git synchronously for a folder nobody
  had looked at. `known` returns the cached key, and for a cold folder it returns the folder's own
  key once while one async lookup runs in the background, so the next call is right. Callers that
  need the real key `await resolve(cwd)` first (the receptor, `Board.registerProject`,
  `warmProjectKeys` and the usage indexer already do). A folder cached as "not a repository" is
  looked at again, because it may have become one. The cost: one call for a cold, unwarmed folder
  can group under the folder key instead of the repository key.
- **A rule accepted in a session is written after the answer.** The permission answer goes back at
  once; the rule file is written afterwards, one write at a time (`Board` keeps a promise chain, and
  `Board.rulesWritten()` settles it for tests), so two quick answers cannot read the same file and
  lose a rule. Before, the answer waited for the write.
- **Project memory looks up its repository once per project.** `ProjectMemory.dir` is async and
  keeps one shared promise per project (git can cost 50-150 ms a call on Windows with Defender), so
  concurrent and later requests reuse it and a cold call still awaits the real answer. A failed
  lookup is dropped, and a folder that was not a repository is looked at again once it has a `.git`.
  `warm` is gone. The decision log appends asynchronously and the write or delete that recorded it
  waits for the line to land.
- **`bun:sqlite` stays sync.** The store's calls are synchronous by design in `bun:sqlite`; they run
  against a local file in WAL mode, are short and indexed, and are measured by `history-perf`. A
  worker would add a message hop to every query and make transactions across calls awkward, so the
  ratchet does not count them and they are an accepted exception.
- **Tauri: every IO command is async and runs on the blocking pool.** The key and folder dialogs
  wait for the person inside `spawn_blocking`, the picked key file is read there, and
  `vault_remove_file` (which does delete a file, so item 1 of the blocking-call audit was wrong to
  call it state-only) takes the path under the lock and deletes it there. No async command does
  blocking work inline any more (`ASYNC_INLINE_ALLOWED` is empty). Four commands stay plain `fn`
  because they only touch the tray or the window, which Tauri wants on the main thread, and do no
  IO: `tray_set_menu`, `tray_set_status`, `focus_main` and `set_close_to_tray`
  (`SYNC_COMMANDS_ALLOWED` pins the list). Rust was reviewed by reading: cargo is not on the phase
  host, so CI's `cargo check` is the compiler check.
- **The ratchet counts uses, not just calls, and has a command.** `syncCallCount` counts
  `fooSync(`, `realpathSync.native(` and bare references such as `{ exists: existsSync }`, and
  skips comments and import statements. After a merge changes the counts, run
  `bun run no-sync:baseline` (it rewrites `SYNC_BASELINE` from the sources) and read the diff.
- **The session manager reads no persona file.** Reading a project's personas is asynchronous IO,
  so it moved out to the edges: whoever starts a session (`session.create`, a card, a workflow
  step, a team coordinator, a history resume, a fork) calls `preparePersonas` first and hands the
  resolved persona and the subagents to `SessionManager.create` as values. The session keeps the
  subagents it opened with (the `sessions.agents` column), so `send` and `resume` reuse them
  and need no caller to resolve anything. The cost: a change to a persona file, or to the project's
  subagents switch, applies to new sessions only; a session already open keeps what it opened with.
- **The path checks are asynchronous, and the baseline is empty.** `resolveAllowedCwd`, `listDirs`,
  `listFiles`, `isSystemFolder` and `resolveSshPath` answer with promises, and so do the calls that
  depend on them: `SessionManager.create` and `createResumed`, `TerminalManager.open`, the persona
  and snippet stores' project lookup, and `RunHost.spawn`. A refusal is now a rejection, so a
  caller that used `try`/`catch` around a call awaits inside it. `RunManager.start` still answers
  once the setup is on its way or every process has started, as before; it now waits for that
  point instead of getting it for free from synchronous spawns. `SYNC_BASELINE` has no file left:
  the only blocking calls in runtime code are the `bun:sqlite` ones and the four Tauri commands
  that touch the tray or the window.
