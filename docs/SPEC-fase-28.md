# Flightdeck — Phase 28 spec (performance and stack best practices)

## Goal

Make the app and the daemon measurably faster and steadier on the user's machines (Windows first, plus the Pi host), by
applying the current guidance of the stack: React 19, Vite, Tauri 2, Bun (WebSocket, `bun:sqlite`), xterm.js and
CodeMirror 6. The phase is **measure first, fix second**: every area has a number to beat, taken before the change and
again after it. Nothing is added "because the guide says so" without a number.

Origin: the research in `perf-research.md` (kept beside the repository, 2026-10-31, updated 2026-11-01). Its
one large win is already in `main` (fix-ux-render: a streamed token went from 99 ms to 0.75 ms per token with 150
messages, found with a render counter, not with a redesign). A Windows CI timeout on 2026-11-01 added the
synchronous-`git` finding (item 11), whose first two fixes are also in `main`.

Prerequisites: phases 1 to 27 (the app, the daemon, the terminal, the board and the history index are what is measured).

**Out:**
- a global memoization pass or a state library before the numbers say where the time goes;
- trusting Bun's "3-6x faster than better-sqlite3" claim (one dataset, read queries only);
- changing `synchronous` without the user's decision (see the SQLite row below);
- anything that needs the CLI or the network in a test.

## Already done (do not redo)

| What | Where | Result |
| --- | --- | --- |
| Finished messages are not drawn again for each token | fix-ux-render (`memo` on each message and the held-state hook), tests `orcamento-conversa`, `orcamento-render` | 99 ms to 0.75 ms per token (150 messages, 130x); 1,200 to 0 Markdown draws for 20 tokens; 0 App commits for events of a session that is not on screen |
| A dropped WebSocket frame cuts that client off, and it resumes from its last seq | `daemon/src/ws-send.ts`, commit `4a9d1b67` | the "conversation with holes" case of the research is closed; the rest of the WebSocket work is below |
| The project key is looked up without blocking the daemon, once per cwd | `fix-uso-git` (`ProjectKeys.resolve` and `lookup`; `session.create` and the usage ledger wait for the key, not the event loop) | a slow `git` no longer stops the protocol on `session.create` or at the end of a turn |
| The key cache is filled before the other entry points read it | `fix-chave-warm` (hook receptor, names tracker for every managed session, sessions present at start-up; the hub shares the host's `ProjectKeys`) | `keyFor` stays as the synchronous fallback |

## Baseline first

Before the first area, one session records the numbers below in `docs/DECISIONS.md` (Phase 28 section), on the
maintainer's Windows machine or on a CI runner, **not on the shared Pi** (its load of about 5 distorted the earlier
prints). Each question has a way to answer it and an area that depends on it.

1. **Bundle.** `vite build` size and gzip size of the entry chunk and of each of the five largest chunks, and which
   packages they come from (react-markdown and remark, xterm, CodeMirror are the suspects). Area `bundle-lazy`.
2. **Start.** Time from launching the packaged app to the first painted screen, and the installer and binary sizes of a
   release build with Cargo's defaults (the file has no `[profile.*]` section today). Area `tauri-release`.
3. **Hub.** Render time and DOM node count of the Sessions screen with the user's real history (the Pi's synthetic
   numbers: 7 ms at 690 rows, 21 ms at 3,090, 67 ms at 9,090 for `hubRows` plus `hubGroups` alone). Area `hub-list`.
4. **Quiet commits.** React commits per quiet minute with three hosts, one of them offline (the Pi probe: 24 commits in
   10 s with 3 unreachable hosts). Area `state-selectors`.
5. **Frames.** Frames per second and bytes per second sent to one client while a session streams, and what a phone over
   Tailscale does to the daemon's buffer (the `-1` returns of `send`). Area `ws-coalesce`.
6. **Terminal.** Key echo latency and whether a resync happens during `yes | head -c 50M`, `cat` of a large file and
   `ls -R /`, with and without `@xterm/addon-webgl`. Area `terminal-flow`.
7. **Daemon.** Resident memory and CPU of an idle daemon (no session), then after a day with five sessions and the
   history indexer; the list of timers it keeps. Area `daemon-idle`.
