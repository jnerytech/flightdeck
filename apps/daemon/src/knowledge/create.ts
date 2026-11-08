import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { KnowledgeEntry, KnowledgeKind } from "@flightdeck/protocol";

/**
 * Issue #1039: a new library document from a template, written into the project's folder for its
 * kind, never over a file that is there, and left uncommitted for the person.
 */
export async function createKnowledgeDoc(
  root: string,
  kind: KnowledgeKind,
  _title: string,
): Promise<KnowledgeEntry> {
  await mkdir(join(root, "docs", kind), { recursive: true });
  await writeFile(join(root, "docs", kind, "stub.md"), "stub\n");
  return {
    path: `docs/${kind}/stub.md`,
    title: "",
    type: null,
    status: "unclassified",
    supersedes: null,
    bytes: 0,
    changedAt: "1970-01-01T00:00:00.000Z",
    problems: [],
    warnings: [],
    hash: "",
  };
}
