import type { AppStore } from "@/lib/app-store";

export interface HarnessShareProps {
  store: AppStore;
  hostId: string;
  path: string;
}

/**
 * Issue #75, slice T2: shares the project's Markdown setup (CLAUDE.md, agents, skills; never
 * settings) as a host template, after the person named it.
 */
export function HarnessShare(_props: Readonly<HarnessShareProps>) {
  return null;
}
