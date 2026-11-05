# Flightdeck — AI assistant (issue #153): research for phase 40

The research behind `SPEC-fase-40.draft.md` (the spec to become `docs/SPEC-fase-40.md`). The spec holds what to build and how it is
tested; this file holds what the docs and the code say, the decisions with their reasons, and what was not verified.

- **Date:** 2026-11-05. **Repo read:** the repository, `main` at `715b7b76e` (clean), read-only.
  `docs/SPEC-fase-39.md` is not on `main`; it was read with `git show fase-39:docs/SPEC-fase-39.md` (nothing checked out).
- **Issues:** #153 and sub-issues #155 (Settings), #156 (backend), #158 (wand component), #160 (wand on every field),
  #162 (commit and PR messages). The issue bodies of the sub-issues say only "see the parent"; the design is in #153.
- **Not done:** no file of the repo was changed. No credential, token, key file, `~/.claude`, keychain entry or shell history
  was read. No provider was called with a key. The only network use was reading public docs and the public OpenRouter
  model list (`GET /api/v1/models`, sent without any key).
- Items I could not check are listed in section 1.9 and again in the spec's "Proof of concept first". Where the text below
  points to "the spec, Design", it means the section of that name in `SPEC-fase-40.draft.md`.

---

## 1.1 The short version

