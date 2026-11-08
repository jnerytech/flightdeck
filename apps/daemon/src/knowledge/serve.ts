import type { KnowledgeIndexResult } from "@flightdeck/protocol";

/**
 * Issue #76: what a session in a project is given of its library. Nothing unless the person has
 * not turned it off for the project and the project is trusted; read from the trusted checkout.
 */
export interface KnowledgeFeedDeps {
  /** Project folders where the index is not given (a folder switches off everything inside it). */
  off(): readonly string[];
  /** Looks at the folder's git boundary, then says whether its own files may load and from where. */
  trust(path: string): Promise<{ trusted: boolean; configRoot?: string }>;
}

export function knowledgeFeedFor(
  _deps: KnowledgeFeedDeps,
): (path: string) => Promise<KnowledgeIndexResult> {
  return async () => ({ text: "", fed: 0, truncated: false });
}
