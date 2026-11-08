import type { KnowledgeEntry, KnowledgeStatus } from "@flightdeck/protocol";

/**
 * Issue #76: the `status:` line of a library document, changed from the app. Only that line of
 * the front matter (or a front matter block holding it) is written; the rest of the file is kept
 * byte for byte, and the file is left in the project's folder uncommitted, for the person.
 */

/** What the list read of a file: its size and its start. A change to either is a different file. */
export function shownHash(_size: number, _head: Buffer): string {
  return "";
}

/** The text with its front matter saying `status`, or `null` when the front matter is not clear. */
export function withStatus(_text: string, _status: KnowledgeStatus): string | null {
  return null;
}

export async function setKnowledgeStatus(
  _root: string,
  file: string,
  status: KnowledgeStatus,
  _expectedHash: string,
): Promise<KnowledgeEntry> {
  return {
    path: file,
    title: "",
    type: null,
    status,
    supersedes: null,
    bytes: 0,
    changedAt: "",
    problems: [],
    warnings: [],
    hash: "",
  };
}
