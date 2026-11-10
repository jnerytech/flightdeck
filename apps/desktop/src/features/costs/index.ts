/**
 * The budgets' public entry in the app (#1589, #1596): the spending limits of each host and the
 * words that name them. Another domain imports from here, never a file inside.
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
  type BudgetsCore,
  BudgetsSlice,
  type BudgetsSliceState,
  initialBudgetsState,
} from "./store.ts";
