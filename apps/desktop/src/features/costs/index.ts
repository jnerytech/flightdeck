/**
 * The costs' public entry in the app (#1589, #1596): the spending limits of each host, the
 * clients' month limits against their spend, and the words that name them. Another domain imports
 * from here, never a file inside. The host's budgets form is in ui.ts (#2451). The costs screen (`page.tsx`, with its
 * charts and tables) is left out on purpose: `app/Screens.tsx` loads it as a lazy chunk, and
 * exporting it here would pull it into the main bundle.
 */

export {
  type ClientBudgetsCore,
  ClientBudgetsSlice,
  type ClientBudgetsSliceState,
  initialClientBudgetsState,
} from "./client-budgets-store.ts";
export {
  ACTION_LABELS,
  type BudgetAlert,
  budgetAlerts,
  budgetLabel,
  budgetLimitText,
  budgetLine,
  estimateNote,
  projectName,
  share,
} from "./domain/budgets.ts";
export {
  CLIENT_BUDGET_ALERTS_KEY,
  type ClientBudgetState,
  evaluateClientBudgets,
} from "./domain/client-budgets.ts";
export {
  ALL_HOSTS,
  addDays,
  daysBetween,
  localDay,
  periodRange,
  projectLabel,
  projectLabels,
  projectPath,
  usd,
} from "./domain/costs.ts";
export {
  ALL_SCOPE,
  activeScope,
  awayKey,
  type DataScope,
  DataScopeController,
  hubHostScope,
  scopeHosts,
  scopeOfValue,
  scopeValue,
} from "./domain/data-scope.ts";
export { projectLabel as usageProjectLabel, type UsageHistoryTarget } from "./domain/usage-rows.ts";
export {
  type BudgetsCore,
  BudgetsSlice,
  type BudgetsSliceState,
  initialBudgetsState,
} from "./store.ts";
export { wireBudgets, wireClientBudgets } from "./wire.ts";
