# Flightdeck — Phase 35 spec (Google sign-in and encrypted Drive backup)

## Goal

GitHub issue #13: sign in with a Google account and back up Flightdeck's data to the person's Google Drive, then
restore it on a new machine. The data is the settings, the personas, the snippets and prompts, the hosts list and the
vault (passwords and secrets). The research, with sources and the points not yet verified, is in
`flightdeck-handoff/google-backup-research.md`.

Prerequisites: phase 16 (the vault, the keyring and the `.fdvault` format), phases 19 and 20 (personas, snippets).

Decisions already taken from the research (record any divergence in DECISIONS):

- **Scope:** only `drive.appdata` (non-sensitive, a hidden folder only this app can read). Never `drive` or `drive.file`.
- **Sign-in:** the system browser, PKCE with `S256`, a `127.0.0.1` loopback redirect on a random port. No custom
  URI scheme and no copy/paste code (Google no longer supports them).
- **Encryption:** on the device, before upload, with the `age` passphrase format that `.fdvault` already uses
  (scrypt). No new cipher and no new dependency. Google only ever holds an opaque blob.
- **Refresh token:** the OS keyring (service `flightdeck-google`), never a file, never `storage`, never a log.
- **Where the logic lives:** TypeScript in the app (PKCE, token calls, Drive calls, the bundle, the crypto), with
  an injected `fetch`. The Rust shell only opens the browser and runs the one-shot loopback listener, and reuses the
  keyring path it already has. This keeps the part that needs tests inside the part that has tests.

## Proof of concept first

Not code: two checks that need the maintainer's Google account and decide the launch, not the design. Results go to
DECISIONS.

1. Create the Cloud project, the consent screen (with a privacy-policy page) and a Desktop client; switch to
   **In production**. Confirm whether the refresh token then lasts, and what the consent screen shows for an app
   that is not brand-verified.
2. With the real client, one manual sign-in, one upload to `appDataFolder` and one download, to confirm that a call
   without `client_secret` is accepted and to record the token size (the Windows credential store caps an entry at
   2560 bytes).

The areas below run entirely against fakes and do not wait for these.

## Design

**What is backed up** (one bundle, `backup.v1`):

| Part | Source | Notes |
| --- | --- | --- |
| Settings | `Platform.storage`, an allow-list of keys | Preferences only (tray, shortcut, language, list widths). Never session metadata, caches, alert state or workspace layout. |
| Hosts list | `Platform.storage` | Name, URL, id. **Host tokens are not included**: they are paired per device, and a restored host asks to pair again. |
| Personas | each host's daemon, through the protocol | Global and per project. |
| Snippets and prompts | each host's daemon, through the protocol | Global and per project. |
| Vault | metadata in `storage`, values in the keyring `flightdeck-vault` | The same entries as a `.fdvault` export. |

The bundle has a manifest: format version, app version, creation time, device name, and the list of parts with
counts (never values).

**Encryption and the passphrase**

- The whole bundle goes through one `age` passphrase envelope, vault included: settings and prompts are private too.
- The passphrase is chosen by the person, at least 12 characters (`MIN_PASSPHRASE`), confirmed twice, never stored,
  never sent anywhere. The app asks for it on every backup and restore, and keeps it in memory only while a scheduled
  backup is armed in that session (see "Schedule").
- A wrong passphrase and a tampered file both end in the same refusal ("could not decrypt"), with no partial restore.
- The manifest is **inside** the envelope. What Google sees is the file name, the size and the time.

**Google sign-in**

- "Sign in with Google" opens the system browser; the loopback page tells the person to return to the app.
- The state and the `code_verifier` are random per attempt; a response with another `state`, or after 5 minutes, is
  refused. The listener closes after one request.
- The access token lives in memory. The refresh token goes to the keyring. When the keyring write fails (Linux
  without a Secret Service), the person is told and signs in again at the next start; nothing is written to disk.
- "Sign out" revokes the token at Google, deletes the keyring entry and forgets the account. The Drive backups stay
  (the person decides whether to delete them: a second action, with a confirm).
