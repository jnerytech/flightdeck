# Google Drive backup: the Rust listener, the CSP and the restore (issue #1462)

Slice 3 of #58 (#13), after the desktop side of #1444 (see `2026-11-09-google-drive-backup.md`).

## The listener (`src-tauri/src/oauth_loopback.rs`)

Plain `std`, so its tests run without the Tauri runtime. It does what the security review of #1444
asked of the Rust side:

- binds `127.0.0.1` on a port the system picks; the port is given back to the app, which builds the
  `redirect_uri` from it;
- takes a request only with the `Host` header `127.0.0.1:<port>` (421 otherwise): a page that rebinds a
  name to 127.0.0.1 sends its own name;
- takes only `GET /`; the other methods and paths are answered (405, 404) and ignored;
- checks the `state` itself, before it looks at anything else: a request without it or with another is
  answered 400 and ignored, so a stray local request cannot end the wait; the app keeps its own check;
- `error=` with the right state ends the wait as "refused" (`null`), never a code;
- the first good request is answered with a static page that echoes nothing, and the listener closes
  (one use); it gives up at 5 minutes, or when cancelled;
- a connection has 2 seconds to send its headers and 8 KiB to do it, and they are served one at a time;
- the code is never printed or logged, and `Outcome`'s `Debug` leaves it out.

The PKCE check stays in the app: the verifier is sent to Google in the token request, and the listener
never sees it. Three Tauri commands carry it: `oauth_loopback_listen(state)` (`{id, port}`),
`oauth_loopback_wait(id)` (the code or null) and `oauth_loopback_cancel(id)`. One sign-in at a time: a
new `listen` cancels the one before. `Platform.oauthLoopback.listen(state)` now takes the state.

## The CSP

`connect-src` gains `https://oauth2.googleapis.com` and `https://www.googleapis.com`, and nothing else
(no `https:`, no wildcard): the webview's `fetch` calls Google for the token and the Drive files. This
is a change to phase 40's rule that the CSP has no `https:`; `scripts/test/assistant/csp.test.ts` now
pins the exact two hosts.

## Restore from Drive

`BackupAllPanel` offers **Restore from** (a file, or Google Drive) only where Drive is available. **Look
in Google Drive** lists the backups of `appDataFolder`, newest first; one is read into the same
`previewRestore` as a file, with the same size limit, and the same confirm applies it. A Drive that
refuses the sign-in says `drive-auth` (sign in again under Scheduled backups); any other failure says
`drive-failed`.

## Not done here

- `cargo check` and `cargo test` of the whole shell run in CI; the listener's own tests also run on a
  machine without the Tauri libraries.
- Deleting a backup from Drive by hand, and restoring a Drive backup that is over 1 MiB.
