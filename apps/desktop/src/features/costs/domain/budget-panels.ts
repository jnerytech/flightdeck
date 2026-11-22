/** The id of a host's panel heading button, which takes the focus when the host is the one being read. */
export const budgetHeadingId = (hostId: string): string => `budgets-heading-${hostId}`;

/** How Settings lays out the Budgets panels of the hosts that can hold budgets (#3912). */
interface BudgetPanels {
  /** The hosts in the order their panels show: the host being read first. */
  order: string[];
  /** Whether the panels fold; false for one host, which has nothing to choose from. */
  foldable: boolean;
  /** The host whose panel opens expanded, or null when none does. */
  open: string | null;
  /** The host whose heading takes the focus, or null when the section does. */
  focus: string | null;
}

/**
 * With several hosts the panels fold: the host being read goes first, open, and takes the focus; with
 * none being read nothing opens and the first heading takes the focus. One host has nothing to choose
 * from, so its panel stays open and the section keeps the focus.
 */
export function budgetPanels(hostIds: readonly string[], wanted: string | undefined): BudgetPanels {
  if (hostIds.length < 2) return { order: [...hostIds], foldable: false, open: null, focus: null };
  const open = wanted !== undefined && hostIds.includes(wanted) ? wanted : null;
  const order = open === null ? [...hostIds] : [open, ...hostIds.filter((id) => id !== open)];
  return { order, foldable: true, open, focus: open ?? hostIds[0] ?? null };
}
