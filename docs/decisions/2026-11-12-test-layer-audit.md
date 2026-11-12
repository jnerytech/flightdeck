# The test layer, audited against Khorikov's rules (issue #1850)

- **Why.** #1850 asks for the whole test layer to be reviewed against the strategy in
  `docs/TDD.md` ("What a test checks"): keep what tests behavior, rewrite what stays but is coupled
  to an implementation, delete what makes no sense. This file is the audit table; the slices that
  act on it follow, one tests-only PR per domain (product code unchanged).
- **Baseline (2026-11-12, `bun run test:tiers`).** 1,696 test files by content: unit 790, component
  479, integration 391, e2e 36. By domain (`*.test.ts[x]`): daemon 579, desktop 884, protocol 24,
  scripts 172. The two do not sum to one total: the tiers are counted by content and include the
  `*.e2e.ts` journeys, the domains by file name. Suite time before and after is read from the PR's CI
  pyramid table, not from the Pi.
- **Method.** Four read-only reviewer passes (one per domain, the `test-quality-reviewer` brief),
  each starting from greps over the whole domain (source-text reads, casts into private state, mocks
  of our own modules, vacuous assertions, duplicates) and reading the strongest candidates in full.
  Rows marked `*` were re-read by fd-qa before they were acted on. A file that is not listed is
  **keep**: it runs the real code and asserts a value, state or text a person sees. The reviewers did
  not read every file; "keep" means no candidate survived the greps, not a line-by-line proof.
- **What stays by design.** Repo-wide ratchets and policy scans (`scripts/test/guards/*`,
  `texts/*`, `test-anchors`, the CSP and capability pins) check a rule about the repo, not a
  behavior: they scan on purpose and have unit tests on their scanner. The OpenCode runtime and its
  guards stay: only the review step was retired (2026-11-10), the runtime is still wired.

## Findings by domain

### scripts (172 files): mostly keep

The planners in `scripts/lib` are tested as pure functions with literal expectations, and the
`slot`, `release` and `pr-flow` suites use temp repos and PATH fakes. The faults are text pins.

| path | verdict | stays protected by | slice |
|---|---|---|---|
| `ci/coverage-check.test.ts` * (threshold regex over `bunfig.toml`) | rewrite: parse TOML | same test, parsed | 1, done |
| `ci/lint-floating-promises.test.ts` * (greps `docs/TDD.md` for a word) | delete that test | Biome setting test in the same file | 1, done |
| `hooks/hook-test-markers.test.ts` * (`.skip` test) | delete one test | `hooks/hook-skip.test.ts` runs the same edit and reason | 1, done |
| `demo/shots-narrow.test.ts`, `ci/ci-prints.test.ts` (order of calls in `scripts/demo-shots.ts` source) | keep for now | the wiring has no behavior test; a rewrite needs the entry point split first | later |
| `ci/ci-ubuntu-split`, `ci-shards`, `ci-pyramid` (the same `ci.yml` job graph asserted three times) | merge into one workflow test | parsed `needs` and `if` of the required checks | 2 |
| `release/release-metrics-job.test.ts`, `ci/ci-paths.test.ts` (apt cache), `ci/mutation-config.test.ts` (3 of 4), `ci/sonar-scanner.test.ts` (job wiring), `ci/e2e-config.test.ts` (text of `.e2e.ts`) | rewrite or delete the substring pins on shell and config text | parsed YAML order and `if` equality; the CI run itself | 2 |
| `guards/sonar-*.test.ts` (7 files named for a Sonar rule: `sonar-regex2`, `sonar-regex3`, `sonar-three`, `sonar-scripts2`, `sonar-scripts3`, `sonar197-findlast`, `sonar197-regex-forms`) | merge into the file that owns each function; drop the `took() < 250 ms` wall-clock checks (ambient time) | `md-links`, `bundle-reach`, `spec-lint`, `sleep-ratchet`, `pr-flow`, `ci-paths` tests | 2 |
| `release/tauri-window.test.ts`, `demo/theme-contrast.test.ts` (form-control regex), `guards/no-money.test.ts` (regex over protocol source), `demo/screens-lazy.test.ts` | rewrite: copies of config values or source regexes | parsed config, the protocol schema, `guards/bundle-reach.test.ts` | 2 |
| `demo/smoke-daemon.test.ts` (every smoke waits the same way), `release/tauri-release.test.ts` (Rust panic scan) | needs a decision | no other check; the Rust scan is the only one for that crate | later |

### daemon (579 files): keep, with source-text scans and own-module spies to fix

No `mock.module` anywhere. Real board, store and git run in the tests.