- A 401 refreshes once and retries once; a revoked refresh token turns into a "sign in again" state, not an error loop.

**Drive storage**

- Files live in `appDataFolder`. Name: `flightdeck-backup-<ISO time>-<device>.fdbackup`. The kind, the format version
  and the device go in `appProperties`, so listing never needs to download.
- **Versions:** keep the last N (default 10, range 1 to 50, a setting). After a successful upload the oldest above N
  are deleted. The prune never runs after a failed upload, never touches a file this app did not name, and never
  deletes the newest.
- Listing pages through `pageToken`. A listing or an upload that fails leaves the local data untouched.

**Back up: manual and scheduled**

- "Back up now" builds the bundle, asks for the passphrase, encrypts, uploads, prunes, and reports the result with the
  time and the size.
- **Schedule** (optional, off by default): daily or weekly, **only while the app is open** (no background service,
  no daemon involvement). A scheduled run needs the passphrase: the app asks once per session when the person
  turns the schedule on, keeps it in memory, and forgets it when the app closes; after a restart the schedule shows
  "paused: enter the passphrase" until it is typed again. It never stores the passphrase to run unattended.
- One run at a time; a second request while one runs is ignored. A failed scheduled run shows a notice and the
  next attempt is at the next slot, with no retry storm.

**Restore**

- The person picks a backup from the list (time, device, size, app version), enters the passphrase, and the app
  decrypts **in memory** and shows a preview before anything changes.
- **Preview**, per part, one row per item: new (not on this device), same, changed (both differ, with a short diff of
  the fields, never a secret value), and "only here" (on this device, not in the backup; kept by default).
- The person picks per item or per part: skip or overwrite. Default: add the new, skip the changed, keep "only here".
  Nothing is deleted from this device unless the person asks for it by item.
