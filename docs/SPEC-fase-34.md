# Flightdeck — Phase 34 spec (Claude account card: plan, usage and account per host)

## Goal

GitHub issue #12 asks for "Sign in with Claude" and the account's plan, 5-hour and 7-day usage with reset times, and the
account name. Today the app shows the plan quota only as windows that arrive while a managed session runs a turn
(`rate_limit_event`, `apps/daemon/src/quota/quota.ts`, `QuotaPanel`). A host that is idle shows nothing, no screen says which
account a host uses, and a host that is not signed in looks the same as a host with no data.

This phase adds a **per-host account card**: the account the host's `claude` is signed in to, its plan, and the plan
windows, fresh even while idle, plus a clear state for "not signed in".

Research and sources: `flightdeck-handoff/claude-account-research.md`. The result that shapes everything:

- Anthropic does not permit third-party apps to offer Claude.ai login, to route through subscription credentials, or to
  collect, store or intermediate Claude.ai credentials or session tokens. There is no documented OAuth for third parties.
  So Flightdeck gets **no sign-in screen and no token**. The person signs in to the unmodified `claude` binary on the
  host (`claude auth login`) and Flightdeck **asks the binary** what it knows (`claude auth status --json`, the SDK's
  `accountInfo()` and its usage report). The "Sign in" in the issue title becomes "the account this host is signed in to".
- Prerequisites: phase 7 (plan quota), phase 8 (budgets), phase 29 (states), phase 32 (calm chrome).

**Out:**

