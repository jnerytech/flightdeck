# Flightdeck — Phase 36 spec (ROI per project: agent cost against delivered work)

## Goal

GitHub issue #36 asks for the return on investment per project: what the agents cost, compared with what they
delivered. The cost side exists (the usage indexer prices every message by project key; `costs.*`, budgets and the
clients roll-up read it). The value side does not: the app knows how much was spent, not what came out.

This phase adds a **per-project ROI view**: cost, delivered work, an optional estimate of the time saved, and the
ratio, in the project's page and as a sortable table on the Costs screen with a CSV export. The first thing it shows is
**cost per delivered unit** (a card done, a PR merged), which needs no estimate; the estimate-based ROI comes second
and is always marked as an estimate.

Research and sources: `flightdeck-handoff/roi-research.md`. Findings that shape the design:

- The daemon has **no timestamp for "card done" or "PR merged"** (`cards.updated_at` moves on any edit). Without one,
  "delivered this week" cannot be counted. A small done-log is the one new fact the daemon must keep.
- Comparable tools lead with merged PRs per cost, add a **rework guardrail** (LinearB's cost per effective PR), compare
  with the previous period, and call the time-saved number an estimate (DX: net, not gross). Anthropic's own dashboard
  calls its attribution "deliberately conservative".
- Clients, hourly rates and billing are app-side data (phase 29). The daemon should never learn money.

Prerequisites: phase 4 (board), phase 7 (quota), phase 8 (costs and budgets), phase 22 (PR watch and its fix rounds),
phase 29 (clients and project keys).

**Out:** lines of code and "tests added" as signals (no reliable source); invoicing or accounting integrations (the
billed value is typed by the person); attributing a plan's quota to a person; ROI per person or per persona (the
`byPersona` cost stays where it is); any value sent to a daemon or leaving the machine; a forecast.

## Answers to the open questions of the issue

1. **Which value signals are on by default?** *Cards done* and *PRs merged* (both from Flightdeck's own data, no
   network), plus the **rework line** (PR-watch fix rounds and their cost). Off by default and switched on per project:
   *agent commits* (`git log` on the host, counted by the `Co-Authored-By` trailer; noisy when humans commit too) and
   *issues closed* (a `gh`/`az` call per refresh; the local count of cards that came from an issue and are done stays on
   by default as "issues resolved"). "Tests added" is not offered. Reason: the default signals cost nothing and cannot be
   gamed by a stray commit; the others need a decision about attribution or a CLI call.
2. **Where do the hourly rate and the hours-saved estimate live?** Split by who owns the fact:
   - **Hours per delivered unit** lives with the work, in the daemon: a project default (`defaultHours`, settable in
     the project's settings) and a per-card override (`estimateHours`). A persona does **not** carry hours (a persona
     is a way of working, not a size of work), and a card template may prefill the card's value.
   - **Hourly rate** lives with the money, in the app: on the **client** (a client is who is billed), with a
     per-project override for the odd project. A project under no client uses the app-wide default rate; with no rate
     set anywhere the estimate-based ROI is not shown (the cost-per-unit numbers still are).
   - **Plan price** (optional) is one app-wide number, "my subscription costs X a month", split by estimated cost share.
   - **Billed value** (optional) is typed in the app per client and month. Nothing is read from an invoicing system.
3. **Does ROI include the time the person spent reviewing and approving?** Not by default. The wait time of an approval
   measures how long a request *waited*, not how long the person *worked* (they may have been away). It is shown as
   information ("requests waited N h for you"). A switch, **count my review time**, adds a capped cost: each decision
   counts `min(wait, cap)` at the hourly rate, the cap defaulting to 5 minutes and settable. Reason: otherwise a request
   left overnight would make a good project look unprofitable.

## Proof of concept first

Short checks on a real host, with the results in `docs/DECISIONS.md`, phase 36 section. Each decides a line below.

1. **Agent commits.** Does `git log --since=<day> --format=%H%x00%B` plus the `Co-Authored-By` trailer separate agent
   commits from human ones across a managed session, a card's session and a terminal session (the trailer is added by
   Claude Code's commit flow; is it present with every persona and with `--no-verify` flows)? Decides whether the
   commit signal is offered or dropped.