| path | verdict | how it stays protected |
|---|---|---|
| `deps/gate.test.ts` * (`startCallers`: greps `.startCard(` in `src`) | delete, daemon slice | the same file runs each start door (`startCard`, `startArena`) and asserts `card_blocked` |
| `account/no-secret.test.ts` * (10 regexes over `src` for `.credentials`, `process.env`) | keep: a deliberate security scan of the account module (never read credentials) | the scan itself; the last test also runs `Account` and checks its wire state |
| `server/gates.test.ts` * (`GATES` equals a pinned copy of itself) | delete that test, daemon slice | the behavior tests in the same file; `server/features.test.ts` compares the gates to `DAEMON_FEATURES` |
| `server/features.test.ts` * (test 1: regex over `src/server`, a deliberate scan from #747) | needs a decision | a rewrite needs a product change (type `featureOff` with `DaemonFeature`); tests-only slices cannot do it |
| `board/contracts.test.ts` ("only card.move asks": reads `src`) | rewrite | assert no other path moves a card |
| `review/type.test.ts` ("a Rev is forged nowhere": regex `as Rev`) | rewrite | branded type, `tsc` refuses a cast |
| `core/refusal-english.test.ts`, `core/homedir-ratchet.test.ts` | rewrite | assert at the raise point; a Biome rule |
| `telemetry/otlp-receiver.test.ts` (source `not.toContain("gunzipSync")`; spy on `timingSafeEqual`) | rewrite | injected `inflate` and 413 tests; a same-length wrong token gets 401 |
| `worktrees/security.test.ts` (reads desktop dictionary source), `packages/protocol/test/assistant/protocol.test.ts` (dictionary and Rust `REASONS` by regex) | rewrite | desktop dictionary test imports `en` and `pt-BR` |
| `history/wiring.test.ts`, `board/check-loop-wiring.test.ts`, `automations/wiring.test.ts`, `teams/teams.test.ts` (spies on our own modules, `as never` fakes) | rewrite | run the real module, read the effect back; `watch/check-loop-board.test.ts` and `daemon/stop-order.test.ts` already show how |
| `core/refusals-session.test.ts` (private `live` map), `watch/check-loop-board.test.ts` (private `onSessionEvent`), `runtime/session-runtime.test.ts` (private `starts`), `sessions/sessions.test.ts` (private `open`) | rewrite or delete | public API; the neighbour tests cover the refusal |
| `resources/wiring.test.ts`, `actions/execution.test.ts`, `actions/timing.test.ts` (fake `Bun.spawn`, a type we do not own) | rewrite | fake `getconf` and the runner on the test PATH |
| `power/keep-awake.test.ts`, `personas/model.test.ts`, `vault/rules-audit.test.ts` (expected value comes from the function under test) | rewrite | write the literal |
| `core/coverage-main-0330.test.ts` * (two `toBeDefined`/`length > 0` assertions), `git/sync.test.ts` * (dead `SRC` helper) | rewrite, daemon slice | exact status, exit code and text |
| `central/*` (6 files cast `{...} as unknown as Central`) | rewrite later | build the real `Central` |

### desktop (884 files): the CSS-text debt of #1870 is not gone

Greps: 41 files read `styles.css`, 34 read component or Rust source, 63 seed state through a cast
to the store's private `update()`, 91 assert class names, 3 use `mock.module`. The e2e `layout`
journey measures the real browser and is the protection for the layout rows.

| path | verdict | stays protected by |
|---|---|---|
| `tabs/look`, `tabs/largura`, `layout/overflow`, `margens-blocos`, `dialogo-centro`, `dialogo-compacto`, `bloco-pedido`, `linhas-bloco`, `movimento-tokens`, `css-utilities`, `simple/narrow-ui`, `sessions/hub-row-narrow`, `sessions/session-header`, `sidebar/target`, `sidebar/project-name`, `projects/tree-ui` (CSS regex only) | delete | e2e `layout` journey and `demo:shots`; `style-lint` for the rule-shaped ones |
| `clients/ui-layout`, `visual-direction/telas` (L121-151), `keycap` (L85-93), `areas-container` (L125-141) (source scans of `.tsx`) | delete the scan | `scripts/lib/style-lint.ts` or a Biome rule |
| `crumb-largura`, `icon-tip`, `tabela-larga`, `split-tabbar`, `ux-basicos`, `toggle-pressed`, `rolagem`, `botao-motivo-linha`, `palette/mais-ui`, `pagina-host`, `board/ui`, `hosts/host-health-ui`, `costs/table`, `costs/cost-chart` (one CSS or class case each in files that otherwise render) | rewrite: drop that case | the rendered cases beside it |
| `layout/layout`, `layout/list-row`, `layout/compose`, `visual-direction/colunas` (class lists, `getByTestId`) | rewrite | role, text and open/closed state |
| `scale-needs-you`, `orcamento-conversa` (`mock.module` of our own components) | rewrite | React `Profiler` render counts |
| `quota/por-conta`, `quota/ui`, `refusal-focus-ui` (hand-built store, private `dispatch`) | rewrite | real store fed by events |
| `board/card-pr-detect-ui`, `board/contracts-ui`, `board/keys-ui`, `board/multi-review`, `hosts/host-offline-actions`, `approval/safety`, `oldest-gate`, `assistant/gaps` (private `update()` / `state =`) | rewrite, after one shared seeding helper over the public stream | stream events |
| `selo-barra-loja`, `abrir-resultado-tauri`, `log/tauri` (grep Rust source from JS) | needs a decision | `tauri-rust-reviewer`; a `cargo test` |
| `sonar/regex2.test.tsx` | merge into `folder/ui.test.tsx` | |
| `chat/atividade.test.tsx` (`data-testid="activity"`) | rewrite | role or label |

## Slices that follow

Each is tests only, with `Tests-Removed:` trailers (the removed-tests guard, #2176), the test count
and the CI pyramid time before and after in the PR body, `handoff:check` green, `bun run arch` at or
under its baseline.

1. **scripts, slice 1** (this branch): the three safe rows marked done above.
2. **daemon**: the safe rows marked "daemon slice" above first (`deps/gate`, `server/gates`,
   `core/coverage-main-0330`, `git/sync`), then the own-module spies and private-state casts.
   `account/no-secret` stays; `server/features` waits for the product change.
3. **protocol**: the dictionary and Rust `REASONS` tests, moved to a desktop dictionary test.
4. **desktop**: the CSS-text deletes (the long first row), then the seeding helper, then the rest.
5. **scripts, slice 2**: the `ci.yml` merge and the `sonar-*` merges.
