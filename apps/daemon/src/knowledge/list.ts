import type { KnowledgeListResult } from "@flightdeck/protocol";

export interface KnowledgeOptions {
  /** At most this many documents; 500 when absent. */
  maxFiles?: number;
}

export async function listKnowledge(
  _root: string,
  _opts: KnowledgeOptions = {},
): Promise<KnowledgeListResult> {
  return { entries: [], truncated: false };
}