8. **Event loop.** `monitorEventLoopDelay` p99 of the daemon during start-up, a project add and a card start on Windows.
   Area `sync-git`.
9. **Persisted events.** Events per second and commit latency of a tool-heavy turn on NTFS (the Pi's ext4 numbers: about
   2,700 to 3,000 events/s with `synchronous=FULL`, about 13,000 to 14,700 with `NORMAL`). Row `sqlite-durability`.

## Design

Each piece is independent and can land alone, in the order of the table below (most hit by the user first). A piece whose
baseline shows nothing to gain is closed with the numbers in DECISIONS and no code.

- **Hub list.** `hubRows` and `hubGroups` computed with `useMemo` over the hub's real inputs, and a cap of rows drawn
  with "show more" (or a virtual list if the cap does not hold the budget). No list virtualization exists in the app today.
- **Selectors.** The 35 files that take the whole `AppState` as a prop read what they need through `useStoreState`
  and `useSessionState`-style hooks that return existing references, so a host reconnect does not draw the screens that
  do not show that host. A ratchet script (like `layout-ratchet`) only lets the count go down.
- **React Compiler spike.** Annotation mode (`"use memo"`) on three screens, one at a time, compared with the same
  render probe. Adopted only if it removes renders and the suite stays green; the decision (adopt, adopt per folder, drop)
  goes to DECISIONS. It needs code that follows the Rules of React, and the lint already found one violation in CardDetail.
- **WebSocket frames.** Coalesce `message.delta` frames per session and client into one frame per 16 to 50 ms, flushed
  before any other event of that session so the order is kept; handle `send()` returning `-1` (queued) by not
  coalescing further into a socket that has not drained, using Bun's `drain` handler. Deltas are not persisted, so
  nothing about replay changes. (The `0` return is already handled.)
- **Terminal flow control.** The client acknowledges written bytes from `terminal.write` callbacks; the daemon keeps the
  unacknowledged window under a high watermark (about 500 KB, so keystrokes stay responsive) and resumes below a low one.
  Bun's PTY cannot pause reading, so above the cap the existing "resync" path stays the safety net. The WebGL addon is
  adopted only if the baseline shows a gain in WebView2.
- **Bundle and start.** `React.lazy` per route in `Screens.tsx` (46 imports today, no lazy anywhere), `server.warmup`
  for the hot files in dev, and Tauri's release profile (`codegen-units = 1`, `lto`, `opt-level = "s"` or `3`,
  `panic = "abort"`, `strip`) plus `build.removeUnusedCommands`. A script prints the chunk sizes so a limit can be held in CI.
- **Measures in the app.** `performance.mark` and `measure` around "click to screen painted" for the five most used
  actions (open session, open board, open card, send, approve), written only when a debug flag is on. The Tauri
  `devtools` feature stays out of the release build.
- **Synchronous `git` (what is left of item 11).** `Bun.spawnSync` stays only where a comment says why
  (`board/worktree.ts exclude()`, which is written in the middle of an answer, and the fake runtime). The rest of
  the daemon asks `git` through `Bun.spawn`. Left to do: the usage indexer reads its cwds in the async part of its pass,
  and the board's project paths are looked up when the daemon starts and when a project is added, so
  `board.budgetBlocked` and the vault's project key find them cached.
- **Idle daemon.** A list of the timers the daemon starts (peers sync every 5 s, the PR watch every `prPollIntervalMs`,
  quota polling, the history scan), each with its reason; none runs when its feature is off.
- **SQLite.** `synchronous = NORMAL` is **pending the user's decision** (see the table). Independent of it: batching a
  burst of persisted events in one transaction only if the baseline for question 9 shows the commits dominate a turn.

## Tests and criteria

Every number is relative to the baseline of the same machine, recorded before the change. "Probe" means the render probe
of the earlier research, turned into a test helper in the first area that needs it.

