# AI assistant: provider keys, the magic wand, commit and PR messages (phase 40)

- **Base.** `fase-40` starts from `rc/0364` (v0.36.4), not from `main`: the spec was reviewed against that tree, and
  `spec:lint`, the usage indexer's current shape and the Costs page it describes are there. When v0.36.4 is tagged, `main`
  fast-forwards to it, and the branch merges `origin/main`; it is never rebased.
- **The spec's review** (fd-developer, 2026-11-05, against `rc/0364`) is applied in `docs/SPEC-fase-40.md`:
  - `risk.ts` exports `isCredentialPath`, in a commit of its own before `assistant-context`.
  - `UsageIndexer.record` gains optional `messageId`, `origin`, `provider` and `costUsd`.
  - The Rust guards are `pub` functions, and the `#[tauri::command]`s wrap them, because an integration test reaches only
    `pub` items. `spawn_blocking_result` moves to a shared `pub(crate)` module.
  - A word diff is new in `lib/`.
  - `Mod+I` gets a dictionary key, `shortcuts.assistField`.
  - The "add an Anthropic key" scenario stays out of the e2e, which runs on the web build.
  The research behind the spec is `docs/research-fase-40.md`.
- **Open questions.** The phase follows each default of the spec's list until the maintainer says otherwise.

## Phase 40: the daemon slice, first part

- **The refusal texts have their own namespace.** Every assistant refusal reason, whether the daemon or the Rust shell raises
  it, is in `ASSISTANT_REASONS` (`packages/protocol/src/assistant.ts`). Its text lives in `assistantRefusal` in both
  dictionaries, as the snippet model's reasons do, and not in `DAEMON_REASONS`, which stays the daemon's other refusals. The
  protocol test reads the two dictionaries' `assistantRefusal` blocks as text, because importing the app's i18n would pull
  the app into the protocol package's typecheck. Typecheck already keeps `en` and `pt-BR` on the same keys.
- **The prompts are their own module** (`packages/protocol/src/assistant-prompts.ts`), beside the schemas, both exported
  from the protocol. A refusal before any call is an `AssistantRefusal` (`reason`, `params`), which the daemon and the app
  turn into their own errors.
- **Commit notices are codes:** `subject_too_long`, `subject_trailing_period`, `subject_not_conventional` and
  `body_needs_blank_line`. The app translates them; the message is shown with them, never discarded.
- **`isCredentialPath` is an alias.** `risk.ts` exports `credential` exactly as fase-39 does (the same line), plus
  `isCredentialPath = credential` on a line of its own, so the two phases merge without a conflict and fase-39's import keeps
  working.
- **Migration order with fase-39.** Both phases append one migration: fase-39 `sessions.runtime`, phase 40
  `usage_entries.provider`. When both land, each keeps its own entry in `MIGRATIONS`. A database is never migrated by a
  build of only one of them in a release, so the order the merge leaves is the order every released database gets.
- **The usage helper of the tests names its columns.** `usage-helpers.ts` reads the columns from before this phase, so the
  existing usage tests stay as they were, and only `assistant-usage` reads `provider`.
- **A logged-out `claude`** answers `subtype: "success"` with `is_error: true` and the reason as its result. `complete`
  maps that to `assistant_host_unavailable { detail }`, like a spawn failure. Proof of concept 3 confirms the shape.

## Phase 40: ADR 40-3, the Rust logic in a crate of its own

- **Decision.** The assistant's Rust logic (the key store, the two providers' request builders and response mappers, the
  guards: caps, token bucket, in-flight limit, cancel) lives in the crate `flightdeck-assistant`
  (`apps/desktop/src-tauri/assistant/`), which does not depend on Tauri. `src-tauri/src/assistant.rs` keeps only the
  `#[tauri::command]` wrappers and the shared `spawn_blocking_result`. `src-tauri` becomes a workspace with members
  `.` and `assistant`, both in `default-members`, so CI's `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`
  runs the crate's tests too.
- **Why.** The Tauri crate does not build on the development host without the webkit and GTK dev packages (a `sudo`
  install); the crate does, so its tests run there and in CI. The spec's integration test already reached only `pub`
  items, and the providers' logic is mostly pure (a request built from inputs, a result mapped from status and body).
- **The spec follows it.** The areas table names `assistant/src/{keys,anthropic,openrouter}.rs` and
  `assistant/tests/guard.rs`; `spec-lint` accepts a crate one level inside `src-tauri`.
- **tokio as a dev-dependency** at the version already in the lock (through Tauri): the async tests need a runtime, and
  no new crate enters the lock. The spec's "no new dev-dependency" is read as no HTTP mocking crate: the fake server is
  `std::net::TcpListener` on loopback.
- **TLS** mirrors the updater: `reqwest` with `rustls-no-provider`, and the ring `CryptoProvider` installed when none is.

## Phase 40: the privacy review of the daemon slice

OpenCode's review found three highs, fixed before the Rust slice:

- **A link is never followed.** An untracked file is read through `readRegular` (`apps/daemon/src/read-regular.ts`):
  `lstat`, a regular file only, opened with `O_NOFOLLOW | O_NONBLOCK` (where they exist), checked again with `fstat`, and
  read up to a cap. A link or a pipe is listed like a binary file, without content. The rule is in `untrackedFile`, so
  the Changes panel takes it too: a link to a file outside the worktree no longer shows its target there either, and a
  pipe can no longer hang it. The 256 KB size cap is the assistant's only (`workingDiff`'s `maxUntracked`): the panel
  still shows a large untracked file whole, and its editor says when the file is too large to edit. Git itself never lists an untracked pipe; the guard is for a file
  swapped between the listing and the read.
- **The rules are read the same way.** `extractRules` is async and reads 64 KB of `CLAUDE.md` and `AGENTS.md` and 1 KB of
  the commitlint config and `.gitmessage`, each only when it is a regular file.
- **One scanner.** The secret patterns are app-logs' (`0e2331fd2`: named secrets such as `DB_PASSWORD=` or
  `clientSecret:`, option and curl passwords, auth headers, cookies, Basic credentials, JWTs, service keys, webhooks,
  signed URLs, and a private key's whole block), ported as the same text so the two branches merge cleanly. The diff is
  scanned line by line, so it also takes out every line from a `BEGIN ... PRIVATE KEY` line to its `END` line. The two
  history and trace-export tests take app-logs' updated expectations too.