2. **Approval waits.** Which approval paths write both `created_at` and `resolved_at` (managed `permission_requests`,
   the terminal-hook path, external sessions, the vault's `heldMs`)? Decides what the "waited for you" total covers
   and what the card says it covers.
3. **Issues closed.** Cost and auth needs of `gh issue list --state closed --search "closed:>=<date>"` and the Azure
   equivalent for a window of a month, per project, on a host without a token. Decides the refresh policy of that
   signal (on demand only, or cached for an hour).

## Design

### What the daemon keeps (facts, never money)

- **Done-log.** A table `card_done` (`card_id`, `project_key`, `done_at`, `via`: `merged` | `completed` | `moved`,
  `pr_url`, `fix_rounds`, `fix_cost_usd`), written once when a card enters Concluído (the same `place` that already
  handles merge, `card.complete` and a manual move). Cards already in Concluído when the phase lands get a row with
  `done_at = updated_at` and `via: "moved"`, marked `approx` so the view can say the date is approximate. A card that
  leaves Concluído and returns is one row (the first); a discarded card has none.
- **Estimate.** `cards.estimate_hours` (nullable) and `projects.default_hours` (nullable). A done card without an
  estimate counts the project's default; without that, it contributes no hours (and the view says how many cards had no
  estimate).
- **Roll-up command.** `roi.summary { from, to, projectKey? }` answers, per project key, for the period and for the
  same-length period before it:
  - `costUsd` (the existing `usage_entries` sum), `cards` (done count), `prsMerged`, `issuesResolved` (done cards that
    came from an issue), `fixRounds` and `fixCostUsd` (rework), `hours` (sum of estimates) with `cardsWithoutEstimate`,
    `waitedSeconds` and `decisions` (approvals in the period), and by week the same figures for the trend;
  - only when enabled for the project: `commits` (agent commits from `git log`) and `issuesClosed` (CLI), each with
    `source` and `readAt`.
  Cost per card is `costs.card`'s existing attribution; cost not tied to a card (a manual session in the project) stays
  in the project's total and is shown as "outside cards".
- Settings that are facts about the work (`defaultHours`, the enabled signals) travel in the existing project settings
  commands; the estimate on a card in the existing `card.update`.
- **No money in the daemon.** Rates, the plan price and the billed value never reach it, are not in `roi.summary` and not
  in logs. A guard test fails if the roll-up's schema grows a field with `rate`, `price`, `billed`, `usd` of value.

### What the app computes

`lib/roi.ts` takes the hosts' `roi.summary` answers (the same project key on two hosts adds up, as costs do), the
client's rates and the switches, and returns the numbers with their derivation:

- **Cost** = the period's `costUsd` (+ plan share, when the plan price is set: `price × projectCost / allProjectsCost`
  for the month) (+ review time, when counted).
- **Value (estimate)** = `hours × hourlyRate` for the done cards, plus **billed** when typed. Shown as "estimated value".
- **ROI** = `(value − cost) / cost`, shown only when cost > 0 and a value exists; **cost per card** and **cost per PR**
  = cost / count, shown whenever the count > 0; **rework** = `fixCostUsd / cost` and fix rounds per PR.
- **Trend** = the last 8 weeks, each week against the same figures; the headline compares the period with the previous
  one ("cost per card down 18%") rather than quoting an absolute ROI alone.
- Every figure carries its **derivation** (formula with the numbers filled in, which inputs are estimates, which cards
  lacked an estimate, which signals are off) for the "How is this computed?" disclosure and for the CSV.

### The screens

- **ROI card on the project's page** (the board header for the project): period switch (7 days, 30 days, this month),
  cost, cards done, PRs merged, cost per card, cost per PR, rework line, estimated hours and value, ROI with the
  previous period beside it, an 8-week trend (bars with `role="img"` and a text alternative). Estimates have an
  "estimate" badge; the card never shows an ROI without saying which inputs are estimates.
- **Per-project table on the Costs screen** (under the existing project chart): one row per project of the current
  client scope, sortable by any column, with the same figures, "—" where a figure cannot be computed, and an **Export
  CSV** button (all rows, all figures, the derivation in a column). The export is a file save through the platform, as
  the costs export already is.
- **Settings.** Client page: hourly rate (and a per-project override list); Costs settings: plan price, default rate,
  "count my review time" and its cap; Project settings: default hours per card, which optional signals are on; Card
  detail: the hours estimate (prefilled from the project default).
