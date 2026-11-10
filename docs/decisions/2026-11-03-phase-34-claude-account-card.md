# Phase 34 — Claude account card (phase 34)

Proof of concept, run on a Linux host (aarch64) on 2026-11-03 with claude 2.1.317 and Agent SDK 0.3.312. The signed-out,
API-key, gateway and Bedrock cases ran on a throwaway `HOME` and `CLAUDE_CONFIG_DIR`; the real account was never logged out.
Not run: a WSL host and a Windows host (no such host on this machine), so question 1 stays open for those two.

1. `accountInfo()` works on a prompt-less query (`query({ prompt: <never yields> })`, then `accountInfo()`), claude 2.1.317, SDK 0.3.312, Linux: 0.8–2 s, no prompt, no model call. WSL and Windows are unchecked; the reader keeps `claude auth status --json` as the fallback.
2. Signed out (throwaway config dir), claude 2.1.317: `claude auth status --json` prints `loggedIn:false, authMethod:"none"` and **exits 1** in about 2 s (`--text`: "Not logged in. Run claude auth login to authenticate."). The SDK's `accountInfo()` returns `{tokenSource:"none", apiProvider:"firstParty"}` (no email) and the usage report returns `rate_limits_available:false`, `rate_limits:null`. Nothing hangs or throws, so signed out = `loggedIn:false` or no email with `tokenSource:"none"`.
3. Other providers (throwaway config dir), claude 2.1.317: a fake `ANTHROPIC_API_KEY` gives `authMethod:"api_key"`, `apiKeySource:"ANTHROPIC_API_KEY"`; `ANTHROPIC_AUTH_TOKEN` with a base URL gives `authMethod:"oauth_token"`, `tokenSource:"ANTHROPIC_AUTH_TOKEN"`; Bedrock gives `authMethod:"third_party"`, `apiProvider:"bedrock"`. In all three the usage report is `rate_limits_available:false`. **On Bedrock the SDK's `accountInfo()` and usage calls hung past 20 s**, while `auth status` answered in 0.5 s. So `auth status` runs first, and the SDK is asked only when it says `claude.ai`.
4. Quota cost, claude 2.1.317: ten usage reports in a row on the real account left both windows unchanged (5 h 56 %, 7 d 53 %), and each call made no model request. Whether the June 2026 Agent SDK credit is touched stays unverified (the report carries no credit field here); the card shows the windows as the report gives them.
5. Call rate, claude 2.1.317: ten reports in a row (about 40 ms each after the first) were never refused or rate limited, and the values did not move, which suggests the server side caches them. The ceiling is unknown; the provisional floors stay (5 min while watched, 30 s for a manual refresh).
6. `claude auth status --json` shape, claude 2.1.317: the keys are `loggedIn, authMethod, apiProvider, analyticsDisabled, projectsDirectory, configDirectory`, plus `email, orgId, orgName, subscriptionType` when signed in with claude.ai, and `apiKeySource` for an API key. No schema is published, so it is the first, cheap check ("is anyone signed in, and with what") and the SDK's `accountInfo()` only supplies what it lacks; a missing key is `null`, never an error.

Divergences from the spec, phase 34:

- `AccountState.source` is `status | sdk`. The spec's `stream` was dropped: the windows always come from the host's `Quota`, whatever fed it. `AccountState` also carries `stale` and `error` (the reason of the last failed read), which the card needs for its stale and unavailable states.
- `account.get` reads once when the host was never read; later calls answer from memory.
- A usage-report failure is soft: the account stays, the windows stay as they were. Only a failed `auth status` (or a missing one with a failed SDK call) marks the read as failed.
- The SDK is asked only when `auth status` says `claude.ai`, or when there is no status (PoC question 3: Bedrock hangs the SDK calls).
- New command `account.unwatch`, not in the spec: the app watches only the host whose page is open and has to be able to stop, or the daemon would poll every host the app ever opened.
- The refresh button is off while its read runs and for 30 s after it (a prop, `cooldownMs`); the 30 s floor is also enforced by the daemon (`account_refresh_too_soon`), so a refresh sooner than 30 s after the page's own first read is refused with the seconds to wait.
- The card sits above the usage panel; the host page has no quota bars of its own (they live on the Sessions screen), so nothing was replaced.
- `smoke:conta` runs the server in the smoke's process with the real readers, a fake `claude` on PATH and a fake SDK query: a separate daemon process cannot take a fake SDK loader. The spec's "survives a daemon restart as stale" is not built: the account is kept in memory only, by design (privacy), so after a restart the card shows "Reading the account…" until the first read.
- The spec's `conta-textos` "no brand misuse" check is a scan of the account texts for "Claude Code" and "Anthropic"; the wording check "Sign in with Claude" covers both dictionaries.
