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
- **A base URL is exactly one of the two providers' or `http://` on loopback.** `Endpoint::with_base`
  exists for the tests' loopback server; the Tauri commands use only `Endpoint::anthropic()` and
  `Endpoint::openrouter()`, and no command takes a URL from the webview.