- Any login UI, OAuth flow, token or cookie handling, or calling a claude.ai endpoint ourselves (that needs the token).
- Changing or logging out of the account from the app (a terminal action; the card shows the command to run).
- API-key, Bedrock, Vertex and gateway billing (Console/Admin API): those hosts show their provider and no windows.
- New budget rules from the windows (phase 7's `pauseAt` keeps working on the same readings).
- Showing the account of a host the app cannot reach (the card follows the host's connection state).

## Proof of concept first

Run on a Linux host, a WSL host and a Windows host, with the real `claude` and a short sequence of commands (no model call,
so no quota). Results go to `docs/DECISIONS.md`, phase 34 section. Each answer decides a design line below.

1. Does `accountInfo()` on a query that never receives a prompt work on every supported CLI version (verified on Linux,
   claude 2.1.317, SDK 0.3.312)? If not, fall back to `claude auth status --json` alone.
2. What do the three calls return on a host that is **not signed in** (error, `loggedIn:false`, hang)? Test on a throwaway
   `CLAUDE_CONFIG_DIR`, never by logging out the real account. Decides the timeout and the empty state.
3. What do they return on an API-key host and on a gateway host (`rate_limits_available:false`)?
4. Does the usage report cost plan quota or the monthly Agent SDK credit (Anthropic's June 2026 change)? Compare the
   windows before and after ten calls.
5. How often may the usage report be asked before it is rate limited? Decides the refresh floor.
6. Is `claude auth status --json` stable across versions? (Its fields are not in a schema.) Decides whether it is only a
   cheap pre-check or the source of truth for "signed in".

## Design

### Where the data comes from (daemon)

- One new module `apps/daemon/src/account/` with three small readers, each defensive (an unexpected shape is `null`, not a
  throw), all running through an injected `claude` executable and an SDK loader so tests use fakes (the preload's sentinel
  `claude` stays; no real call in tests):
  - `authStatus()`: `claude auth status --json` through `whichOnPath`. Gives `loggedIn`, `authMethod`, `apiProvider`,
    `email`, `orgName`, `subscriptionType`. Cheap, no SDK process.
  - `accountInfo()`: the SDK's `accountInfo()` on a prompt-less query (the trick of `probe.ts`), closed at once.
  - `usageReport()`: the SDK's usage report with `skipBehaviors: true`. Marked experimental by the SDK, so it sits behind
    one function, a version-tolerant parser and a "no windows" fallback; losing it must not break the account card.
- `Account` service (like `Quota`): the last reading, a refresh policy, watchers. It **feeds the existing `Quota`**
  with the usage report's windows (converted from 0–100 to the 0–1 fraction `QuotaWindow` uses, `resets_at` ISO kept), so
  the card, the `pauseAt` queue and the status line all read the same numbers.
- **No secret is ever stored or logged.** The email and org name are account data, kept in memory only, never written to the
  SQLite store, never in logs or traces, and never sent to a host other than the app that asked.
- A guard test fails the build if the new module (or anything under `account/`) opens a path under `.claude` that is a
  credentials file or reads a token environment variable (`CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`, …).

### Protocol

- `account.get` → `AccountState`, `account.watch` → pushes `AccountState` (the `quota.get`/`quota.watch` pattern), and
  `account.refresh` → forces a read now (rate limited, see below).
- `AccountState`: `status` (`signed_in` | `signed_out` | `api_key` | `third_party` | `unknown`), `name` (email or `null`),
  `organization` (or `null`), `plan` (`pro` | `max` | `team` | `enterprise` | `free` | other string | `null`), `provider`
  (`firstParty` | `bedrock` | …), `windows` (`QuotaWindow[]`, from `Quota`, with `readAt`), `readAt`, `source`
  (`status` | `sdk` | `stream`), and `loginCommand` (the literal string `claude auth login`, so the app can show it without
  hard-coding it in a component).
- New refusal reasons (`DAEMON_REASONS`, both dictionaries): `account_refresh_too_soon` (with `waitSeconds`),
  `account_unavailable` (the CLI is missing or the call timed out).

### Refresh policy

- On daemon start, once, after the first connection (not at boot: the host may be asleep).
- While at least one app watches (`account.watch`): every **5 minutes**, and at once when a session ends a turn (the
  `rate_limit_event` stream already refreshes the windows during a turn, so the poll only fills the idle gaps).
- With nobody watching: no polling at all.
- `account.refresh` (a button) is allowed at most once per **30 seconds** per host; sooner, it refuses with
  `account_refresh_too_soon`. The floors above are provisional until PoC question 5 answers.
- Every read has a 20-second timeout (the SDK probe uses 30; a hung CLI must not hold the daemon). A failed read keeps the
  previous state and marks it stale (`readAt` stays; the card shows its age, like the quota panel).
- A window past its `resetsAt` is dropped until a new reading arrives (the existing `Quota` rule).

### The card (app)

- A new **Account** card on the host page (`HostPage`), above the quota panel, per host (each host may be signed in to a
  different account): account name, organization, plan badge, then two bars, **5 hours** and **7 days**, each with the
  percentage, the reset time (relative, with the exact time on hover) and the age of the reading. Seven-day Opus and Sonnet
  bars appear only when the host reports them. Status colours reuse `allowed_warning` and `rejected`.
- It replaces the quota panel's windows on the host page (one place for the numbers); the `QuotaPanel` on the Costs screen keeps
  its history.
- A **refresh** button (disabled while a read runs and for 30 s after one), and "Last read 2 min ago".
- Hosts with no data show the right state, not an empty box:
  - **Not signed in**: "This host is not signed in to Claude." and the steps: open the host terminal, run
    `claude auth login`, come back. A "Copy command" button and an "Open terminal" button (the host terminal already exists).
    No form, no link that looks like a Claude login. The card never asks for a code or a token.
  - **API key / gateway / cloud provider**: "This host uses an API key (or <provider>). Plan limits do not apply." and
    nothing else.
  - **Unavailable** (timeout, CLI missing): the reason from the refusal, a retry, and the last good reading if any.
  - **Host offline**: the card follows the host's connection state; it does not show stale data as current.
- Wording: the screens say **account**, never "Sign in with Claude", and never use the Claude Code or Anthropic names or
  logos in a way that suggests endorsement (the legal page's branding rule). `docs/GLOSSARY.md` gains "account" and "plan
  window". The email is shown as text in the card and is not copied into toasts, notifications, the window title, the
  status line or the tray.
- Everything comes from the dictionaries, both languages. Keyboard: the refresh button and the copy button are focusable
  and labelled; the bars use `role="meter"` with `aria-valuenow` and the reset in `aria-valuetext`. Axe clean in both
  themes.

### Privacy and the terms (a design rule, not a feature)

- The daemon never reads `~/.claude/.credentials.json`, never reads a token env var, never calls a claude.ai endpoint. It
  runs the user's own unmodified `claude` binary and asks it. This is exactly the case the terms allow (an end user using
  their own subscription with the unmodified binary on a platform that hosts it), and it is the maintainer's to confirm
  before release. If Anthropic later offers an official OAuth for third-party apps, a new phase revisits this one.
- The email is personal data in screenshots: `demo:shots` uses a fake account (`demo@example.com`) from the demo hosts.

## Tests and criteria

| Area | What must pass |
| --- | --- |
| `conta-poc` | the PoC answers are in `docs/DECISIONS.md`, phase 34, one line each, with the command and version used |
| `conta-leitores` | `authStatus` parses the real shape and returns `null` fields for a missing key; `accountInfo` and `usageReport` parse the SDK shapes (fakes) and return "no windows" for `rate_limits: null` or `rate_limits_available:false`; an unknown extra key is ignored; a thrown error or a 20 s hang becomes `account_unavailable`; plan names map (`"Claude Max"`, `"max"`) to one value |
| `conta-estado` | `status` is `signed_in`, `signed_out`, `api_key`, `third_party` or `unknown` for each fixture; the windows go into `Quota` as 0–1 fractions with the ISO reset; a window past its reset is dropped; a failed read keeps the last state and flags it stale |
| `conta-atualizar` | no polling with no watcher; one read on first watch; a poll every 5 min while watched (fake timers); a turn end triggers a read; `account.refresh` refuses with `account_refresh_too_soon` under 30 s and carries `waitSeconds`; two refreshes at once run one read |
| `conta-protocolo` | `account.get`, `account.watch`, `account.refresh` over the socket (fake executable), unknown fields rejected by the strict schemas, the new reasons in both dictionaries and in the `recusas-daemon` test list |
| `conta-sem-segredo` | a scan test: nothing under `apps/daemon/src/account/` mentions `.credentials`, `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY` or a claude.ai URL; the state sent over the wire has no token-like field; the email never reaches the log, the store (SQLite dump) or a trace |
| `conta-cartao-ui` | `AccountCard` renders signed-in (name, plan, two bars with percentage, reset and age), the per-model bars only when present, the four empty states, the offline state, in both languages; the bars are `role="meter"` |
| `conta-cartao-acoes` | refresh calls `account.refresh` and is disabled for 30 s; "Copy command" copies `claude auth login`; "Open terminal" opens the host terminal; nothing in the card is an input |
| `conta-pagina-host` | the host page shows the card above the quota panel and a second host shows its own account; changing the watched host switches the watch |
| `conta-textos` | the `textos` scan finds no "Sign in with Claude" or "Log in with Claude" string in the dictionaries and no brand misuse; GLOSSARY has the new terms |
| `conta-enxuta` | the ping/render ratchet: an `account.watch` push re-renders only the card (a Profiler count test like `ping-renders`) |

Plus a smoke `smoke:conta` (fake `claude` on PATH printing the `auth status` JSON, a fake SDK loader), printing
`SMOKE CONTA OK`: the daemon starts, `account.watch` answers, the signed-out fixture shows the command, the signed-in
fixture shows plan and windows, and the card's data survives a daemon restart as "stale" until the first read.

TDD order: `conta-poc` (a script and a note, no app code), then `conta-leitores`, `conta-estado`, `conta-atualizar`,
`conta-sem-segredo` (daemon, each red by assertion with stubs of the real signatures), `conta-protocolo`, then the app:
`conta-cartao-ui`, `conta-cartao-acoes`, `conta-pagina-host`, `conta-enxuta`, `conta-textos`, and last the smoke and the
manuals (`docs/manual/en.md` and `pt-BR.md`: "Which account is this host using?", "What if the host is not signed in?").

**Acceptance criteria:** the usual ones (the version stays as it is on `main`), the ratchets (layout, wait, refusal, perf,
no-sync) green, axe clean in both themes and both languages, the card visible in the `demo:shots` host page prints with the
fake account, the PoC answers in `DECISIONS.md`, and one check with the real `claude` (signed in, Sonnet not needed: the
calls make no model request) comparing the card with `claude auth status` and `/usage` side by side.