- **Empty and partial states:** no cost yet; cost but nothing delivered ("no card done in this period"); no rate set
  (value and ROI replaced by "set an hourly rate to see the estimated value", the cost-per-unit numbers remain); a host
  offline (its figures are marked "as of <time>", the others still add up); cards without an estimate counted and named.
- **Wording:** the screens say "estimated value" and "estimated hours", never "profit" or "savings"; ROI is called
  "return on cost (estimate)". Everything comes from the dictionaries in both languages; `docs/GLOSSARY.md` gains
  "ROI", "delivered work" and "estimated hours".

### Privacy and honesty rules (a design rule, not a feature)

- ROI is **correlational and estimated**: the page says so once, in the disclosure, in plain words. No number is shown
  as measured when it is typed.
- Nothing is sent anywhere. The CSV is written where the person chooses.
- Rates and the billed value are stored with the clients, in the app's own store, and exported/imported with them only
  if the person includes them (the clients export gets a checkbox, off by default).

## Acceptance scenarios

Written for people who do not code. They become `.feature` files in `pt-BR` and `en` under `scripts/e2e/bdd/features/`
(BDD for journeys a person reads, `docs/TDD.md`), each creating its own state; the detailed cases below the table in
**Tests and criteria** stay plain `bun test`.

```gherkin
Feature: ROI per project

  Scenario: The project page shows what the agents cost and delivered
    Given the project "shop" had 3 cards finish and 2 PRs merge this month
    And the agents' sessions in "shop" cost 12.00 dollars this month
    When I open the project "shop"
    Then the ROI card shows "3 cards done" and "2 PRs merged"
    And it shows "cost per card 4.00" and "cost per PR 6.00"
    And no estimated value or ROI is shown yet

  Scenario: An hourly rate and hours turn delivered work into an estimated value
    Given the client "Acme" has an hourly rate of 60 dollars
    And the project "shop" belongs to "Acme" and estimates 2 hours per card
    And 3 cards of "shop" were done this month and cost 12.00 dollars
    When I open the project "shop"
    Then the ROI card shows "6 estimated hours" marked as an estimate
    And it shows "estimated value 360.00" and "return on cost (estimate) 29 times"
    And "How is this computed?" lists the hours, the rate and the cost used

  Scenario: Without a rate the cost-per-unit numbers still show
    Given no hourly rate is set for "shop" or its client
    When I open the project "shop"
    Then the ROI card shows "set an hourly rate to see the estimated value"
    And the cost per card is still shown

  Scenario: Rework is shown next to the ratio
    Given a PR of "shop" needed 2 fix rounds that cost 1.50 dollars
    When I open the project "shop"
    Then the ROI card shows a rework line with "2 fix rounds" and "1.50"

  Scenario: Cards without an estimate are counted, not hidden
    Given 2 of the 3 done cards of "shop" have no hours and the project has no default
    When I open the project "shop"
    Then the estimated hours are those of the 1 card that has them
    And the card says "2 cards without an estimate"

  Scenario: The period is compared with the one before
    Given "shop" delivered 2 cards at 5.00 each last month and 3 cards at 4.00 each this month
    When I open the project "shop"
    Then the ROI card shows "cost per card down 20% from last month"

  Scenario: The Costs screen ranks the projects and exports them
    Given the projects "shop" and "blog" have different ROI this month
    When I open Costs and sort the projects table by return on cost
    Then the best project is first
    And pressing "Export CSV" saves a file with one row per project and the derivation of each figure

  Scenario: My review time counts only when I ask for it
    Given requests of "shop" waited 3 hours in total for me this month
    When I open the project "shop"
    Then the card says "requests waited 3 h for you" as information and the cost does not include it
    When I turn on "count my review time" with a cap of 5 minutes
    Then the cost includes at most 5 minutes for each decision

  Scenario: A host that is offline does not erase the project
    Given "shop" has work on two hosts and one of them is offline
    When I open the project "shop"
    Then the figures of the online host show, and the other host's figures are marked "as of" their last time
```

## Tests and criteria

