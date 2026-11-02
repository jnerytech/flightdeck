# Flightdeck — Phase 30 spec (Session summary and webhook notifications)

## Goal

Today a person learns that a session needs them only while the app is open and in view: "Needs you", the tray and the
desktop notification. Away from the desk (phone, another screen, a team channel) nothing reaches them, and when it does
(a desktop toast) it says "session X is waiting" with no hint of what the session was doing. Two gaps:

- **No summary.** To decide whether a session is worth attention, you must open it. A short per-session summary (what was
  asked, what was done, files touched, cost, the open question) answers that at a glance and also makes a useful message.
- **No outbound channel.** Slack, Discord or any HTTP endpoint cannot be told when something happens.

Prerequisites: Phase 5 (central, hooks), Phase 16 (vault), Phase 22 (PR watch), the budgets of Phase 28/29 and the usage
indexer.

Research (from the services' documented behavior; the real services are never called by tests):

- **Slack incoming webhook:** `POST` JSON `{"text": "..."}` (optionally `blocks`) to `https://hooks.slack.com/services/...`.
  The URL is the secret. Answers `200 ok`; `429` carries `Retry-After`; about 1 message per second per webhook; `4xx` such as
  `invalid_payload` or `no_service` (revoked URL) never succeeds on retry.
- **Discord webhook:** `POST` JSON `{"content": "...", "embeds": [...]}` to `https://discord.com/api/webhooks/<id>/<token>`.
  `content` is at most 2000 characters, an embed description at most 4096. `429` answers JSON with `retry_after` (seconds) and
  a `Retry-After` header. `404` means the webhook was deleted.
- **Generic JSON webhook:** `POST` of a JSON envelope with `X-Flightdeck-Event`, `X-Flightdeck-Delivery` (a ULID, the idempotency
  key), `X-Flightdeck-Timestamp` (Unix seconds) and `X-Flightdeck-Signature: sha256=<hex>`, the HMAC-SHA256 (documented in both manuals, with a verification example) of
  `"<timestamp>.<body>"` with a per-target signing secret. The receiver rejects a timestamp older than 5 minutes (replay).
- **The summary needs no model call.** Everything asked for is already in the transcript and the indexer: the first prompt of
  the session (what was asked), the last assistant text (what was done), the `Edit`/`Write`/`NotebookEdit` paths (files touched),
  `usage_entries` (cost), and the pending permission or `AskUserQuestion` (the open question). A model-written summary
  (`claude -p --model haiku`) costs quota and is a non-goal of this phase; the summary has a `source` field so one can be added later.

## Proof of concept first

None against the real services: the formats above are stable and documented. One local check, before the `summary-*` areas, on
the transcript fixtures of the repo: confirm that the first user prompt, the last assistant text and the tool-use paths can be
extracted from the real transcript shapes (main file, `isSidechain` entries, tool results as user turns, command and
`<system-reminder>` wrapper messages that are not a prompt). The result goes to DECISIONS and fixes the extraction rules.

## Design

### Summary (daemon, `apps/daemon/src/summary/`)

- `buildSummary(transcript, usage, pending)` is a pure function, truncated to hard limits (asked 280 chars, done 480, at most 12
  files plus "and N more", the question 280). It is built from the transcript tail and head only, never the whole file.
- `SessionSummary`: `asked`, `done`, `files: string[]`, `filesMore: number`, `costUsd | null`, `question | null`, `state`,
  `updatedAt`, `source: "transcript"`. Secrets are masked by the existing secret scan (Phase 11) before the summary leaves the
  function, so a pasted key never reaches the app or a webhook.
- Command `session.summary { sessionId }` returns it; the frame `session.summary.updated` is sent on a state change, not on
  every delta (coalesced, at most one per session per 5 s).
- Terminal and external (hook) sessions both work; a session with no transcript yet answers `null`.

### Events and where they are sent from

The events already exist in the app: a permission or question (needs-you), a session that ended or failed, a budget threshold
crossed, a PR-watch result. **Dispatch lives in the app**, not in the daemon, because the vault is the app's: the daemon only
holds a delivered secret for at most 60 s and never stores one (Phase 16), so a daemon-side webhook URL would break that rule.
The cost is that webhooks fire only while the app runs; this is recorded in DECISIONS and in the manual. A target may be scoped
to one host or to all hosts ("global"); an event from a host is sent to the global targets and that host's targets.

- Event kinds: `needs_you`, `session_ended`, `session_failed`, `budget_alert`, `pr_watch`. Each target picks the kinds it wants,
  and optionally "only this client" (Phase 29).
- Each message is built from one neutral `NotifyEvent` (kind, host, project, session title, summary) by a formatter per target
  type: `slack` (text plus blocks), `discord` (content plus one embed, within the limits), `generic` (the signed envelope).

### Targets, secrets and sending (app)

- A target is `{ id, name, type, hostScope, kinds, clientId?, enabled, secretRef }`. It is kept in the app settings **without the
  URL**: the URL (and the generic signing secret) is a vault secret, referenced by `secretRef`. Nothing secret goes to a log,
  an export, a screenshot or the config file; the target list shows only the host name of the URL (`hooks.slack.com`).
- Only `https://` URLs are accepted (plain `http://` only for loopback, so a receiver can be tested). No redirects are followed.
  After DNS resolution `webhook_send` also refuses private, link-local, unique-local and unspecified addresses (SSRF), loopback
  over `http` excepted; the resolver is injected so tests need no network.
- The Webhooks screen says, next to the list, that webhooks are sent only while the app is running.
- **Rate limit and retry:** a queue per target, one send at a time, at most 1 message per second; bursts of the same kind for
  the same session are merged into one message ("3 sessions need you"). A failure is retried with exponential backoff
  (2 s, 8 s, 32 s, jittered, at most 4 tries), honoring `Retry-After`; a permanent `4xx` (not `429`, `408`) stops at once and
  marks the target "failing" with the last status, with no further tries until the person edits it or taps Test. The queue is
  bounded (100); older entries are dropped and counted.
- **Test button:** sends a sample event to the target and shows the status and the time, never the response body.
- Sending uses a small Rust command (`webhook_send`: URL from the vault, headers, body, 10 s timeout, no redirects, response
  status only), the only new Rust surface; the `tauri-rust-reviewer` checks it. The web build has no sender and hides the screen.

### Screens (both languages, both themes)

- **Session summary** in the session detail and as a tooltip on the Sessions row; "Copy summary".
- **Settings → Notifications → Webhooks:** the list of targets with state (ok, failing, disabled), add/edit (type, name, URL,
  scope, kinds), Test, enable/disable, delete (also deletes the vault secret).
- The desktop notification body uses the summary question when there is one.

## Tests and criteria

| Area | What must pass |
| --- | --- |
| `resumo-extrair` | from transcript fixtures: first real prompt (command and system-reminder wrappers skipped), last assistant text, file paths from `Edit`/`Write`/`NotebookEdit` deduplicated and capped with "and N more", open question from a pending permission or `AskUserQuestion`, sidechain entries ignored, a transcript with no prompt or no answer gives `null` fields, no crash on a corrupt line |
| `resumo-limites` | every field is cut at its limit on a character boundary, a secret in the prompt or the answer is masked, cost comes from `usage_entries` and is `null` without rows |
| `resumo-protocolo` | `session.summary` and `session.summary.updated` parse; an older daemon without them is handled by the app; the update is coalesced to one per session per 5 s |
| `webhook-formatar` | Slack, Discord and generic output for each event kind, Discord limits (2000/4096) respected, the generic signature equals the HMAC-SHA256 of `timestamp.body`, timestamp and delivery id present, the summary included, text escaped (no Slack `<!channel>` or Discord `@everyone` injection from a session title) |
| `webhook-alvos` | target model: add, edit, delete (secret deleted too), host scope and global, kind and client filters, the URL never present in the stored settings, the export or any log line; `http://` refused except loopback; the list shows only the URL host |
| `webhook-fila` | one send at a time per target, 1/s pacing, merging of bursts, backoff schedule with an injected clock and jitter, `Retry-After` honored, permanent `4xx` stops and marks "failing", `429`/`5xx`/network errors retry up to 4 times, bounded queue drops the oldest and counts, a disabled target sends nothing |
| `webhook-eventos` | each of the five events reaches the matching targets exactly once (needs-you, ended, failed, budget threshold, PR-watch result); a host-scoped target ignores other hosts; a replayed `delivery` id is not sent twice |
| `webhook-teste` | the Test button sends the sample event, shows status and time, never the body; a failing target recovers after a good test |
| `webhook-rust` | the `webhook_send` command refuses a URL that is not `https://` (or loopback `http`), refuses a name that resolves to a private, link-local, unique-local or unspecified address (injected resolver; a name with one public and one private answer is refused), does not follow redirects, times out at 10 s, returns the status only (Rust unit tests; `cargo check` after `build:desktop`) |
| `resumo-ui` | summary in the detail, the row tooltip, Copy, empty state, in both languages and themes; axe clean |
| `webhook-ui` | the Webhooks list and form, state badges, Test, validation messages, the vault step for the URL, the "only while the app runs" notice, hidden on the web build, in both languages and themes; axe clean |

Smoke `smoke:webhook` (printing `SMOKE WEBHOOK OK`): a local HTTP server stands in for the three receivers; fake daemon events
drive each kind; it checks the three payload shapes, the signature, a `429` then success (retry), and a permanent `404` that
stops.

**Acceptance criteria:** the usual ones and: no webhook URL or signing secret appears in any log, setting, export or print; the
sender is the only new Rust surface and passes the Rust review; the manuals (en, pt-BR) explain the targets, the vault step, the
"app must be running" limit and the summary; and DECISIONS records the PoC result, the app-side dispatch and the transcript-only
summary.
