# No blocking IO in runtime code (issue #1711, moved from DECISIONS.md)

The maintainer's rule: nothing in the daemon or the app waits on the disk or on a process while the
event loop (or the window) has other work. `scripts/lib/no-sync-ratchet.ts` counts the fs `*Sync`,
`execSync`, `execFileSync` and `spawnSync` calls per file in `apps/daemon/src` and
`apps/desktop/src`; `scripts/test/no-sync-ratchet.test.ts` compares the counts with a baseline that
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
