# The assistant's Rust slice: choices the spec left open (phase 40)

Phase 40's new decisions and divergences go in this folder from now on; `docs/DECISIONS.md` keeps
ADR 40-3 and the earlier phase 40 entries, frozen. These cover the crate `flightdeck-assistant`
(`apps/desktop/src-tauri/assistant/`).

- **A key has at least 20 characters.** `check_key` refuses a shorter one as `assistant_key_invalid`
  (`why: "length"`), next to the spec's other checks (empty, a control character, whitespace,
  over 512 characters). Neither provider issues a key that short, so a short value is a paste of
  the wrong thing; refusing it before the store keeps a typo out of the keyring.
- **A store failure is `assistant_key_store`.** The keyring failing (locked, absent, refused) is
  one reason with no params, so no OS error text reaches the webview. fd-developer adds it to
  `ASSISTANT_REASONS` on the UI branch.
- **An HTTP status the spec does not map is `assistant_bad_output`.** Anthropic's 400 (without
  "spend limit"), 405, 409, 422 and anything else unlisted answer `assistant_bad_output` with the
  provider's request id and its scrubbed message as `detail`. The alternative, `assistant_offline`,
  would tell the person to check the network when the request itself was refused.
- **tokio is a normal dependency** of the crate (`rt`, `time`, `sync`, the version already in the
  lock, no macros). A cancel or a timeout aborts the call's task (`tokio::spawn`, `AbortHandle`,
  `tokio::time::timeout`), so a late answer is never delivered; Tauri already runs on tokio, so
  nothing new is linked.
- **The guard's numbers are constants with a test**: 100 000 input characters, 4096 output
  tokens, model ids of at most 100 characters in `[A-Za-z0-9._:/-]`, 2 calls in flight, 20 calls
  per 5 minutes, a 10 s connect and 60 s total timeout, no redirect, no retry, no `Origin`. A vault
  value shorter than 6 characters is not looked for in the text: it would match ordinary words.
- **A base URL is exactly one of the two providers' or, in a debug build only, `http://` on
  `127.0.0.1` or `[::1]`.** `Endpoint::with_base` exists for the tests' loopback server; a release
  build refuses loopback, so no key goes to a local listener, and `localhost` is refused everywhere
  (DNS or the hosts file could point it elsewhere). The Tauri commands use only
  `Endpoint::anthropic()` and `Endpoint::openrouter()`, and no command takes a URL from the webview.
  A request path must start with `/`, so a path can never turn the base into a userinfo.
- **Anthropic 502 and 503 are `assistant_overloaded`**, like 500 and 529: the provider is there and
  cannot answer now, and the person's next step is the same (try again later).
- **What a provider says reaches the app scrubbed and short.** The key, and any word starting with
  `sk-` in any case (the shape of both providers' keys, so a prefix, a masked or a case-changed
  echo too), becomes `<key>`; a `detail` is at most 300 characters; a request id or `retry-after`
  is passed on only as 1 to 200 characters of `[A-Za-z0-9._:-]`. The provider's request id is the
  refusal's `requestId` param, which the UI shows with the `assistant_request_id` string (`{id}`).
  A 413 carries `max`, as the `assistant_too_long` strings expect.
- **One request id is one call.** A call whose id is already running is `assistant_rate_limited`
  (so a second call cannot take over the first's cancel). A cancel that arrives before its call
  starts is kept (the last 16 ids) and that call answers `assistant_cancelled` without running. A
  wait that is dropped aborts its call and frees the id. So a request id is unique per call (a
  UUID, never reused, not even after a webview reload). The client never retries (also
  `reqwest::retry::never()`, so an HTTP/2 build could not resend a POST).
- **A model id never becomes a path**: besides the character set, an id starting with `/` or with
  a `..` segment is `assistant_model_unavailable`; a call checks the model and both prompts before
  any request.
- **New reasons for the UI branch**: `assistant_key_invalid` (param `why`) and
  `assistant_key_store` (no params) join `ASSISTANT_REASONS` and both i18n files; whichever of the
  Rust and UI branches lands second adds a test that every Rust reason is in the list.
- **Accepted risk: a key in memory is not zeroed** when its `Secret` is dropped. A process that
  can read the app's memory can also read the keyring as the same user, so `zeroize` would add a
  dependency without closing a path.
- **OpenRouter, where the spec is silent.** `finish_reason: "length"` is `assistant_truncated` even
  with some text, as Anthropic's `max_tokens` is: a cut-off commit message is not an answer.
  `content_filter` is `assistant_refused`. A 403 without `limit_source` (a permission or a
  guardrail) is `assistant_auth` with its detail; 500 is `assistant_overloaded`, like 502; 413 is
  `assistant_too_long` with `max`. `retryAfter` is passed for a 429 and for
  `openrouter_in_flight_budget`, whatever the status. A mandatory-reasoning model that does not
  take `low` gets the lowest effort it lists. A price that does not parse, or is negative (a
  router's variable price), shows no price; a price is rounded to the millionth of a dollar per
  million tokens. No request id is passed: OpenRouter's answers carry none the person can quote.
- **The commands' contract** (agreed with the UI branch, 2026-11-06). `assistant_run` takes
  `{ provider, request, vaultIds, denyDataCollection }`: `AssistantRequest` names neither the
  provider nor the OpenRouter switch, so `Platform.assistant.run` becomes
  `run(request, vaultIds, { provider, denyDataCollection })` instead of the spec's
  `run(request, vaultIds)`. Every assistant command, and `vault_hits`, rejects with the refusal
  object `{ reason, params }`, never a string. A request id must be a short token (a UUID fits).
  A vault check reads at most 200 ids; a store failure while reading them is `assistant_key_store`.
  The key test and a model list count against the same in-flight limit and bucket as a call; a
  list is kept 10 minutes, and a model it does not have is sent with neither thinking nor
  reasoning. A prompt (the system or the user part) may be twice the text's cap, since the user
  part wraps the text with its context; the refusal still names the text's cap of 100 000.
  `REASONS` in the crate's `lib.rs` lists every reason the crate refuses with, and the UI branch
  checks each against `ASSISTANT_REASONS`.
- **What the commands' guards are for (review of 2026-11-06).** The vault check takes its ids from
  the webview, so it guards against a person's accident (a secret pasted into the text), not a
  compromised webview, which can already read a vault value through `vault_get`. The same holds
  for `denyDataCollection` (on by default in the app) and for `vault_hits`, which answers only
  whether a text holds a value. A request id, in `assistant_run` and `assistant_cancel` alike,
  must be 1 to 64 characters of `[A-Za-z0-9._:-]`. More than 200 vault ids is
  `assistant_bad_output`. The limits are taken after the key and the vault check, so a refusal
  that sends nothing spends no call of the bucket. A saved or deleted key drops that provider's
  model list. Tauri itself refuses a malformed argument with a plain string before a command
  runs, so the platform layer maps any rejection that is not an object to
  `assistant_bad_output`. In a release build (`panic = "abort"`) a panic in a call ends the app;
  `assistant_bad_output` for a panicking task holds only in tests and debug builds, so the code
  of a call keeps to the no-`unwrap` rule, and `tauri-release` now scans every Rust file of the
  app and of the crate.