| Question | Decision | Main reason |
| --- | --- | --- |
| Where does a call run? | **Three providers, two places.** `host` (Claude Code on a host) runs in the **daemon**. `anthropic` and `openrouter` run in a new **Rust module of the Tauri shell**. | A key must live where the person is (the OS credential store of the machine in front of them) and must never go to a host (the daemon "never holds a token", phase 37 and 38). The host's Claude login only exists on that host. |
| How does a key avoid the webview? | The webview sends `provider` and the request; Rust reads the key from the keychain, calls HTTPS with `reqwest`, returns text and token counts only. No `get` command exists for these keys. CSP stays closed. | The CSP has no `https:` in `connect-src`; Anthropic itself says keys do not belong in browser code. |
| What runs the host provider? | A new `AgentRuntime.complete()` next to `judgePermission()`, same SDK `query()` with `settingSources: []`, `tools: []`, `maxTurns: 1`, `persistSession: false`, plus three switches the judge lacks (see 1.6). | The judge is the in-repo precedent. **`claude --bare` is not usable**: it never reads the subscription login. |
| Wand UX | A field wrapper with a corner (or toolbar) button and Ctrl/Cmd+I; a non-modal preview with Accept, Edit, Retry, Discard; a spinner with Cancel (Esc); one-level own Undo. The field value changes only on Accept or Undo. | "Never replaces the text silently" and testable without the browser's undo stack. |
| Per-field instructions | One shared module in `packages/protocol` (a closed `AssistantKind` table, a common preamble, per-kind rules, output normalizers and validators), used by the app and the daemon. | One place, covered by literal-string tests; both executors take the same neutral request. |
| Commit and PR messages | The daemon builds a bounded, redacted context (diff, stat, rules extracted from `CLAUDE.md`, recent subjects). Used by: merge/squash message, PR title and description, and a "suggest a message" copy button in the changes panel. `staged` is a supported source of the command. | Flightdeck has **no commit UI and never stages**; the commit-shaped text it does produce is the merge message and the PR title and body. |
| Costs | New usage origin `assistant`, new nullable column `provider`. The daemon records host calls itself; for API providers the app sends `assistant.record` (tokens, and OpenRouter's own `usage.cost`) to a host. Queued locally (no text) when no host is online. | The Costs page and budgets already read `usage_entries`; no second ledger. |
| Privacy | Wand surfaces are an allowlist (closed kind table); Vault, tokens, keys, connection targets, webhooks, MCP config, actions and commands are excluded and a test scans the source. Every call is first checked with `SecretScanner` (patterns) and, in Rust, against the vault's own values (ids returned, never values). | Matches how snippets and PR descriptions already refuse secrets. |
| Offline tests | A fake per layer: Rust gets a `SecretStore` trait with an in-memory store and a loopback fake HTTP server; the daemon gets `complete()` on the fake runtime and on an injected `query`; the app gets a fake `Platform.assistant`. Existing guards (claude sentinel, home, network, Tauri `invoke` sentinel) stay on. | Same pattern as phases 13, 38 and 39. |

## 1.2 What the code looks like today (findings)

Facts read in the repo, with where, because each one shaped a decision.

1. **Credential store.** `apps/desktop/src-tauri/src/lib.rs` uses the `keyring` crate (`Cargo.toml`: `keyring = "3"`, features
   `apple-native`, `windows-native`, `linux-native`; `Cargo.lock`: 3.6.3). Host tokens use service `dev.flightdeck.app`
   (account = host id) and vault values use `flightdeck-vault` (account = secret id). Both have `get` commands that **return
   the secret to the webview** (`token_get`, `vault_get`). The assistant keys must not copy that shape.
   Blocking keyring work goes through `spawn_blocking_result`; `scripts/test/tauri-release.test.ts` pins the number of direct
   `async_runtime::spawn_blocking(` uses in `lib.rs` to 3 and `panic = "abort"` is set in the release profile, so a panic in new
   code is a silent app exit.
2. **`linux-native` is the kernel keyutils store, which does not survive a reboot.** `docs.rs/keyring/3.6.3` (module
   `keyutils`, "Persistence"): "The key management facility provided by the kernel is completely in-memory and will not persist
   across reboots." Persistence needs `linux-native-sync-persistent` (keyutils plus Secret Service) or `sync-secret-service`.
   Issue #153 says "Secret Service" for Linux: the current build does not do that. Windows first, so this is a documented
   limit, not a blocker (open question 1).
3. **The CSP** (`tauri.conf.json`): `default-src 'self'; connect-src 'self' ws: wss: ipc: http://ipc.localhost; …`. No `https:`.
   A call from page JS to `api.anthropic.com` is already blocked. Keep it that way.
4. **App commands are open to the webview.** Tauri docs ("Capabilities"): "By default, all commands that you registered in your
   app (using the `tauri::Builder::invoke_handler` function) are allowed to be used by all the windows and webviews of the app."
   `build.rs` is plain `tauri_build::build()`, so a new command is callable by any script in the main window. A compromised
   webview can already read host tokens and vault values (`token_get`, `vault_get`); a new command adds **spend** but not
   disclosure, so Rust must cap what one webview can ask (input size, output tokens, rate).
5. **`reqwest` is already in the dependency tree** (0.13.5, through `tauri` and `tauri-plugin-updater`). The updater enables
   `reqwest` with `default-features = false`, features `json` and `stream`, and uses `rustls-no-provider` plus an explicit
   `rustls` with `ring`. reqwest's own `rustls` feature pulls **aws-lc-rs** (`Cargo.toml` of reqwest 0.13.5: `rustls =
   ["__rustls-aws-lc-rs", …]`, `rustls-no-provider = [...]`). A direct dependency must mirror the updater's choice or the build
   gets a second TLS provider.
6. **The one-shot precedent exists.** `ClaudeSdkRuntime.judgePermission()` (`apps/daemon/src/runtime/claude-sdk-runtime.ts`):
   `maxTurns: 1`, `settingSources: []`, `persistSession: false`, `tools: []`, structured output, its own folder
   (`autoApproveDir`, excluded from the history), tokens returned and recorded with origin `auto-approve`
   (`UsageIndexer.record`). The fake runtime has `judgePermission` with scripted answers. **Two gaps** I would not copy:
   it passes `env: { ...process.env, … }` (a stray `ANTHROPIC_API_KEY` in the daemon's environment would switch it from the
   plan to API billing, while sessions use `buildChildEnv(…, allowApiKey)`), and it does not turn off auto memory or the
   claude.ai connectors (1.6).
7. **The Costs data model.** `usage_entries` (`store/migrations.ts`): `message_id` PK, `claude_session_id`, `at`, `day`,
   `project_key`, `model`, `origin`, `speed`, input/output/cache columns, `cost_usd`. `UsageOrigin` is a zod enum in the protocol
   (`terminal | app | card | workflow | subagent | auto-approve`). `costOf()` prices by `DEFAULT_PRICING.models`
   (`claude-fable-5-1`, `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`, taken 2026-10-06; it matches the Anthropic
   models page read today). A model with no price has `cost_usd` NULL and is reported as unpriced. Budgets sum `cost_usd` of
   **every origin** (`costs/budgets.ts`: "The estimated cost of every origin counts"); a `queue` budget at 100% makes new cards
   wait (`Budgets.blocked`), it does not touch other work. `CostsPage.tsx` has a fixed `ORIGINS` filter list that lacks `auto-approve` today. I found no
   `.parse(` of command results in `lib/host-connection.ts`, so a new enum value should not break an older app (not checked
   exhaustively).
8. **Free-text surfaces** (`apps/desktop/src`): composer `ui/SessionView.tsx` (a one-row `Textarea` with icon buttons beside it,
   Enter sends, Ctrl+Enter breaks the line); new session prompt `ui/NewSessionForm.tsx`; tile composer
   `components/projects/session-tiles.tsx`; external session message `ui/ExternalView.tsx`; simple mode
   `components/simple/task-view.tsx`; card title and description `ui/CardDetail.tsx` and new-card dialog `ui/BoardView.tsx`;
   card "adjustment" `ui/CardDetail.tsx`; persona editor `components/personas/persona-editor.tsx` (`description` as an input,
   `body` as the instructions textarea); team goal `ui/TeamsPage.tsx`; snippet editor `components/snippets/snippet-editor.tsx`
   (`prompt` snippets are a `Textarea` with `{{variables}}`; `command` snippets are a one-line `Input`); PR description
   `components/watch/pr-description-dialog.tsx`; review comment boxes `ui/ChangesPanel.tsx` and `ui/ReviewList.tsx`.
   Fields that must never get a wand: `components/vault/new-secret-form.tsx`, host forms, `target-form.tsx` (ssh forwards),
   webhooks, `AgentMcp.tsx` (args, env, headers), `ClientsTransfer.tsx`, `ActionForm.tsx` (commands), `ProjectsPage.tsx`
   (setup commands), watch checks.
9. **Commit-shaped text today.** Sessions commit by themselves (Claude). The app writes a commit only in
   `Board.mergeLocal` (`board/board.ts:1637`): the message is `card.title` for squash and `Merge <branch>: <title>` for merge, not
   editable. The PR is created with `title: card.title` and a body from `watch.describe` (phase 22), edited in
   `PrDescriptionDialog`; a line that looks like a secret is already removed there (`SecretScanner` over each line). No screen
   stages anything, so "the staged diff" has no screen to live on yet.
10. **Existing diff and git helpers.** `board/diff.ts` (`parseUnifiedDiff`, `workingDiff`, `cardDiff(base...HEAD)`), `board/command.ts`
    (`runCommand`, `git`), `permissions/risk.ts` has a private `credential(path)` (`.ssh`, `.aws`, `.env*`, `*.pem`, `*.key`,
    `id_*`, …) that the diff filter should reuse (export it).
11. **Guards already in the test preload** (`scripts/test/preload.ts`): fake `claude` sentinel, temp `HOME`, `network-guard.ts`
    (wraps `fetch`, loopback only), `tauri-guard.ts` (a sentinel for `window.__TAURI_INTERNALS__.invoke`). The Rust CI step runs
    `cargo test` on both OSes (`.github/workflows/ci.yml`), so Rust tests are real tests, but the JS network guard does not see
    Rust's HTTP: the Rust tests need their own loopback-only rule.
12. **Quota.** `Quota.blocked()` (`quota/quota.ts`) returns the window and time when the host's plan is rejected or over the
    pause threshold. A host-provider call should respect it.
13. **Shortcuts.** `lib/shortcuts.ts` lists shortcuts for the cheat sheet; `App.tsx` handles Mod+K, Mod+T/W/Tab/1-9. Nothing uses
    Ctrl/Cmd+I. Whether WebView2 or WKWebView bind it natively is not verified.
14. **Daemon features** are announced in `host.info` from `server.ts` (`...(opts.watch ? ["watch"] : [])`), and the app hides what
    is missing with `hasFeature`. The new feature is `assistant`.
15. **Issue #153's last comment:** "Queued: research + a SPEC phase next to #145 (shares the provider/model picking with
    OpenCode)." `SPEC-fase-39` describes a searchable model list grouped by provider (`runtime.models` answers
    `{ models: Array<{ id; name }> }`) and an effort choice. Phase 39's picker is not implemented yet (only daemon pieces exist
    on `fase-39`), so the picker's contract is shared here (1.7, decision 7).

## 1.3 Anthropic Messages API (official docs, read 2026-11-05)

Sources: `platform.claude.com/docs/en/about-claude/models/overview`, `.../api/messages`, `.../api/versioning`, `.../api/errors`,
`.../manage-claude/authentication`, `.../build-with-claude/thinking`, `.../api/models/list`.

- **Endpoint and headers.** `POST https://api.anthropic.com/v1/messages`. Auth: `Authorization: Bearer <key>` (the page
  "Authentication": "Send it as `Authorization: Bearer <key>` on direct HTTP requests", and "The legacy `x-api-key` header is
  still supported"; the cURL examples on the thinking page still use `x-api-key`; PoC 1 confirms both work). `anthropic-version`
  is required; the current version
  is **`2026-10-21`** ("Versions" page). That version **removes `temperature`, `top_p` and `top_k`**: a request that sends any
  of them returns 400 on every model. So the request never sets them.
- **Body fields we use:** `model`, `max_tokens` (required), `system` (top-level string), `messages: [{ role: "user", content }]`,
  `thinking`, `output_config.effort` (`low | medium | high | xhigh | max`), `metadata.user_id` (not used).
- **Current model ids** (models overview table): `claude-fable-5-1` ($10/$50 per MTok), **`claude-opus-5-5`** ($4/$20),
  **`claude-sonnet-5-5`** ($2/$10), **`claude-haiku-5-5`** (from $0.10/$0.50; the repo's price table has a tier above 100k prompt
  tokens). Each is its own pinned snapshot ("dateless IDs"). All have a 1M context window and 128K max output. Retirement is
  "not sooner than" 2027-09-22 (Opus 5.5), 2027-09-28 (Sonnet 5.5), 2027-10-07 (Haiku 5.5). `claude-mythos-5-1` exists but is
  trusted-access only. The Messages reference lists `claude-sonnet-4-5` as deprecated with **end of life 2026-11-30**, which is
  three weeks away: a list that names it must be built from `GET /v1/models`, not hard-coded.
- **Thinking is on by default on the 5.x models and counts as output tokens** ("Thinking" page: "the tokens Claude spends
  reasoning are billed as output tokens … and they count toward `max_tokens`"). A text-polishing call should not pay for
  thinking. The matrix for "no thinking field / `adaptive` / `disabled` / `between_tools`" (thinking page):

  | Model | `thinking: {type: "disabled"}` | `thinking: {type: "between_tools"}` | What the wand sends |
  | --- | --- | --- | --- |
  | `claude-haiku-5-5` | accepted at effort `high` or below | 400 | `disabled`, `output_config.effort: "low"` |
  | `claude-sonnet-5-5` | **400** | accepted at effort `high` or below ("Without tools, the response contains only text") | `between_tools`, effort `low` |
  | `claude-opus-5-5` | **400** | 400 | no `thinking` field (adaptive), effort `low`, generous `max_tokens` |
  | `claude-fable-5-1` | 400 | 400 | same as Opus |

  The docs say to read this from the Models API instead of hard-coding: `GET /v1/models` returns
  `capabilities.thinking.types.disabled.supported` and `…between_tools.supported`, and `capabilities.effort.{low…max}.supported`.
  So the Rust side decides by capability when it has the list, with the table above as the fallback.
- **Response:** `content` blocks (join the `text` blocks), `stop_reason` (`end_turn`, `max_tokens`, `stop_sequence`,
  `refusal`, …), `usage` with `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`
  ("Total input tokens in a request is the summation of `input_tokens`, `cache_creation_input_tokens`, and
  `cache_read_input_tokens`"). `max_tokens` means a cut answer, `refusal` means a policy stop: neither is shown as a proposal.
- **Errors** (errors page): 400 `invalid_request_error` (also used "when usage reaches an organization or workspace spend limit
  you set"), 401 `authentication_error`, 403 `permission_error`, 413 `request_too_large`, 429 `rate_limit_error` (a tier
  spend-cap 429 "has no `retry-after` header and keeps failing"), 500 `api_error`, 529 `overloaded_error`. Body
  `{ "type": "error", "error": { "type", "message" }, "request_id" }` and a `request-id` header, which is safe to show and log.
- **A free "Test".** `GET /v1/models?limit=1` (List Models) validates the key without generating tokens. It also returns
  `id`, `display_name`, `line` (opus/sonnet/haiku, "use `line` to group models … in a model picker"), `lifecycle`
  (`active | deprecated | retired`), `max_input_tokens` and `capabilities`.
- **Not from a browser.** Authentication page, "Browser-based applications": "Call the Claude API from your own back end, not
  from code that runs in your users' browsers." Direct browser calls need `anthropic-dangerous-direct-browser-access: true`, and
  organizations with zero data retention or the Compliance API "cannot call the API directly from a browser, even with that
  header" (401 "CORS requests are not allowed for this Organization"; it applies only to requests that carry an `Origin` header).
  A `reqwest` call from Rust sends no `Origin`. This is a second, independent reason for the Rust call.
- **Token sizing:** the models page says 1M tokens is about 2.5M characters on the current tokenizer, so **about 2.5 characters
  per token**. A 48 KB diff is about 20k tokens.

Cost per call at today's list prices (my arithmetic from the table above, 700 in and 400 out for a field, 20k in and 150 out for a
commit): Haiku 5.5 about $0.0003 per field and $0.002 per commit message; Sonnet 5.5 about $0.005 and $0.04; Opus 5.5 about
$0.01 and $0.08.

## 1.4 OpenRouter (official docs, read 2026-11-05)

Sources: `openrouter.ai/docs/api-reference/overview`, `.../api/reference/errors-and-debugging`, `.../api-reference/limits`,
`.../api/api-reference/models/get-models`, `.../api/api-reference/api-keys/get-current-key`,
`.../guides/best-practices/reasoning-tokens`, `.../features/provider-routing`, `.../guides/privacy/{logging,data-collection}`.

- **Chat completions.** `POST https://openrouter.ai/api/v1/chat/completions`, `Authorization: Bearer <key>`,
  body `{ model, messages: [{role: "system"|"user", content}], max_tokens, stream, … }`. `choices` is always an array; with
  `stream: false` the text is `choices[0].message.content`. Optional attribution headers `HTTP-Referer` and
  `X-OpenRouter-Title`: **not sent** (decision: no app identity leaves the machine unasked).
- **Usage and cost are in every non-streaming answer:** `usage.prompt_tokens`, `completion_tokens`, `total_tokens`,
  `prompt_tokens_details.cached_tokens`, `completion_tokens_details.reasoning_tokens`, and **`usage.cost`** (credits, i.e.
  USD) with `is_byok`. This is why OpenRouter calls are recorded with the provider's own cost, not the repo's Anthropic table.
- **Model list.** `GET https://openrouter.ai/api/v1/models` (public; the same call works with the key). Per model: `id`
  (`vendor/model`), `name`, `context_length`, `pricing.prompt` and `pricing.completion` (**strings, USD per token**),
  `architecture.output_modalities`, `supported_parameters`, `endpoints` (the paths it serves), `expiration_date`, and
  `reasoning: { mandatory, default_enabled, default_effort, supported_efforts, supports_max_tokens }` when the model reasons.
  **Measured on the public list today (454 models):** 381 serve `/api/v1/chat/completions` with text output; **73 ids end in
  `:batch` and serve only `/api/v1/batches`**, so the picker must filter by `endpoints` and output modality, not by id; 133
  models have `reasoning.mandatory: true`; 12 end in `:free`. Claude ids are dotted:
  `anthropic/claude-haiku-5.5`, `anthropic/claude-sonnet-5.5`, `anthropic/claude-opus-5.5` (not the Anthropic ids).
- **Reasoning control** (reasoning-tokens page): `reasoning: { effort: "max|xhigh|high|medium|low|minimal|none" }` or
  `{ max_tokens }` or `{ enabled }`. Per the same page, a model with `reasoning.mandatory: true` rejects `effort: "none"`; a model
  with no `reasoning` object is a non-reasoning model. Reasoning counts against `max_tokens`; when the budget is spent
  reasoning, the answer is `finish_reason: "length"` with **empty `content`** and the reasoning is still billed. So: send
  `effort: "low"` for mandatory models, `effort: "none"` for the others that expose the object, nothing otherwise, and treat an
  empty answer with `length` as `assistant_truncated`.
- **Errors:** `{ error: { code, message, metadata } }`, HTTP status equals `error.code`: 400, 401 (bad key), 402 (credits; with
  `metadata.limit_source`: `openrouter_in_flight_budget` means wait for `Retry-After`, `openrouter_key_limit` and
  `openrouter_credits` mean add credit), 403 (permissions, guardrail, **budget**: `limit_source` `openrouter_*_budget` with
  `resets_at`), 408, 429 (may carry `Retry-After`), 502, 503 ("no available model provider that meets your routing
  requirements"). A failure after the answer started is HTTP 200 with the error in the body: always check `error` in the body.
- **Test.** `GET https://openrouter.ai/api/v1/key` returns limits and usage. **Its `label` field is a masked key**
  (`"sk-or-v1-au7...890"` in the docs' own example), so the Rust Test returns only `ok`, `limit_remaining` and
  `is_free_tier`, never `label`.
- **Privacy controls.** Per request `provider: { data_collection: "deny" | "allow" (default "allow"), zdr: boolean }`.
  "Data Collection": OpenRouter keeps prompts only if the account opts in to logging or training use, plus CSAM review;
  "Provider Logging": each provider has its own retention and training policy, and "zero retention" and "safety retention"
  tiers exist. The app sends `data_collection: "deny"` by default. That can shrink the choice and surface as 503.

## 1.5 Secrets in Tauri 2 (official docs and crate docs)

- **No first-party OS-keychain plugin.** The Tauri v2 plugin menu (`v2.tauri.app/plugin/…`) has Store, Stronghold, SQL, HTTP
  client and others, but nothing over Keychain, Credential Manager or Secret Service. **Store** is a JSON file (not a secret
  store). **Stronghold** ("Store secrets and keys using the IOTA Stronghold secret management engine") is an encrypted file
  vault that needs an app-supplied password hash function and is used from JavaScript (`@tauri-apps/plugin-stronghold`); it
  solves "encrypted file", not "key stays out of the webview", and needs Rust 1.90. **The HTTP client plugin** is called from
  JS with the headers the page sets, so the key would be in the page. None fits (the HTTP plugin's exact API was not read).
- **The Rust crate `keyring`** is what the app already uses. Windows Credential Manager (`windows-native`), macOS Keychain
  (`apple-native`), Linux: `linux-native` is keyutils (in memory, lost at reboot, see 1.2), `sync-secret-service` is the
  Secret Service (needs libdbus), and `linux-native-sync-persistent` uses both. `keyring` has no default features.
  Windows limit: the existing code already notes 2560 bytes per entry and UTF-16 (a 108-character API key is far below).
- **Design consequence.** Reuse `keyring` in a new module under its own service name (`flightdeck-assistant`, account = provider
  id) so the three kinds of secret never share a namespace, and give the module a trait so tests never touch a keychain.

## 1.6 Claude Agent SDK and `claude -p`: one cheap, tool-less prompt on the host's plan

Sources: `code.claude.com/docs/en/headless`, `.../cli-reference`, `.../agent-sdk/typescript`, `.../agent-sdk/claude-code-features`,
`.../agent-sdk/overview`; the installed `@anthropic-ai/claude-agent-sdk@0.3.312` (Claude Code 2.1.312) types.

- **`--bare` cannot be used.** Headless page: "In bare mode, Claude Code never reads OAuth credentials or the system keychain.
  … Set `ANTHROPIC_API_KEY` … bare mode doesn't use your subscription login." It is "the recommended mode for scripted
  and SDK calls" in general, and the wrong one for "the host's own subscription". Bare would also drop the problem of project
  hooks, but we get that another way.
- **Without bare, `claude -p` loads everything an interactive session does**: hooks and `.mcp.json` of the working directory, even
  in a folder never trusted. So a one-shot must not run in a project folder.
- **The SDK path (already a dependency) gives all the switches:** `settingSources: []`, `tools: []` ("restrict which built-in
  tools"; empty list disables all), `maxTurns: 1`, `persistSession: false`, `systemPrompt: "<string>"` (a custom string replaces
  the default; `undefined` is the minimal prompt), `effort` (`low` to `max`), `thinking: { type: "adaptive" | "enabled" |
  "disabled" }`, `maxBudgetUsd`, `abortController`, `pathToClaudeCodeExecutable`, `env`, `strictMcpConfig`. The CLI equivalents
  are `--tools ""`, `--max-turns 1`, `--no-session-persistence`, `--system-prompt`, `--setting-sources`, `--effort`,
  `--max-budget-usd`, `--strict-mcp-config`, `--model`, `--output-format json`.
- **`settingSources: []` is not the whole isolation** ("What settingSources does not control"): managed policy settings, the global
  `~/.claude.json`, **auto memory** (`~/.claude/projects/<project>/memory/`, loaded into the system prompt; disable with
  `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`), and **claude.ai MCP connectors** (loaded when the session authenticates with the
  claude.ai login, which is exactly our case; disable with `strictMcpConfig: true` or `ENABLE_CLAUDEAI_MCP_SERVERS=false`).
  Auto memory matters for privacy (a person's memory text could leak into an "improved" field); connectors matter for
  start-up time and attack surface. Endpoint-managed policy cannot be switched off from here (risk).
- **The installed SDK's `ThinkingConfig` is `adaptive | enabled | disabled`**: no `between_tools`. So on the host path
  **Sonnet 5.5 cannot have up-front thinking turned off** (it rejects `disabled`); the SDK can only set `effort: "low"`. The
  host path's cheap default is Haiku 5.5 with `disabled`.
- **The result message** carries `usage` (input, output, cache read, cache creation tokens) and `total_cost_usd`, which the docs
  call an estimate computed locally ("not what your plan bills"). The existing judge records tokens and lets `costOf()` price
  them; the assistant does the same.
- **Latency and weight.** Each `query()` starts a Claude Code process (the SDK docs say a spare process holds about 230 to 260 MB
  while waiting). `startup()` and the alpha `prewarm()` exist to move the spawn out of the critical path. **Not measured here**
  (PoC 3). Decision: no pre-warm in version 1; one call at a time per host.
- **Policy.** Agent SDK overview: "Unless previously approved, Anthropic does not allow third party developers to offer
  claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK." Flightdeck offers no
  login: it runs the `claude` the person installed and signed in on their own host, exactly as its managed sessions already
  do, and never reads or forwards the OAuth token. This is a standing risk, not a new one; the provider seam (host is one of
  three) is the mitigation.

## 1.7 Decisions, with the reasons

**1. Where the call runs.**

| Option | For | Against | Verdict |
| --- | --- | --- | --- |
| Page JS (`fetch`) | trivial | key in the webview, CSP opened, Anthropic CORS rules, ZDR orgs rejected | no |
| Daemon for every provider | one executor, repo access for diffs, costs in place | a key would travel to a host (maybe a shared Pi) or live in its config; the daemon "never holds a token"; host offline means no assistant | only for the host provider |
| Rust shell for API providers | key in the local OS store; works with every host offline; one key for all hosts | costs are not on a host (needs `assistant.record`); not in the web build | **yes** |
| Tauri HTTP plugin from JS | official | key supplied by JS | no |

The prompt is built by shared pure code (`packages/protocol/src/assistant.ts`), so the two executors take the same neutral
request and cannot drift. The only thing that needs a host for an API-provider call is the repo context of a commit or PR
message (`assistant.context`).

**2. Key handling.** Entry is the one moment a key is in the webview (a password input, value held in a ref and cleared right
after `assistant_key_set`; nothing is stored, logged or put in app state). After that the webview can only ask for
`{ saved, last4 }`, derived in Rust. The issue says keys "never touch the webview": entry cannot avoid it (the dialog plugin
has no password prompt); a native entry window was considered and rejected (still a webview; open question 7). The OS entry
is `flightdeck-assistant` / `anthropic` or `openrouter`.

**3. No silent provider fallback.** If the chosen provider fails, the preview shows the reason and a button to try another
configured provider. Text never moves to a different company or a different host without the person's click.

**4. Wand UX (preview, accept, undo, cancel, Ctrl+I).** Defined in the spec, Design, "The wand". Reasoning in short:
Accept replaces; **Edit** makes the proposal editable inside the preview before Accept (so an edit never fights the field's
own undo); **Retry** asks again; **Discard** leaves the field untouched. After Accept, a one-level own Undo (chip for 15 s
and Ctrl/Cmd+Z while the field still equals the accepted text) restores the original. `document.execCommand("insertText")`
would keep the native undo stack but is deprecated, behaves differently in WKWebView and cannot be tested in happy-dom.
Ctrl/Cmd+I is handled on the focused field only (no global handler, so no clash with Mod+K or the tab keys) and is listed
in the cheat sheet. Esc cancels a running call and discards a preview.

**5. Per-field instructions.** A closed `AssistantKind` table (11 kinds), a common preamble, per-kind rules, per-kind model
profile (`quick` or `careful`), token cap, output rule and a validator. Details in the spec, Design, "Prompts".

**6. Commit and PR messages.** Source of the diff is the host (daemon): `card` (`<base>...HEAD`), `worktree` (`HEAD` against
the tree) or `staged` (`git diff --cached`). The repo's own rules are the blocks of `CLAUDE.md` (and `AGENTS.md`) that mention
commits, plus the last 15 subjects (`git log -15 --format=%s`); whole files are not sent. Conventional Commits 1.0.0 is the
default only when the repo's rules or its log do not say otherwise. Output is plain text, not JSON, so the same prompt works
on three providers: first line is the subject. Staged is supported by the command and tested; the app uses `card` and
`worktree` until a screen stages files.

**7. Shared model picking with phase 39.** One `ModelOption { id; name; group?; priceIn?; priceOut?; note? }` type and one
`ModelPicker` component (searchable, grouped, optional "default" row, optional effort selector). Sources of options:
OpenCode `runtime.models` (phase 39, grouped by `provider/`), OpenRouter (grouped by vendor), Anthropic (grouped by `line`), host
Claude (four current ids plus "the host's default"). Whichever phase lands first creates it; the other imports it (area
`model-picker`).

**8. Costs.** `UsageOrigin` gains `assistant`; `usage_entries` gains a nullable `provider` column (`host`, `anthropic`,
`openrouter`; recorded now because it cannot be back-filled; shown later). Host calls: the daemon records tokens and prices
them with `costOf()` (an estimate in API prices, like every host row). API calls: the app sends `assistant.record` with tokens,
the model, and for OpenRouter its own `usage.cost`, which overrides the price table (OpenRouter ids are not in it). Idempotent
by `id` (a retry never double counts). With no host online, records wait in app storage (at most 100, no text) and flush on
reconnect. Project key: the card's or session's folder when known, else the assistant's own scratch folder, which the Costs
page shows as `assistant`. Budgets include the spend (every origin counts); the `queue` action does not stop the wand.

**9. Privacy.** Allowlist of surfaces; excluded list tested by a source scan; secret patterns plus vault values checked before
any call; diffs redacted line by line and filtered by path; OpenRouter `data_collection: deny` by default; a visible line under
each provider says where text goes; the host provider names the host; first use on a host asks once. No text or diff is ever
logged or stored (only kind, provider, model, tokens, time).

**10. Tests offline.** Fakes in the spec, Design, "Test guard and fakes".

## 1.8 Where the issue text and the code disagree

1. "Secret Service" on Linux: the build uses keyutils, which is lost at reboot (1.2 item 2).
2. "Keys never touch the webview": the paste does (decision 2); afterwards they do not.
3. "Commit message from the staged diff": nothing stages. `staged` is a source of the command; the screens use the merge
   message, the PR, and a "worktree" suggestion.
4. "Use the host's Claude Code, no key": true, but `--bare`, the usual scripted mode, would break it; and the judge's own
   one-shot would bill an API key if the daemon's environment has one.
5. "Pick one per app, and optionally per field kind": done through two profiles (`quick`, `careful`) and a per-kind override table.
6. OpenRouter has no "default model": the picker needs a list. Defaults are suggestions the person confirms.
7. `docs/SPEC-fase-39.md` is not on `main` (it is on `fase-39`).

## 1.9 What is not verified (all in the spec's proof of concept)

- Real answers of both APIs with the exact request shapes (I read docs and the public model list; I used no key).
- Latency and memory of a host one-shot, on the Pi and on Windows.
- That `persistSession: false` plus `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` plus `strictMcpConfig` leave no file and no memory read.
- That the pinned SDK accepts `effort` and `thinking` in the combinations of 1.3 for the host path.
- WebView2 and WKWebView handling of Ctrl/Cmd+I; Windows Credential Manager round trip.
- Binary size and build time of the direct `reqwest` dependency; that `cargo tree -d` shows one TLS provider.
- The default shown by OpenRouter when `data_collection: deny` leaves no provider for a model (503).
- Whether a managed-policy host adds hooks to the one-shot.
