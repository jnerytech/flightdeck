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
 * With several hosts and one being read, the panels fold: that host goes first, open, and takes the
 * focus. With none being read (all hosts at once, or the sidebar) every panel stays open in order and
 * the section keeps the focus, as before. One host has nothing to choose from either.
 */
export function budgetPanels(hostIds: readonly string[], wanted: string | undefined): BudgetPanels {
  const open = wanted !== undefined && hostIds.includes(wanted) ? wanted : null;
  if (hostIds.length < 2 || open === null) {
    return { order: [...hostIds], foldable: false, open: null, focus: null };
  }
  return {
    order: [open, ...hostIds.filter((id) => id !== open)],
    foldable: true,
    open,
    focus: open,
  };
}
