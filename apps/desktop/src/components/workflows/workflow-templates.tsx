import type { AppStore } from "../../lib/app-store.ts";

/**
 * Issue #79: "Add from a template" on the Workflows screen. The templates are files to copy and
 * commit to the base branch; the host writes nothing.
 */
export function WorkflowTemplates(
  _props: Readonly<{ store: AppStore; hostId: string; projectId: string }>,
) {
  return null;
}