| Area | What must pass |
| --- | --- |
| `roi-poc` | the three proof-of-concept answers are in `docs/DECISIONS.md`, phase 36, one line each, with the command and version |
| `roi-registro` | a card entering Concluído by merge, `card.complete` or a manual move writes one `card_done` row with `done_at`, `via`, the project key, the PR and the fix rounds and their cost; moving it out and back adds no row; a discarded card has none; the migration gives cards already in Concluído an `approx` row from `updated_at` |
| `roi-resumo` | `roi.summary` sums per project key for the period and the previous one: cost, cards, PRs merged, issues resolved, fix rounds and cost, hours (card estimate, else project default, else none) with the count of cards without an estimate, waits and decisions, and the 8 weekly buckets; cost outside cards is reported; a period with nothing is zeros, not an error |
| `roi-sinais` | agent commits (when enabled) come from the `Co-Authored-By` trailer in a fake git repo and are off by default; issues closed (when enabled) come from a fake `gh`/`az` with a cache of an hour and a refusal reason when the CLI is missing; neither runs when the project has not enabled it |
| `roi-protocolo` | `roi.summary` over the socket (fake executables), strict payload, the new refusal reasons in both dictionaries and in the `recusas-daemon` list, project settings carry `defaultHours` and the enabled signals, `card.update` carries `estimateHours` |
| `roi-sem-dinheiro` | a scan test: the roll-up schema and the card/project fields added by this phase hold no rate, price, billed or value field; the daemon never reads the clients store |
| `roi-calculo` | `lib/roi.ts`: cost with and without plan share and review time (capped), value = hours × rate (+ billed), ROI only when cost > 0 and a value exists, cost per card and per PR, rework share, previous-period comparison, 8-week trend, two hosts adding up, an offline host kept "as of", and the derivation text for each figure |
| `roi-taxas` | the client holds an hourly rate and per-project overrides, the app-wide default, the plan price and the review-time switch; they persist with the clients, are left out of a clients export unless the box is ticked, and an import restores them |
| `roi-cartao-ui` | the ROI card renders every state of the scenarios (delivered, no rate, no delivery, no cost, partial estimates, offline host), marks estimates, shows the derivation, has the trend as `role="img"` with a text alternative, in both languages |
| `roi-cartao-acoes` | the period switch recomputes; the "How is this computed?" disclosure opens and is keyboard reachable; the card's hours field saves through `card.update`; the project's default hours and signal switches save through the project settings |
| `roi-tabela-ui` | the Costs table lists the projects of the client scope, sorts by each column both ways, shows "—" where a figure cannot be computed, and its footer totals match the sum of the rows |
| `roi-csv` | **Export CSV** writes one row per project with every figure and its derivation, escapes commas and quotes, uses the language's decimal mark only in the screen (the file keeps a dot), and saves through the platform's save dialog |
| `roi-textos` | no text says "profit" or "savings"; estimates always carry the word "estimate"; the glossary has the new terms; both dictionaries have the same keys |
| `roi-enxuta` | the ping/render ratchet: a `roi.summary` refresh re-renders only the ROI card and the table, not the rest of the project page or the Costs charts |

Plus the BDD scenarios above as `.feature` files (pt-BR and en), and a smoke `smoke:roi` (a daemon on the fake runtime
with a temporary git project: finish two cards, merge one PR, set a default of 2 hours; `roi.summary` answers the counts
and the hours; a fake `gh` answers a closed issue when the signal is on), printing `SMOKE ROI OK`.

TDD order: `roi-poc` (a script and a note, no app code), then the daemon areas, each red by assertion with stubs of the
real signatures: `roi-registro`, `roi-resumo`, `roi-sinais`, `roi-protocolo`, `roi-sem-dinheiro`; then the app:
`roi-calculo`, `roi-taxas`, `roi-cartao-ui`, `roi-cartao-acoes`, `roi-tabela-ui`, `roi-csv`, `roi-enxuta`,
`roi-textos`; last the BDD features, the smoke and the manuals (`docs/manual/en.md` and `pt-BR.md`: "What did the
agents deliver for what they cost?", "Where do I set the hourly rate?", "Why is there no ROI for a project?").

**Acceptance criteria:** the usual ones (the version stays as it is on `main`), the ratchets (layout, wait, refusal,
perf, no-sync) green, axe clean in both themes and both languages, the ROI card and the Costs table visible in the
`demo:shots` prints with the demo's projects (the demo seed gets done cards and a fixed rate), the PoC answers in
`DECISIONS.md`, and one check on a real host comparing the card's cards-done and PR counts with the board and the PR
list, and its cost with the Costs screen's project total for the same period.
