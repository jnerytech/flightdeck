# Blocking-call audit (issue #1711, moved from DECISIONS.md)

Ranked by frequency × cost on Windows. "Closed" means a ratchet or an earlier fix already holds it.

1. **Tauri sync commands on the main thread** (fixed). Tauri 2 runs a plain `#[tauri::command]`
   on the main thread. `token_*` and `vault_*` hit the Credential Manager, `terminal_probe` walks
   `PATH` and `terminal_open` spawns a process. They run once per host at startup and per
   interaction, so the whole window froze. They are `async fn` now. Only the tray and window
   commands (`tray_set_menu`, `tray_set_status`, `focus_main`, `set_close_to_tray`) and the
   state-only `vault_remove_file` stay sync. `scripts/lib/blocking-audit-ratchet.ts` pins that list.
2. **Sync project key in `session.list`, `history.list`, `messages.*`, `teams.*`** (closed by
   `history-perf`; since #1850 its tests check that the first `session.list` and `history.list`
   carry a cold folder's repository key, and the `blocking-key-ratchet` source count is gone).
3. **`keys.keyFor` callbacks in `main.ts`** (closed, audited). Four remain: the usage indexer,
   the board's budget gate, the actions' project rule and the name tracker. Each folder is warmed
   first (`warmKeys` of the indexer, `Board.warmProjectKeys` and `registerProject`, `warm` of the
   name tracker). The ratchet fixes the count at 4, so a new caller needs a conscious change.
4. **`Bun.spawnSync` in `memory.ts`, `board/worktree.ts`** (closed). Both have an async twin used by
   the warm path; the sync one runs only for a folder nobody looked up yet. The ratchet lists the
   four files that may call it (`project-key.ts`, the two above and the test runtime).
5. **Plugin inspection** (`plugins/inventory.ts`: sync reads of every file to hash a plugin).
   Linear in the plugin size and capped by `MAX_BYTES`; it runs on install and inspect only. Left.
6. **Review files, agent config files** (sync reads and writes of one file per request). User
   initiated, one file at a time. Left.
7. **History and costs SQL** (unindexed `last_ts` scan, per-session `lastActivity`). Measured in
   `history-perf`: linear and fine up to 5k sessions. Left.
8. **Desktop render and effects.** No large `JSON.parse` or unmemoized sort of a large list on a
   render path: the `JSON.parse` calls decode small effect keys, the sorts run on lists of tens.
   Nothing to fix.
9. **Timers and watchers.** `watchFile` on the config (2 s, one `stat`), the messaging sweep (5 min),
   the PR poll and the automations tick are async or cheap. Nothing to fix.

Not done: a runner that throws on any blocking spawn in tests. `fake-runtime.ts` and the warm
fallbacks call it on purpose, so the list-based ratchet is the practical guard.
