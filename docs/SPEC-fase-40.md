# Flightdeck — Phase 40 spec (AI assistant: provider keys, the magic wand, commit and PR messages)

## Goal

GitHub issue #153 with sub-issues #155 (Settings), #156 (backend), #158 (the wand), #160 (every field) and #162 (commit and PR
messages). A person adds an AI provider in Settings and gets a small wand on every free-text field that improves the text, or
writes it when it can (a commit or PR message from the diff). Providers, in this order: the **host's own Claude Code** (the
default, no key, runs on that host's plan), **Anthropic** (API key) and **OpenRouter** (API key, model picker). The research (the docs read, the code findings, the reasons behind the decisions and what is
not verified) is in [`research-fase-40.md`](research-fase-40.md).

Prerequisites: phase 1 (the runtime interface), phase 7 and 8 (the usage ledger and Costs), phase 13 (the one-shot
`judgePermission`), phase 16 (vault), phase 18 (snippets), phase 20 (personas), phase 21 (teams), phase 22 (the PR description),
phase 39 (model picking; shared, see below).

Sources (read on 2026-11-05):

- [Anthropic models overview](https://platform.claude.com/docs/en/about-claude/models/overview): current ids
  `claude-fable-5-1`, `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`; prices; 1M context; retirement dates.
- [Messages API](https://platform.claude.com/docs/en/api/messages), [versions](https://platform.claude.com/docs/en/api/versioning)
  (`anthropic-version: 2026-10-21`; `temperature`, `top_p`, `top_k` removed),
  [errors](https://platform.claude.com/docs/en/api/errors), [authentication](https://platform.claude.com/docs/en/manage-claude/authentication)
  (keys not in browsers; CORS and ZDR), [thinking](https://platform.claude.com/docs/en/build-with-claude/thinking) (per-model
  matrix), [List Models](https://platform.claude.com/docs/en/api/models/list) (capabilities, `line`, `lifecycle`).
- [OpenRouter API overview](https://openrouter.ai/docs/api-reference/overview) (chat completions, `usage.cost`),
  [errors](https://openrouter.ai/docs/api/reference/errors-and-debugging), [limits and `GET /key`](https://openrouter.ai/docs/api-reference/limits),
  [list models](https://openrouter.ai/docs/api/api-reference/models/get-models), [reasoning tokens](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens),
  [provider routing](https://openrouter.ai/docs/features/provider-routing) (`data_collection`, `zdr`),
  [data collection](https://openrouter.ai/docs/guides/privacy/data-collection).
- Tauri: [capabilities](https://v2.tauri.app/security/capabilities/) (app commands open to all webviews), [CSP](https://v2.tauri.app/security/csp/),
  [Stronghold](https://v2.tauri.app/plugin/stronghold/); [`keyring` 3.6.3](https://docs.rs/keyring/3.6.3/keyring/) and its
  [`keyutils` module](https://docs.rs/keyring/3.6.3/keyring/keyutils/index.html) (not persistent across reboots).
- Claude Code: [headless](https://code.claude.com/docs/en/headless) (`--bare` never reads the login),
  [CLI reference](https://code.claude.com/docs/en/cli-reference), [Agent SDK TypeScript](https://code.claude.com/docs/en/agent-sdk/typescript),
  [what `settingSources` does not control](https://code.claude.com/docs/en/agent-sdk/claude-code-features),
  [SDK overview](https://code.claude.com/docs/en/agent-sdk/overview) (the third-party login policy).
- [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/).

What the docs do not say and the proof of concept settles: real answers for the request shapes below, latency of the host
one-shot, the exact effect of `CLAUDE_CODE_DISABLE_AUTO_MEMORY` and `strictMcpConfig` on the pinned SDK, and Ctrl/Cmd+I in the two
webviews.

## Non-goals

Left out on purpose, so nobody builds it by accident. Each one is a candidate for a later phase.

- Streaming the answer into the preview (version 1 shows a spinner with Cancel); a free-text extra instruction ("make it
  shorter"); a pre-warmed host process (`prewarm()`).
- A wand for review comments, gate notes, workflow steps, agent files and memory; a "generate from context" for the team goal.
  The excluded surfaces listed in Design stay excluded.
- A screen that stages and commits (then the `staged` source gets a button); a commit-message hook for sessions. This phase
  commits nothing: it suggests text.
- More providers (OpenAI-compatible endpoints, local models) behind the same `AssistantProvider` seam; a per-provider view in
  Costs (the `provider` column is recorded now, shown later); budgets for the assistant alone.
- A native key-entry window; persistent Linux keys (`linux-native-sync-persistent`). The Linux limit is documented instead.
- Any change to phase 13's `judgePermission` (open question 9), to the host tokens' or the vault's storage, or to the CSP.
- A key, text or diff leaving the machine in any way but the one call to the chosen provider.

## Decisions (record any divergence in `docs/decisions/<yyyy-mm-dd>-<topic>.md`)

- **Three providers, two places.** `host` runs in the daemon; `anthropic` and `openrouter` run in the Rust shell. A key lives
  only in the OS credential store of the machine the person sits at. It never goes to a daemon, a file, a log, an error string
  or the webview, except in the one `assistant_key_set` call that stores it. ADR 40-1.
- **Both executors take the same neutral request.** The prompt is built by shared pure code in `packages/protocol`; the daemon
  and the app import it. The executors only run `{ system, user, model, maxTokens, effort }`.
- **No silent fallback.** A failing provider is reported with its reason; trying another provider is a click.
- **The webview never calls a provider.** The CSP is unchanged (no `https:` in `connect-src`); a test pins it.
- **The wand never replaces text by itself.** The field changes only on Accept, Edit-then-Accept or Undo.
- **Allowlist, not blocklist.** A wand exists only for a kind in the closed `AssistantKind` table. Vault, tokens, keys, targets,
  webhooks, MCP config, actions and commands have no kind.
- **Plain text out.** No structured output: the same prompt works on three providers; the first line is the title or subject.
- **Cheap by default.** `quick` profile (Haiku 5.5 on the host and on Anthropic) for fields, `careful` (Sonnet 5.5) for commit
  and PR messages and persona instructions; thinking off or minimal; hard token caps; one call at a time per app.
- **Costs are recorded** under origin `assistant`, with the provider, by the daemon for host calls and through
  `assistant.record` for API calls. No text is ever stored. ADR 40-2.
- **One picker with phase 39.** `ModelOption` and `ModelPicker` are shared; the second phase to land imports them.
- **Version 1 does not stream.** Outputs are short (at most 4096 tokens, usually under 500); a spinner with Cancel is enough.

## Proof of concept first

Needs real keys, a real host `claude` and real webviews: manual checks by the maintainer, recorded in `docs/decisions/`, not tests. The
areas below run on fakes and do not wait for this. The scrubbed answers recorded here become the hand-copied fixtures of
`assistant-anthropic` and `assistant-openrouter`.

1. **Anthropic.** `POST /v1/messages` with `Authorization: Bearer` (and, once, `x-api-key`, to confirm both are accepted) and
   `anthropic-version: 2026-10-21` for Haiku 5.5, Sonnet 5.5 and Opus 5.5
   with the `thinking` and `output_config.effort` combinations of the matrix; record which return 400 and the exact message.
   Record `usage` and `stop_reason` of a normal answer, of `max_tokens: 20` (cut) and of a refused prompt if one can be
   made. `GET /v1/models?limit=1` as Test, and the `capabilities` block of the three models. A bad key: the 401 body.
2. **OpenRouter.** `GET /api/v1/key` (confirm `label` is a masked key); `POST /api/v1/chat/completions` on three models (a Claude
   model, one with `reasoning.mandatory: true`, one without `reasoning`) with the `reasoning` rule below; confirm `usage.cost`;
   `provider: { data_collection: "deny" }` and what it does to a model with no compliant provider (503?); one `:batch` id
   (confirm it is refused on chat).
3. **Host one-shot.** `ClaudeSdkRuntime.complete` on the Pi and on a Windows host: latency p50 and p95 for Haiku and for
   Sonnet; confirm no transcript is written (`persistSession: false`), that nothing is read from or written to
   `~/.claude/projects/*/memory` with `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, that no claude.ai connector starts with
   `strictMcpConfig`, that with `ANTHROPIC_API_KEY` in the daemon's environment the call still uses the plan, that the pinned
   SDK accepts `effort: "low"` and `thinking: { type: "disabled" }` for Haiku and rejects it for Sonnet, and the shape of
   `result.usage`. Note what a host with managed settings does.
4. **Native.** Windows Credential Manager round trip with a 108-character key and a 200-character one; Ctrl+I in WebView2
   (does it do anything natively?), Cmd+I in WKWebView; the keyutils entry on Linux is gone after a reboot (documents limit).
5. **Build.** `cargo tree -d` with the direct `reqwest` (features below): one TLS provider; size of the release binary before and
   after; `cargo test` time.
6. **Downgrade.** The previous released app against a daemon with this phase's migration, and the previous daemon on a database
   this phase migrated: both open, Costs shows the `assistant` rows in the totals, nothing throws (Protocol, migration and
   rollback).

## Design

The providers, the Rust shell, the daemon, the prompts, commit and PR messages, the wand, Settings,
where the wand is, costs, privacy, the test guard and the docs: [the design](SPEC-fase-40-design.md#design).

## Protocol, migration and rollback

Commands, payloads and refusals, what is stored, the migration, downgrade and rollback:
[the design file](SPEC-fase-40-design.md#protocol-migration-and-rollback).

## Acceptance scenarios

The journeys a person reads: the wand (preview, accept, undo) and the first run (choosing a provider). The fake provider answers
each scenario; no scenario needs the network. Both features exist in `en` and `pt-BR`, as the other features do.

```gherkin
Feature: The magic wand proposes and the person decides

  Scenario: Preview, accept and undo
    Given the assistant provider is "Claude Code on a host" and it answers with an improved text
    And the new card dialog has the description "fix the login bug"
    When I click "Improve with AI" on the description
    Then I see a preview with the original text and the proposed text
    And the description still says "fix the login bug"
    When I click "Accept"
    Then the description holds the proposed text
    When I click "Undo"
    Then the description says "fix the login bug" again

  Scenario: Discard leaves the field alone
    Given the assistant provider is "Claude Code on a host" and it answers with an improved text
    And the new card dialog has the description "fix the login bug"
    When I click "Improve with AI" on the description
    And I click "Discard"
    Then the description says "fix the login bug"
    And I see no preview

  Scenario: Cancel a slow answer
    Given the assistant provider is "Claude Code on a host" and it takes a long time to answer
    And the new card dialog has the description "fix the login bug"
    When I click "Improve with AI" on the description
    And I click "Cancel"
    Then the description says "fix the login bug"
    And the answer, when it arrives, is not shown

  Scenario: A secret in the text is refused
    Given the assistant provider is "Claude Code on a host"
    And the new card dialog has a description that contains an API key
    When I click "Improve with AI" on the description
    Then I see that a secret was found, by its kind and not its value
    And nothing was sent to the provider

  Scenario: A commit message for the merge
    Given the assistant provider is "Claude Code on a host" and it answers with a commit message
    And a card with changes is ready to merge
    When I open "Merge and archive" and click "Write with AI" on the message
    Then I see a preview of a message with a subject of at most 72 characters
    When I click "Accept"
    Then the merge message holds the proposed message
```

Runs as `scripts/e2e/bdd/features/assistant-wand.feature`.

```gherkin
Feature: The first run asks where the text goes

  Scenario: No provider opens the Assistant settings
    Given no assistant provider is configured
    When I click the wand on a field
    Then the Assistant section of Settings opens
    And I see one line saying that a provider is needed

  Scenario: Choose Claude Code on a host
    Given no assistant provider is configured and the host "Pi" has a signed-in Claude Code
    When I open Settings, Assistant, and choose "Claude Code on a host"
    Then I see that my text goes to Anthropic through the Claude Code signed in on "Pi"
    And I am asked once to confirm that host
    When I confirm
    Then the wand improves a field using that host

  Scenario: Add an Anthropic key
    Given no assistant provider is configured
    When I choose "Anthropic" and paste a key
    Then I see "Key saved" with only the last four characters
    And the key field is empty
    When I click "Test"
    Then I see that the key works
    And the key is not shown anywhere on the screen
```

Runs as `scripts/e2e/bdd/features/assistant-first-run.feature`, **with the first two scenarios only**: the e2e runs against the web
build, where `Platform.assistant.supported` is false (no keychain, no Rust), so "Add an Anthropic key" cannot run there. It is
covered by `assistant-settings-ui` (the fake platform) and by the by-hand check on Windows; keep it out of the `.feature` (or
tag it so the runner skips it). The steps go in `scripts/e2e/bdd/steps.ts`, and the demo daemon's fake runtime must answer
`complete` for the wand scenarios.

## Tests and criteria

All tests use fakes: no network (Rust tests: loopback only), no OS credential store, no real `claude`, a temporary home. Rust
areas are tests inside the module (`#[cfg(test)]`, as `open_result_tests`) or an integration test under `src-tauri/tests/`, run
by `cargo test`; Rust file names use `_` where the area has `-`. TS areas follow `docs/TDD.md`.

| Area | Test file | What must pass |
| --- | --- | --- |
| `assistant-protocol` | `packages/protocol/test/assistant-protocol.test.ts` | the payloads and results are in the protocol; `UsageOrigin` has `assistant`; `card.mergeLocal` and `card.pr.create` accept `message` and `title` and keep their defaults; `host.info` announces `assistant`; every refusal carries its reason; texts in both languages |
| `assistant-prompts` | `packages/protocol/test/assistant-prompts.test.ts` | one literal expected `system` and `user` string per kind; the table is complete and closed; language rule; `</text>` inside the text is neutralized; size and empty checks; the normalizer (fence, preamble, quotes, single line); the placeholder validator; the commit validator (each failure); default model ids exist in `DEFAULT_PRICING.models` |
| `assistant-claude-complete` | `apps/daemon/test/assistant/claude-complete.test.ts` | `ClaudeSdkRuntime.complete` passes `maxTurns: 1`, `settingSources: []`, `persistSession: false`, `tools: []`, a string system prompt, `strictMcpConfig`, `maxBudgetUsd`, the abort signal and the executable path; its env has no `ANTHROPIC_API_KEY` unless allowed and has `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`; result text and tokens; each non-success subtype maps to its reason; the fake runtime answers deterministically |
| `assistant-service` | `apps/daemon/test/assistant/service.test.ts` | order of the checks (empty, size, secret, quota) and that nothing starts when one fails; one run at a time per host; cancel by `requestId`; the 90 s ceiling; usage recorded with origin `assistant`, the provider and the project; validators applied; logs hold no text |
| `assistant-context` | `apps/daemon/test/assistant/context.test.ts` | on real temporary repositories: the three sources; `assistant_no_changes`, `assistant_not_a_repo`; binary, lockfile, generated and credential paths are listed but not shown; a secret line is replaced and counted; the 48 KB and 6 KB budgets and the not-shown note; rules extracted from the repo's own `CLAUDE.md` (fixture) give the commit blocks and nothing else; `AGENTS.md`, `commitlint.config.*`, `.gitmessage`; `git log` subjects and the conventional flag; no author data; `isCredentialPath` is the one of `risk.ts` |
| `assistant-usage` | `apps/daemon/test/assistant/usage.test.ts` | `record` is idempotent by `messageId`; `provider` column migration (nullable, old rows `NULL`, a read with the old column list still works); `costUsd` overrides the table and a model with no price and no cost stays unpriced; Costs summary lists the `assistant` origin; budgets count it; the project key falls back to the scratch folder |
| `assistant-card-messages` | `apps/daemon/test/assistant/card-messages.test.ts` | `card.mergeLocal` uses `message` when given and the old text when not; `card.pr.create` uses `title`; limits (empty, too long, NUL, newline in a title) refused with reasons |
| `assistant-keys` | `apps/desktop/src-tauri/assistant/src/keys.rs` | set, status, delete through `MemoryStore`; `last4`; provider allowlist; control characters, whitespace and length refused; the Windows size rule; the service name is `flightdeck-assistant`; `Debug` of the secret is redacted; no command output, error string or captured log line contains a recognisable fake key on any path |
| `assistant-anthropic` | `apps/desktop/src-tauri/assistant/src/anthropic.rs` | exact request path, headers (`Authorization: Bearer`, `anthropic-version: 2026-10-21`) and JSON body per model, no `temperature`, `top_p` or `top_k`; thinking chosen by capability and by the fallback table; response text join; `usage` mapping; `max_tokens` and `refusal` stop reasons; each error status and body maps to its reason; `request-id` kept; the models list (pagination, active only, `line`, capabilities); Test uses the free list call |
| `assistant-openrouter` | `apps/desktop/src-tauri/assistant/src/openrouter.rs` | exact request and body; `data_collection` on and off; `reasoning` rule for no object, mandatory and optional models; `usage.cost` read; an error in a 200 body; `length` with empty content; 402, 403 with `limit_source`, 429 with `Retry-After`, 502, 503; the list filter (`:batch` out, chat and text only), grouping and prices per million; Test never returns `label` |
| `assistant-guard` | `apps/desktop/src-tauri/assistant/tests/guard.rs` | input, `max_tokens`, model-id, in-flight and bucket caps, checked on the commands through `flightdeck_desktop_lib` against a loopback server; `vault_hits` returns ids only and ignores values under 6 characters; the base URL allowlist; no `Origin`; no redirect; no retry; timeout; cancel aborts and a late answer is dropped |
| `assistant-csp` | `scripts/test/assistant/csp.test.ts` | the CSP string is pinned (no `https:`); no source file of the app names the provider hosts in a `fetch` or an `XMLHttpRequest`; `Platform.assistant` has no key getter; `Cargo.toml` has `reqwest` with the three features and no `native-tls` or `aws-lc-rs`; the registered command list is exactly the expected one; the `spawn_blocking` pin scans all of `src/*.rs` |
| `assistant-platform` | `apps/desktop/test/assistant-platform.test.ts` | the Tauri implementation sends the exact command names and arguments and returns only what Rust returned; the web one is `supported: false`; the fake logs calls |
| `assistant-prefs` | `apps/desktop/test/assistant-prefs.test.ts` | storage shape and defaults; provider resolution (preference, host when the feature is present, none, web build); per-kind profiles; models per profile; a missing key reads as the default |
| `model-picker` | `apps/desktop/test/model-picker.test.tsx` | searchable, grouped, a "default" row, the effort selector when offered, loading and error states, keyboard use; both languages; axe. Shared with phase 39: skip when it already landed |
| `assistant-settings-ui` | `apps/desktop/test/assistant-settings-ui.test.tsx` | the section is on the rail and found by its words; provider choice and privacy lines; host picker and the first-use confirm; paste key, saved with `last4` only, input cleared, Replace, Test (each result), Remove with confirm; the OpenRouter data switch; pickers; per-kind table; Linux note; both languages; refusals translated; axe |
| `assistant-wand-state` | `apps/desktop/test/assistant-wand-state.test.ts` | the reducer: every transition, cancel, a late answer ignored, retry, edit, undo window with an injected clock, undo dropped on typing, one run at a time, "field changed while running" |
| `assistant-wand-ui` | `apps/desktop/test/assistant-wand-ui.test.tsx` | button placement and labels (improve or write), `aria-keyshortcuts`, Ctrl and Cmd+I, IME ignored, no provider opens Settings, disabled reasons, secret refusal inline, the field is unchanged until Accept, Edit, Retry, Discard, Esc in both states, focus handling, Ctrl+Z undo, the try-another-provider button, both languages, reduced motion, axe |
| `assistant-fields` | `apps/desktop/test/assistant-fields.test.tsx` | each surface of the table carries the wand with its kind and context; a source scan proves no excluded surface imports the assistant; `command` snippets have none; the snippet placeholder guard shows its refusal |
| `assistant-commit-ui` | `apps/desktop/test/assistant-commit-ui.test.tsx` | merge confirmation message field and wand; PR dialog title and description; the changes-panel suggestion with Copy; a host without the feature gives a disabled wand with its reason and receives neither `message` nor `title`; `message` and `title` are sent only when the person changed the default; the API path asks `assistant.context` and then Rust; the host path sends `source` |
| `assistant-costs-ui` | `apps/desktop/test/assistant-costs-ui.test.tsx` | the Costs page shows and filters `assistant`; pending records flush on reconnect, once each; the queue never holds text |
| `assistant-smoke` | `scripts/smoke-assistant.ts` | `smoke:assistant` starts a daemon with the fake runtime: improves a field, cancels one, refuses a secret, generates a commit message on a temporary repo, sees the usage in `costs.summary`, and prints `SMOKE ASSISTANT OK` |
| `assistant-wand-journey` | `scripts/e2e/bdd/features/assistant-wand.feature` | the five scenarios of the feature (preview, accept and undo; discard; cancel; a secret refused; a commit message for the merge), in `en` and `pt-BR` |
| `assistant-first-run-journey` | `scripts/e2e/bdd/features/assistant-first-run.feature` | the two scenarios of the feature that run on the web build (no provider opens Settings; choose Claude Code on a host), in `en` and `pt-BR`; "add an Anthropic key" is `assistant-settings-ui` and a by-hand check |

**TDD order:** `assistant-protocol`, `assistant-prompts`, `assistant-claude-complete`, `assistant-usage`, `assistant-context`,
`assistant-service`, `assistant-card-messages` (daemon slice, #156 and #162's back half); `assistant-keys`, `assistant-guard`,
`assistant-anthropic`, `assistant-openrouter`, `assistant-csp` (Rust slice, #155 and #156); `assistant-platform`, `assistant-prefs`,
`model-picker`, `assistant-settings-ui` (#155); `assistant-wand-state`, `assistant-wand-ui` (#158); `assistant-fields` (#160);
`assistant-commit-ui`, `assistant-costs-ui` (#162); then `assistant-smoke`, `assistant-wand-journey` and `assistant-first-run-journey`. Rust changes go through the
`tauri-rust-reviewer` agent before hand-off.

**Locks:**

- A key is never read back, returned, logged, written to a file, sent to a host or put in an error. The OS entry is the only copy.
- The webview never calls a provider; the CSP does not change.
- No text, diff or answer is logged or stored; the usage row has numbers only.
- The wand never changes a field before Accept or Undo; a vault value or a secret pattern in the text refuses the call.
- No fallback to another provider or host without a click.
- No network from a test but loopback; no OS credential store; no real `claude`; no floating promise and no sync call in new code.

## Risks

| Risk | Why | Mitigation |
| --- | --- | --- |
| **Policy on the plan** | Anthropic: "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK." | The host path uses the `claude` the person signed in themselves (like managed sessions) and never touches the token. The seam keeps two other providers; the host provider can be switched off by one flag if the policy changes. Say it in the manual |
| **Key typed into the webview once** | The dialog plugin has no password prompt | Held in a ref, cleared after the call, never stored or logged; no `get` command; documented honestly (decision 2); native entry window as open question 7 |
| **A compromised webview can spend the key** | App commands are open to every webview (Tauri docs) | Rust caps (input, tokens, in-flight, bucket), fixed hosts, no arbitrary URL or header. It cannot read the key. The webview can already read host tokens and vault values today |
| **Linux keys vanish at reboot** | `keyring` `linux-native` is keyutils | Documented in Settings and the manual; open question 1 (the `linux-native-sync-persistent` feature, which also changes host tokens and the vault) |
| **Spend surprises** | Reasoning is billed as output; Opus and Fable cannot turn thinking off | Quick profile defaults to Haiku; thinking off or effort low; `max_tokens` caps (4096); `maxBudgetUsd` on the host path; costs recorded; budgets count it |
| **Host one-shot is slow or heavy** | A Claude Code process per call (about 230 to 260 MB in the SDK docs); not measured | One call at a time per host; PoC 3 measures it; `prewarm()` is a Non-goal; the spinner and Cancel |
| **Plan quota used by a small request** | Each call counts on the host's plan | `Quota.blocked()` refuses first; the Settings line says it |
| **Managed-policy hosts still apply hooks or settings** | `settingSources: []` does not control managed policy | Noted in the manual; the one-shot has no tools and runs in a scratch folder |
| **Auto memory or connectors leaking into an answer** | Loaded regardless of `settingSources` | `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, `strictMcpConfig: true`; PoC 3 confirms; a test pins the options |
| **Model churn** | `claude-sonnet-4-5` ends 2026-11-30; ids move | Lists come from `GET /v1/models` and `lifecycle`; the four fixed host ids are one constant checked against the price table; the picker never hides a custom id |
| **Prompt injection through a diff or a card** | The text is data from a repo or a third-party issue | No tools anywhere in the call; the preview is the gate; the text is wrapped and the preamble says to ignore instructions inside it; redaction and path filters |
| **Secrets in a diff** | A committed `.env` line or key | Path filter, line redaction with a count, `SecretScanner` on the whole bundle, refusal when the scanner still hits |
| **OpenRouter `data_collection: deny` leaves no provider** | Routing may fail with 503 | Mapped to `assistant_routing_unavailable` with a hint to turn the switch off; default stays deny |
| **OpenRouter list is large and noisy** | 454 models; 73 are batch-only | Filter by endpoint and modality; search; group by vendor |
| **A second TLS provider in the build** | reqwest's `rustls` feature uses aws-lc-rs | Mirror the updater (`rustls-no-provider` + `ring`); PoC 5; `assistant-csp` pins the features |
| **Panic aborts the app** | `panic = "abort"` | No `unwrap` on outside data, `serde` with `Result`; the reviewer agent; tests with hostile bodies |
| **Rust is lightly covered** | No 100% rule on `src-tauri` | Rust areas in the table, `cargo test` on both OSes in CI, the reviewer agent |
| **Ctrl+I conflict** | Unknown native binding in a webview | Field-scoped handler, `preventDefault`, PoC 4, a one-line change to another chord if needed |
| **Two phases make one picker** | Phase 39 is unmerged | The contract is fixed here (`ModelOption`, `ModelPicker`); the second phase to land imports it; area `model-picker` is skipped by the second |
| **Output quality varies** | Models differ; a bad preview costs a click | The preview gate; Retry; validators for commit and snippets; quick and careful profiles; per-kind override |

## Acceptance criteria

The usual ones:

- TDD per area: every area of the table has its `test(<area>)` commit, red by assertion, before its `feat(<area>)`;
  `bun run tdd:audit -- --spec docs/SPEC-fase-40.md` and `bun run spec:lint docs/SPEC-fase-40.md` pass.
- 100% coverage on the full suite (`bun run slot -- bun run test`); `bun run typecheck` and `bun run lint` clean; `cargo test`
  green on both OSes in CI; the Rust modules went through the `tauri-rust-reviewer` agent.
- The smokes: `smoke:assistant` prints `SMOKE ASSISTANT OK`, and the existing smokes still pass.
- Both manuals have the section "AI assistant" (and the GLOSSARY its three words); `docs/decisions/` has
  ADR 40-1, ADR 40-2, the proof of concept results and every divergence from this spec.
- The spec-verifier's verdict is accept.

Specific to this phase:

- **The CSP is pinned.** The `csp` string of `tauri.conf.json` is unchanged and has no `https:` in `connect-src`; `assistant-csp`
  fails when it changes, when a file of the app names a provider host in a `fetch` or an `XMLHttpRequest`, when
  `Platform.assistant` gets a key getter, or when the registered command list differs from the expected one.
- **No key in any log.** Every error path of the Rust commands and of the daemon service is run with a recognisable fake key;
  the key is absent from the log output, the command results, the error strings, the `Debug` output of the key type, the
  usage rows and the daemon's stored events (`assistant-keys`, `assistant-anthropic`, `assistant-openrouter`, `assistant-guard`,
  `assistant-service`). The same holds for text and diffs: no log line holds any.
- One TLS provider: `cargo tree -d` shows no second one, and `assistant-csp` pins the `reqwest` features (proof of concept 5).
- By hand on Windows, before the real checks: the Credential Manager shows the `flightdeck-assistant` entries after a key is
  saved and none after Remove; Ctrl+I works in WebView2; Undo works after Accept; Cancel stops a slow call; a vault value
  pasted into the composer refuses.

## Open questions for the maintainer (a default is given; the phase follows the default unless told otherwise)

1. Switch `keyring` to a persistent Linux store in this phase? Default: no (documented limit), as it also changes host tokens and the vault.
2. Per-kind profile overrides in Settings in version 1? Default: yes, collapsed.
3. Stream answers? Default: no.
4. Add a PR title input and `card.pr.create { title }`, and a merge message field and `card.mergeLocal { message }`? Default: yes.
5. OpenRouter `data_collection: "deny"` by default? Default: yes.
6. Wand on review comments, agent files, memory and workflows? Default: no (Non-goals).
7. A native key-entry window instead of a password input? Default: no.
8. First use of the host provider on a host asks once, naming the host? Default: yes.
9. Should the daemon's `judgePermission` get the same environment fix (no `...process.env`)? Default: file a separate issue; this phase does not touch phase 13.

## Real checks

Run once, by the maintainer, at the end of all phases of the release (not per area, never in CI). They are the only place a
real provider, a real key or a real `claude` is used. Each prompt is short and the whole set costs a few cents. The key is typed
only in Settings, Assistant: never in an environment variable, a file, a shell command or a chat, and no step prints it or
reads it back. After each check the app and daemon logs are searched for the key's prefix (`sk-ant-`, `sk-or-`): no hit.
Results go to `docs/decisions/<yyyy-mm-dd>-assistant-proof.md`; a failure blocks the release.

1. **Anthropic, a real key.** Save the key; **Test** says the key works (the free `GET /v1/models?limit=1`). With the quick
   profile (`claude-haiku-5-5`), improve a card title of under twenty words: a preview appears, Accept and Undo work. Costs
   shows one `assistant` row for provider `anthropic` with its tokens. Replace the key with a deliberately wrong string:
   **Test** says "key refused", and no screen or log shows either key.
2. **OpenRouter, a real key.** Save the key; **Test** shows the limit and the free-tier flag and no `label`; the model list has
   no `:batch` id. With `anthropic/claude-haiku-5.5` (or the cheapest text model offered), improve the same title: the preview
   appears. Costs shows one `assistant` row for provider `openrouter` whose cost is the one OpenRouter returned, not the
   price table's.
3. **`claude -p`, a cheap prompt, on the host's plan.** From an empty scratch folder on a host with Claude Code signed in, with no
   `ANTHROPIC_API_KEY` in the environment: `claude -p --model claude-sonnet-5-5 --effort low --tools "" --max-turns 1
   --no-session-persistence --setting-sources "" --strict-mcp-config --max-budget-usd 0.05 --output-format json "Rewrite in
   one sentence: fix the login bug"`. It exits 0 and the JSON has a `result` and `usage`; record any flag the CLI refuses (they are the
   CLI equivalents of the options the daemon's `complete` passes). Then run the same prompt through the wand with the host provider: a preview
   appears, and the tokens recorded under origin `assistant`, provider `host`, are the `usage` of the run (within the
   estimate). Record whether `--effort low` was accepted for Sonnet.
