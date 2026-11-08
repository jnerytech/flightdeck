import type { AppStore } from "../../lib/app-store.ts";

/**
 * Issue #79: "Choose an alert" beside a workflow's `alert` input. The host reads the repository's
 * open code-scanning and Dependabot alerts; picking one puts its text in the input.
 */
export function AlertPicker(
  _props: Readonly<{
    store: AppStore;
    hostId: string;
    projectId: string;
    onPick(text: string): void;
  }>,
) {
  return null;
}
