/** What `axe-core` reports for a rule that failed on a page. */
export interface AxeViolation {
  id: string;
  impact?: string | null;
  help: string;
  nodes: Array<{ target: unknown[] }>;
}

/** The violations that fail the build. */
export function blocking(_violations: AxeViolation[]): AxeViolation[] {
  return [];
}

/** One line per violation: where, which rule, how bad, and the first elements. */
export function describeViolation(_screen: string, _violation: AxeViolation): string {
  return "";
}
