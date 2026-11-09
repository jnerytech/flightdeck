# Google Drive backup target (issue #1444)

Slice 2 of #58 (#13). #1241 and #1264 shipped the encrypted bundle, the restore preview and the
schedule to a folder. This slice adds the second place, Google Drive, without the part that waits on
the maintainer: the Google Cloud project (#57).

## What it does

- **`BackupTarget`** (`lib/backup-target.ts`): `put`, `list`, `get`, `remove`. The folder of #1264
  (`folderTarget`) and Drive (`driveTarget`) implement it. `keepNewest(target, keep, protect)` is the
  delete-oldest rule, written once over any target: the file just put is never removed, and a name
  that is not shaped like a backup is never touched. The Rust shell has no read command for the
  folder, so `folderTarget.get` rejects as unsupported; nothing calls `get` yet.
- **Drive target** (`lib/drive-target.ts`): Drive v3 over an injected `fetch`, in `appDataFolder`
  (the app sees only its own files, and the scope is `drive.appdata`, not the whole Drive). The upload
  is resumable: a POST with the metadata, then a PUT of the already-encrypted text to the session
  address. That address comes from a response, so it is used only when it is Google's upload address,
  and without the token. A 401 asks for a fresh token once and retries; a second 401 is an `auth`
  failure, so a revoked sign-in stops at once.
- **Sign-in** (`lib/google-oauth.ts`): the desktop loopback flow with PKCE (S256) and a `state` check.
  The refresh token goes only to the vault (`REFRESH_TOKEN_ID`, with no vault metadata, so no screen
  lists it and no backup carries it); the access token stays in memory. A refresh Google refuses drops
  the token and reads as an `auth` failure; a network failure keeps it. Nothing is logged and no error
  carries a token.
- **Schedule** (`lib/backup-schedule.ts`, `backup-scheduler.ts`): the schedule gets a `target`
  (`folder` or `drive`, folder by default). A Drive run needs no folder. A sign-in that is missing or
  refused is a skipped run with the reason `drive-auth`, said once to the bell and in Settings.
- **Settings**: the choice **Where to save** and the Google sign-in appear only where `Platform.oauthLoopback`
  exists and a client id is configured. Without them the screen is the one of #1264.

## Decisions

- **No client id until #57.** `VITE_GOOGLE_CLIENT_ID` (and an optional `VITE_GOOGLE_CLIENT_SECRET`,
  which Google issues with a desktop client and does not treat as confidential) is read at build time.
  With none, Drive is hidden, and a saved Drive target falls back to the folder.
- **The loopback listener is a Platform capability, `oauthLoopback`.** The browser build has none.
  This slice defines the interface and the TypeScript side; the Rust listener that answers the
  browser's one request on 127.0.0.1 is the next slice. Until it exists no shell offers Drive, so
  nothing reaches Google.
- **Fakes only.** The tests inject `fetch` with a fake Drive and a fake token endpoint
  (`test/fake-google.ts`). No network, no real token.
- **Not done here:** revoking the token at Google on sign-out (the vault copy is removed; revoking is
  a call to Google that can wait), restoring from Drive (needs a list-and-pick screen over `get`), and
  the Rust loopback listener.
