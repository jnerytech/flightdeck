import { pinnedDocProblem } from "@flightdeck/protocol";
import { readSpec } from "./spec.ts";

/**
 * Issue #76: what a card's first prompt says of the documents pinned to it: one line per document
 * that is in the worktree, with its title. Only the path and the first heading go in (never the
 * contents: the session reads a document itself), and a pin the worktree does not hold (not there,
 * a link, a file with a second name) is left out. Empty when nothing is to be said.
 */
export async function pinnedPrompt(root: string, pins: string[]): Promise<string> {
  const lines: string[] = [];
  for (const path of pins) {
    // A row that did not come through `updateCard` is held to the same rule.
    if (pinnedDocProblem(path) !== null) continue;
    const { found, heading } = await readSpec(root, path); // NOSONAR: in order, so the lines keep the order the person set
    if (found) lines.push(heading ? `- ${path}: ${heading}` : `- ${path}`);
  }
  return lines.length === 0
    ? ""
    : `Documents pinned to this card (read them before you start):\n${lines.join("\n")}`;
}