- Before applying, the app writes a **local snapshot** of what it is about to replace (the same bundle, encrypted with
  the same passphrase, saved through the save dialog or kept in the app's data folder for 7 days). One "Undo restore"
  puts it back.
- A backup from a newer format version is refused with the reason; an older one is migrated in memory.
- Applying is per part and reports what was written. A failure in one part (a host that is offline for personas)
  leaves the others applied and lists what is left, with a retry.

**Threat model**

| Threat | Result |
| --- | --- |
| Google, or anyone with the Drive account, reads the backup | Sees an opaque age blob. Needs the passphrase. |
| Someone steals the Google account | Can download and delete backups; can try the passphrase offline. The 12-character floor and scrypt (work factor 18) slow this down, they do not stop a weak passphrase. The UI says so. |
| The refresh token is stolen from the device | Only `drive.appdata`: access to Flightdeck's blobs, not to the person's Drive. Kept in the OS keyring. |
| The passphrase is lost | The backup is unrecoverable, and so are the secrets in it. There is no recovery and no escrow. The UI says it on setup, in the passphrase step, in plain words. |
| A backup is tampered with, truncated or replayed with an older one | age authenticates the payload: a changed file is refused. An old valid backup restores old data: the preview shows its time and the person confirms. |
| A rogue page or log leaks a token or value | Tokens and values are never logged (a test greps the logs); the redirect page shows no code. |
| The loopback listener is hit by another local process | Random port, random `state`, single use, 5-minute window; PKCE makes a stolen code useless without the verifier. |
| A restore overwrites good local data | Preview first, defaults that never overwrite, a local snapshot and "Undo restore". |

**Out of scope:** sharing a backup between people, backing up session transcripts or costs, background backups with
the app closed, other cloud providers, recovery of a lost passphrase, brand verification work itself (maintainer).

## Tests and criteria

Tests use fakes only: a fake `fetch` standing in for Google's OAuth and Drive endpoints, a fake loopback and browser,
the fake platform (storage, secrets, vault in memory, never the real keyring), a fake clock and a low scrypt work
factor. No network.

| Area | What must pass |
| --- | --- |
| `backup-bundle` | collects only allow-listed settings, the hosts list **without tokens**, personas, snippets and vault entries; the manifest counts match and hold no values; a bundle round-trips; unknown keys are left out; nothing from session metadata or caches |
| `backup-crypto` | seal and open with the age envelope; passphrase under 12 refused; wrong passphrase and a flipped byte give the same refusal; the manifest is unreadable without the passphrase; no plaintext marker in the sealed bytes |
| `google-oauth` | authorization URL carries `S256`, a fresh `state`, the loopback redirect and only `drive.appdata`; a wrong `state`, a timeout and a second request are refused; code exchange sends the verifier; refresh and revoke call the right endpoints; no secret or token reaches the log |
| `google-session` | refresh token goes to the keyring service `flightdeck-google` and nowhere in `storage`; a failing keyring leaves a memory-only session with a clear state; sign-out revokes, deletes the entry and clears the account; a revoked refresh token gives "sign in again" without a loop |
| `drive-appdata` | create with `parents: appDataFolder`, list with `spaces=appDataFolder` across pages, download by id, delete by id; 401 refreshes once then retries once; 403 quota and 5xx map to distinct states; nothing outside the app folder is ever requested |
| `backup-versions` | names sort by time; keep N, delete the oldest above N; no prune after a failed upload; foreign files untouched; the newest is never deleted; N out of range is clamped |
| `backup-run` | manual run uploads a sealed bundle and reports time and size; one run at a time; a failed upload keeps the previous versions and reports the reason; the passphrase is not in any stored value |
| `backup-schedule` | daily and weekly slots on a fake clock; only while armed with a passphrase in memory; after a restart it is paused until the passphrase is typed; a failure does not retry before the next slot |
| `restore-preview` | per part: new, same, changed and only-here are classified; the diff shows field names, never secret values; defaults never overwrite and never delete; wrong passphrase and tampered file change nothing; a newer format is refused with the reason |
| `restore-apply` | applies the chosen items per part; a local snapshot is written before; "Undo restore" brings the old state back; an offline host leaves its part pending with a retry; the vault values land in the keyring through the fake and not in `storage` |
| `backup-ui` | the Settings "Backup" panel: sign-in state, passphrase step with the lost-passphrase warning, Back up now, schedule, versions list with the keep-N setting, restore preview with per-item choices, undo; every text in both languages; keyboard reachable; axe clean |
| `backup-smoke` | `smoke:backup` runs sign-in, backup, prune and restore against a local fake Google server and prints `SMOKE BACKUP OK` |

**TDD order:** `backup-bundle`, `backup-crypto`, `google-oauth`, `google-session`, `drive-appdata`, `backup-versions`,
`backup-run`, `backup-schedule`, `restore-preview`, `restore-apply`, `backup-ui`, `backup-smoke`. Each is one cycle
of the `tdd-area` skill (stub with wrong values, red by assertion, test commit, feat commit). The Rust additions (the
loopback listener and the browser opener) are reviewed with the `tauri-rust-reviewer` agent and compiled by CI.

**Locks:**

- The real keyring, the real network and the real browser are never used in tests.
- No code path writes a token, a passphrase or a secret value to a file, to `storage` or to a log.
- The only Google scope in the code is `https://www.googleapis.com/auth/drive.appdata`; a test fails on any other.
- The new Rust commands are async with `spawn_blocking` and the no-sync ratchet stays at its baseline.

**Acceptance criteria:** the usual ones and the real-account check of "Proof of concept first" recorded in DECISIONS, a
manual step list in both manuals (sign in, back up, restore on a second profile), the privacy-policy page linked from
the consent screen, and the spec-verifier's verdict is accept.

**Open questions for the maintainer** (a default is given; the phase follows the default unless told otherwise):

1. Include host tokens in the backup? Default: no (re-pair on the new machine).
2. Keep the local restore snapshot for 7 days, or save it only through a file dialog? Default: 7 days in the data folder.
3. One backup per device name, or one shared line of versions? Default: one shared line, device in the name.
4. Brand verification before launch? Default: yes if the checklist is only a homepage and a privacy policy.
