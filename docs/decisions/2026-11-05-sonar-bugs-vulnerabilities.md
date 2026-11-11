# Sonar bugs and vulnerabilities (issue #198)

- **CSS S8776 and S8767 are ignored for `apps/desktop/src/styles.css` and the per-feature files split out of it in `apps/desktop/src/styles/`, nothing else (#1599).** All 31 findings sit inside Tailwind v4
  `@utility` blocks (checked one by one): `&:hover`, `&[data-columns]` and declarations inside a nested `@media` are valid CSS
  nesting there, but Sonar's CSS parser treats `@utility` as an unknown at-rule and reports "Missing scoping root" and "Invalid
  position for declaration". Rewriting them as plain classes would drop the `@utility` variant support (`hover:`, `md:`) the app
  uses, so the file is exempt through `sonar.issue.ignore.multicriteria` in `sonar-project.properties`, for these two rules only.
- **Rust S7493 (3) and S4036 / S2245 / S5443 are NOSONAR with a reason.** The Rust calls already run inside `spawn_blocking_result`
  (the rule cannot see through the helper); the `git` and `bun` scripts take the executable from the developer's `PATH` on purpose;
  `Math.random()` only picks a spare port; and the "publicly writable directory" is a list of folder names to hide.
- **Sorts (S2871, 16 sites): code-unit order unless a person reads the order.** A bare `.sort()` orders by UTF-16 code unit; a
  locale order differs for mixed case and accents, which would change any key built from a sorted list (persisted state, a dedupe
  key, a fingerprint) after an upgrade. `byCodeUnit` (`packages/protocol/src/compare.ts`) is the explicit, byte-identical
  comparator and a test pins that a key joined from a mixed-case list is the same as before. `localeCompare(b, "en")` is used only
  for the three lists a person reads:
  - `byCodeUnit`: `ssh/import.ts` (import order), `agentcfg/files.ts` (item order), `lib/tabs.ts` (`routeKey`), `smoke-webhook.ts`
    (keys compared), `lib/client-scope.ts` (project keys), `lib/app-store.ts` x2 (alert key, online-host key), `telemetry/otlp-env.ts`
    (managed keys compared), `telemetry/store.ts` (project keys), `personas/store.ts` (untrusted ids), `smoke-rules-vault.ts` and
    `smoke-automation.ts` (outcomes compared), `actions/schema.ts` (secret ids).
  - `localeCompare(b, "en")`: `roi/summary.ts` (project rows), `lib/trace.ts` (tool names), `ui/ConnectionsPage.tsx` (tag list).
- **Also fixed in code:** `reduce` has an initial value, `map` callbacks that take an index say so, a float is compared within a tolerance, and the import
  pattern of `scripts/lib/bundle-reach.ts` no longer backtracks quadratically (30,000 spaces: 1.2 s to milliseconds).
