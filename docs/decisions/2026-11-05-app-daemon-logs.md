# The app and daemon log files (issue #255)

- **No `tauri-plugin-log`.** The issue asked for the plugin. This session has no `cargo`, so the new crate (and its dependencies) could
  not be added to `Cargo.lock`, and a manifest change without its lock breaks a locked build. The shell instead has three std-only commands
  (`append_log`, `read_log_tail`, `open_logs_dir`) over the OS's own app log folder (`app_log_dir`), with the same 5 MB x 5 files rotation
  written by hand and unit-tested in Rust (`log_tests`). None takes a path from the webview. Swapping in the plugin later changes only
  `platform/tauri`.
- **Redaction is the webview's, then the reader's.** Every line goes through `SecretScanner.redact` (new, in the protocol: it replaces what
  `scan` finds with `[redacted]`, leaves a `{{variable}}`, and replaces vault values of 6 characters or more) before it is written or kept in
  memory, and the diagnostics redact the lines again. The daemon does the same before it writes and again when it tails. The scanner is a list
  of shapes, not a proof: the manual says to read a log before posting it.
- **What the app logs:** a host's state changes, every refusal the app shows (`fail`), app update checks and failures, and the webview's
  `error`, `unhandledrejection` and `console.error`/`console.warn`. Update installs and deep links are not logged. A sink that fails is ignored.
- **Copy diagnostics** uses the last 50 lines of the file, or the 200 the app keeps in memory when the file gives none. It is in English
  whatever the app's language: it is for whoever helps. It carries host names, states, versions and features, never a URL or a token.
- **The daemon:** `flightdeckd.log` in `~/.flightdeck/logs` (not under the data dir: it is one folder per user, like the config), rotated,
  every line redacted, one line per message and cut at 2000 characters. `host.info.logPath` and the `logs` feature name it, and
  `logs.tail {lines <= 500}` hands out the last lines. A folder that cannot be written is ignored.
- **Not built:** the daemon's `doctor` naming the path (host.info does), update-install events, and Windows rotation tests (Windows cannot
  rename over an open file: a single writer appends and rotates from the same process, so it never has the file open elsewhere).

### App log: the Rust review (issue #255)

`tauri-rust-reviewer` read the three commands as a compiler (no `cargo` here, so nothing was compiled or run: **CI is the first build of this Rust**). No critical or high finding. Fixed: appends take a lock so two writers at the rotation boundary do not each rotate (M1); a failed rotation still lets lines in, up to twice the file size (L1); `files` is at least 1 (L2); a file with a broken UTF-8 character is read lossily instead of skipped (L3); a line is cut before it is copied (L4); the Rust tests now need the char-boundary loop, cross files, reach the 500-line cap, cover one file and a bad file, and clean up (T1 to T5). Accepted: a compromised webview can flood the log and push history out (L5), as any webview-writable log can; newline and carriage return are removed so a line cannot be forged, other control characters pass.

### App and daemon logs: privacy review (OpenCode, issue #255)

- **The scanner grew** (`packages/protocol/src/snippets.ts`, so snippets, personas and logs share it): a secret word anywhere in a name
  (`DB_PASSWORD`, `clientSecret`, `authToken`), quoted or escaped as in JSON, then `=` or `:`; `--password`/`--token` options; `curl -u`;
  `Authorization`, `Proxy-Authorization`, `Cookie` and `Set-Cookie` headers whole; `Basic`; JWTs; npm, GitLab, Stripe and Google keys;
  Slack and Discord webhooks; signed-link parameters; a 20+ character user in a URL; and the private key as a whole block (to its END line,
  or to the end of a message that was cut short). `redact(text, false)` does not keep a hit for holding `{{ }}`: logs and diagnostics use it,
  snippets keep the old behaviour. Plain words that merely contain `pass` (`bypass=false`, `compass: north`) are left alone. The side
  effect is that `scan` (the snippet refusal) is stricter in the same way.
- **The log scanners know the owner's secrets.** Daemon: `createLogScanner` adds the protocol token (it follows rotations made in the
  config file), `hooks.token` and `Vault.heldValues()` (what the app delivered, in memory for at most 60 s), asked at each line. App: the
  store keeps a memory-only copy of the vault's values (refreshed whenever the vault list changes) and every host token it has seen, and
  hands them to `AppLog` and to Copy diagnostics, which now redacts the whole text (host names included). The host's lines are redacted
  again before they reach the clipboard. A cache of vault values in the webview's memory is the price of a synchronous scanner; nothing of
  it is saved or sent. The daemon's vault never holds values for long, so most of its coverage comes from the token list.
- **The file writes stopped blocking the daemon.** The first push failed the no-sync ratchet and the features list (`logs` was missing from
  `DAEMON_FEATURES` and had no name in the dictionaries). `FileLog` now queues each redacted line on one async chain (ordered, never
  rejects); `tail` and `stop` flush the queue first, so a reader or a shutdown sees every line written.
- **Privacy round 2 (the coordinator asked for the cheap ones).** `scrubHome` (protocol) turns the daemon user's home (`userHome(env)`, even
  with spaces or outside /home) and the usual `/home/<n>`, `/Users/<n>`, `C:\Users\<n>` (also with doubled backslashes) into `~` in every
  daemon line (write and tail), every app line, Copy diagnostics and the host lines copied; `logPath` is not scrubbed (it is for the owner to
  open, and now only loopback/Tailscale connections get it). `logs.tail` and `host.info.logPath` go through `requireVaultTransport` (like
  `roots.add`) in `logs/serve.ts`, so the rule is unit-tested with real origins; the `logs` feature is still listed to every client, a
  remote one just gets `transport_refused`. The daemon creates the folder 0700 and the file 0600, opens with `O_NOFOLLOW` (and an `lstat`
  where a system lacks the flag), and `tail` reads only the last 256 KiB of each regular file (a window that starts mid-line drops the
  piece), so an `id_rsa` behind a link or a 10 MB file costs nothing. The Rust side does the same (`DirBuilderExt::mode(0o700)`,
  `OpenOptionsExt::mode(0o600)`, `symlink_metadata` refusal, a seek to the last 256 KiB); there is no `O_NOFOLLOW` there because `libc` is
  not a dependency, so the check is `lstat` then open (a race the owner of the folder can win; the folder is 0700).
- **Not done (issue #259, later):** a rate limit and a batched or single-writer sink in the app, a re-entrancy guard and idempotent install of
  the console overrides, and Rust tests for flood and rotation behaviour.
