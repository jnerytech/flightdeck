/**
 * The budgets' public entry in the app (#1589, #1596): the spending limits of each host, the
 * clients' month limits against their spend, and the words that name them.
 * Another domain imports from here, never a file inside.
 */
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
} from "./budgets.ts";
export {
  CLIENT_BUDGET_ALERTS_KEY,
  type ClientBudgetState,
  evaluateClientBudgets,
} from "./client-budgets.ts";
export {
  type ClientBudgetsCore,
  ClientBudgetsSlice,
  type ClientBudgetsSliceState,
  initialClientBudgetsState,
} from "./client-budgets-store.ts";
export {
  type BudgetsCore,
  BudgetsSlice,
  type BudgetsSliceState,
  initialBudgetsState,
} from "./store.ts";
