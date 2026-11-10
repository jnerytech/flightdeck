# Phase 30: session summary and webhooks (phase 30)

- **The summary is built from the transcript, with no model call.** `session.summary` (feature
  `summary`) reads the indexed transcript and the usage entries: the first real prompt (command
  wrappers and `<system-reminder>` turns skipped), Claude's last text, the paths of `Edit`, `Write`
  and `NotebookEdit` calls (12, deduplicated, then a count), the summed cost and the question the
  caller passes. Sidechain entries are ignored. Fields are cut at 280/480/280 characters on a
  character boundary, and a field the secret scanner flags is replaced by `[secret hidden]`. A
  model-written summary stays out; `source: "transcript"` leaves room for one.
- **Proof of concept: skipped as a separate run, covered by fixtures.** The spec asked to check, on
  the repo's transcript fixtures, that the first prompt, Claude's last text and the tool-use paths
  can be extracted. No separate probe was run: the rules above were written against the shapes of
  `apps/daemon/test/fixtures/trace` and the transcript reader of phase 8, and `resumo-extrair`
  pins them (wrappers, sidechain, tool-result turns, odd content, corrupt lines). A check against
  real transcripts of a real Claude session was not done and belongs to the user's tests at the end.
- **Version.** The branch does not bump it, as every phase branch (CLAUDE.md): the maintainer sets
  it at release with the `test(versao)` cycle.
- **The type is `SessionRecap`.** `SessionSummary` already names the managed-session list line, so
  the new schema has another name. The command is `session.summary` and is not the event frame of
  the same name (commands and frames are different namespaces).
- **No `session.summary.updated` frame.** The spec had one; the app reads the summary when a
  session's page opens or moves on (`stamp`), and when a webhook event is built, so a pushed update
  would have no reader. The panel is on terminal sessions and on managed sessions (their page knows Claude's session id from
  `session.init` or the Sessions list). There is no tooltip on the Sessions rows (a request
  per row would cost more than it tells); the desktop notification body is unchanged.
- **The app sends the webhooks, through a host.** The vault is the app's: a daemon holds a secret
  for one use at most (phase 16). So targets live in the app (`flightdeck.webhooks`, no secret in
  them); the address and the signing secret are vault values (`webhook:<id>`, `webhook-sign:<id>`).
  Events are built from what the app already sees (`WebhookFeed`), not gated by window focus. The
  limit is visible on the screen: nothing is sent while the app is closed, and an event of a day
  the app was closed is not sent later.
- **The post is made by the daemon (`webhook.send`), not by Rust.** The first design was a Tauri
  command. This Pi has no Rust toolchain, so a new `reqwest` dependency and its `Cargo.lock` change
  could be neither compiled nor tested, and CI only runs `cargo check`. The daemon path is testable
  with a fake resolver and fetch, needs no Rust review, and works on the web build. The address
  arrives for that one post over the vault transport (`requireVaultTransport`: loopback or
  Tailscale), is never stored and is in no log line (a test reads the logs); the answer carries
  the status, `Retry-After` and a refusal reason, never the body.
- **What the daemon refuses.** `https` (plain `http` only to `localhost`, `127.0.0.1`, `[::1]`
  whose resolved addresses are all loopback), no credentials in the URL, no redirect followed, 10 s,
  only `Content-Type` and `X-Flightdeck-*` headers, at most 100 KB, and after resolving the name
  every address must be public: private, loopback, link-local, unique-local, CGNAT (100.64/10,
  Tailscale), multicast, unspecified and IPv4-mapped forms of those are refused. A refusal counts as
  a permanent 400 in the app. The resolver is injectable.
- **Known limit: DNS rebinding.** The name is resolved and checked, then `fetch` resolves it again
  to connect; an attacker's DNS that answers a public address first and a private one second is not
  caught. Pinning the address needs a connection API Bun's `fetch` does not offer. The target list is
  the person's own, so this is not a route for a third party; it is written here so nobody assumes
  more.
- **Queue rules (per target).** One send at a time, 1 per second; events of one kind that wait
  together merge into one message (`N × <kind>`, the latest id, no summary); `5xx`, `429`, `408`
  and network errors retry after 2, 8 and 32 s (jitter ±25%, `Retry-After` if longer), 4 tries;
  any other `4xx` and any `3xx` stop the target (`failing`) until it is edited, enabled or tested
  well; 100 items at most, oldest dropped and counted. A replayed event id is sent once (the last
  500 are remembered).
- **The generic signature** is HMAC-SHA256 over `<timestamp>.<raw body>` with the signing secret,
  sent as `X-Flightdeck-Signature: sha256=<hex>` with `X-Flightdeck-Timestamp` (Unix seconds) and a
  unique `X-Flightdeck-Delivery`; both manuals tell receivers to compare in constant time and refuse
  a timestamp over five minutes old.
- **Mentions are neutralised.** Slack text is escaped (`&`, `<`, `>`) so a session title cannot
  ping `<!channel>` or build a link; Discord text gets a zero-width space after `@` and
  `allowed_mentions: {parse: []}`.
- **Edit keeps the address.** An empty address field on edit keeps the vault value; the form shows
  the address and the signing secret as password fields, and the list only the host name.
- **Axe and prints.** The Webhooks section and the summary panel are plain forms and lists built
  from the shared components; their axe pass belongs to `demo:shots` with the Settings print, not
  to unit tests.
