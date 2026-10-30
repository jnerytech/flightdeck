/** What `axe-core` reports for a rule that failed on a page. */
export interface AxeViolation {
  id: string;
  impact?: string | null;
  help: string;
  nodes: Array<{ target: unknown[] }>;
}

/** The violations that fail the build. */
export function blocking(violations: AxeViolation[]): AxeViolation[] {
  return violations.filter((v) => v.impact === "serious" || v.impact === "critical");
}

/** One line per violation: where, which rule, how bad, and the first elements. */
export function describeViolation(screen: string, violation: AxeViolation): string {
  const targets = violation.nodes
    .slice(0, 3)
    .map((node) => node.target.join(" "))
    .join(", ");
  return `${screen}: ${violation.id} (${violation.impact}): ${violation.help} [${targets}]`;
}
