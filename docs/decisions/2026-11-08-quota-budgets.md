# Budgets in terms of the plan quota window (issue #1248)

On a subscription the cost is not what runs out: the plan window is. A budget can now be a share
of the 5-hour or the weekly window, with the same two actions as a dollar budget.

- **A command of its own.** `budget.setQuota` takes `QuotaBudgetInput`: `window` (`five_hour` or
  `seven_day`), `limitPct` (above 0, up to 1), the scope, the action and an optional `id`. The
  dollar `BudgetInput` stays as released: the protocol-surface ratchet refuses a required field
  made optional, and a second command also gives an older host a clean `unsupported`. The host
  announces `quotaBudgets` in `host.info`, so the app offers the unit only where it works. A budget
  keeps its id when edited from one unit to the other.
- **Period is the window.** `Budget.period` takes `five_hour` and `seven_day` besides `day` and
  `month`; for a window budget `limitUsd` is 0 and `limitPct` is the limit.
- **What is measured.** The host's share is the window's utilization from `Quota`. A project's
  share is that utilization times the project's part of the estimated cost of every entry since
  the window began (its reset time minus 5 hours or 7 days). It is an estimate (the plan does not
  say who used it, the same approximation `quota.history` already shows as `consumers`), and the
  budget says so with `estimated: true` so the app can label it wherever it shows.
- **Thresholds and actions.** `fraction` is the share used over the limit; alerts at 50%, 80%
  and 100% of that, once per period, and `queue` holds new cards at 100%, exactly as for dollars.
  Running sessions are never held.
- **The period of a window is the window.** `periodKey` is the window's reset time. A new reset
  starts a new period and clears the thresholds, as a new day does. With no reading of the window
  (never read, or read and since reset) `periodKey` is `unread`, the share is 0 and nothing
  alerts until a reading arrives.
- **Re-evaluation.** `Budgets` listens to `Quota` (from `start()` to `stop()`), so a new reading
  can cross a threshold at once instead of at the next usage pass.
- **Storage.** A `limit_pct` column on `budgets` (migration). Dollar budgets keep `limit_usd`; a
  window budget stores 0 there and `Budget.limitUsd` is 0 for it.

Protocol: `Budget` gains `limitPct`, `spentPct` (both `null` for dollars) and `estimated`, all
defaulted, so an app talking to an older host still parses its budgets.
