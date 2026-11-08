import type { KnowledgeEntry } from "@flightdeck/protocol";

/**
 * Issue #76: the index of a project's library that a session is given in its system prompt.
 */
export interface KnowledgeFeed {
  /** Markdown for the system prompt; empty when there is nothing to give. */
  text: string;
  /** Documents named in the text. */
  fed: number;
  /** Some fed-eligible documents were left out to stay under the cap. */
  truncated: boolean;
}

/** The most the index takes in the system prompt, in bytes. */
export const FEED_MAX_BYTES = 4096;

export function feedIndex(
  _entries: readonly KnowledgeEntry[],
  _maxBytes: number = FEED_MAX_BYTES,
): KnowledgeFeed {
  return { text: "", fed: 0, truncated: false };
}