| Area | What must pass |
| --- | --- |
| `perf-baseline` | the baseline of the section above is in DECISIONS with the machine, the date and the command that produced each number; the render probe is a test helper (`apps/desktop/test`) used by the next areas |
| `hub-list` | `hubRows` and `hubGroups` are computed once per change of their inputs: 100 renders caused by something else cost 0 recomputations (counter); with 9,000 history rows the hub draws at most the cap (200 rows, "show more" for the rest), and its render time at 9,000 rows is within 2x of the time at 690 rows |
| `state-selectors` | the number of files that take `state: AppState` as a prop goes from 35 to at most 10 and the ratchet only lets it go down; a host reconnect or a summary of another host causes 0 commits in screens that do not show it (counter, like `orcamento-render`); commits per quiet minute with three hosts, one offline, drop by at least half against question 4 |
| `react-compiler` | spike on three screens: commits and render ms with the probe, suite green, bundle size; the verdict (adopt, per folder, drop) is written in DECISIONS with the numbers; no code stays in the branch for a "drop" |
| `ws-coalesce` | 200 `message.delta` events in one second reach a client in at most 45 frames (25 ms window) with the same text and order; any other event of the session flushes the pending delta first; a client whose `send` returned `-1` gets no more coalesced growth until `drain`; a reconnecting client resumes from its seq without a hole (fake socket and a real client) |
| `terminal-flow` | with a fake PTY producing 50 MB and a slow client, unacknowledged bytes never pass the high watermark plus one chunk and the stream resumes below the low one; a client that never acknowledges is resynced, not left to grow; key echo p95 during `yes` stays under 100 ms in the packaged app (measured by the maintainer) |
| `bundle-lazy` | the entry chunk is at least 30% smaller (gzip) than the baseline of question 1, every route loads through `React.lazy` with a fallback screen, the existing e2e journeys pass in both languages, and a script prints chunk sizes and fails above the limits recorded in DECISIONS |
| `tauri-release` | `Cargo.toml` has a release profile and `removeUnusedCommands`; `cargo check` passes; the installer or binary of a CI release build is smaller than the baseline of question 2, and the first paint is not slower (maintainer, packaged app) |
| `app-measures` | `performance.mark` and `measure` exist for the five actions with fixed names, are no-ops when the flag is off, and a test asserts the names and that nothing is written to the console |
| `sync-git` | a test with a fake `git` that sleeps shows the protocol still answering (host info under 100 ms) during start-up, a project add and a card start; the indexer's pass calls no `Bun.spawnSync`; a guard test lists the remaining `spawnSync` uses in `apps/daemon/src` and fails on a new one that is not on the list; `board.budgetBlocked` and the vault's project key never spawn `git` on a warmed project |
| `daemon-idle` | a test lists the timers a started daemon owns (name and period) and fails on a new one; with every optional feature off, the idle daemon starts none of the optional ones; idle CPU under 1% over 60 s and the resident memory after a long run are recorded against question 7 (maintainer, Windows service) |
| `sqlite-durability` | **Pending user decision; not started, and not part of this phase's acceptance until the user decides.** If the user accepts `synchronous = NORMAL`: the pragma is set in one place, it is a config option, DECISIONS records the trade (the last events can be lost on a power cut, never a corrupted file; Claude's own transcript stays on disk), and a test shows the option reaches `PRAGMA synchronous`. If not, the row closes with the numbers of question 9 |
| `editor-large` | only if a user opens files of tens of thousands of lines: a 50,000-line file opens and types in the file editor without a long task above 50 ms. No area is started without that report |
| `typescript-ci` | low priority and no user-facing impact: `tsc --extendedDiagnostics` per package is recorded once as a baseline; nothing else is done unless a package takes more than a minute |

**Smoke (`smoke:perf`):** starts a daemon with the fake runtime and a fake `git` that sleeps, streams 1,000 deltas to one
client and a slow one, and checks the frame count of the first, the resync (not growth) of the second, and that the
event-loop delay p99 stays under 100 ms. It prints `SMOKE PERF OK`. It touches no network and no real `git`.

**Acceptance criteria:** the usual ones, except the version. The product version is **not bumped on the phase branch**:
the orchestrator bumps it at release time, because phases land out of order. Also: the baseline is in DECISIONS before
the first area; each area either meets its number or records the numbers that closed it without code; the render-budget
tests (`orcamento-render`, `orcamento-conversa`) and the new ones run in CI in seconds as the regression guard; both
manuals (`docs/manual/en.md` and `pt-BR.md`) mention the debug flag of the measures, if it is user-visible; and the
maintainer's real-machine checks (first paint, key echo during `yes`, installer size, idle service memory) are listed in
the hand-over as his to run, not blocking the tag.
