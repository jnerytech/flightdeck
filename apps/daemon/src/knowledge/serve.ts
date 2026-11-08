import type { KnowledgeIndexResult } from "@flightdeck/protocol";
import { isInside, rootNames } from "../paths.ts";
import { feedIndex } from "./feed.ts";
import { listKnowledge } from "./list.ts";

/**
 * Issue #76: what a session in a project is given of its library. Nothing unless the project is
 * trusted (its documents are text from the repository, going into the system prompt) and the
 * person has not switched it off for the folder. A worktree is read from the trusted checkout it
 * belongs to, never from the branch.
 */
export interface KnowledgeFeedDeps {
  /** Project folders where the index is not given (a folder switches off everything inside it). */
  off(): readonly string[];
  /** Looks at the folder's git boundary, then says whether its own files may load and from where. */
  trust(path: string): Promise<{ trusted: boolean; configRoot?: string }>;
}

const nothing = (): KnowledgeIndexResult => ({ text: "", fed: 0, truncated: false });

export function knowledgeFeedFor(
  deps: KnowledgeFeedDeps,
): (path: string) => Promise<KnowledgeIndexResult> {
  return async (path) => {
    const { trusted, configRoot } = await deps.trust(path);
    if (!trusted) return nothing();
    // A folder is one place under its real name and the one it was given by. The checkout a
    // worktree is read from counts too: a worktree can lie outside the project it belongs to.
    const where = await rootNames(configRoot ? [path, configRoot] : [path]);
    const off = await rootNames(deps.off());
    if (off.some((folder) => where.some((name) => isInside(folder, name)))) return nothing();
    return feedIndex((await listKnowledge(configRoot ?? path)).entries);
  };
}
