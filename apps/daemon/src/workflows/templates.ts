import type { WorkflowTemplate } from "@flightdeck/protocol";

/**
 * Issue #79: the workflow templates that ship with the daemon, as the files to commit under
 * `.flightdeck/workflows/`. `testCommand` is the project's detected test command (issue #75), or
 * null when none is known.
 */
export function workflowTemplates(_testCommand: string | null): WorkflowTemplate[] {
  return [];
}
