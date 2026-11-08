import type { AppStore } from "../lib/app-store.ts";

/**
 * The host's Claude Code setup templates (`harness.templates.*`, #75): the ones shared from a
 * project, each with a way to delete it. Deleting asks first.
 */
export function HarnessTemplatesSection(_props: Readonly<{ store: AppStore; hostId: string }>) {
  return null;
}
