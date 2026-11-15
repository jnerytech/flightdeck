/**
 * Phase 26: cleanup the memory screen suggests. Heuristics over the files, read only: nothing is
 * edited because of a suggestion, the person decides on the screen.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { MemorySuggestion } from "@flightdeck/protocol";
import { frontmatter } from "../agentcfg/index.ts";
import {
  contradictionsOf,
  duplicatesOf,
  NEGATIONS,
  ORDER,
  orphansAndStaleOf,
  type Topic,
} from "./domain/cleanup.ts";
import { exists } from "./exists.ts";

async function topicOf(dir: string, name: string): Promise<Topic> {
  const text = await readFile(join(dir, name), "utf8");
  const data = frontmatter(text);
  const tokens =
    (typeof data?.description === "string" ? data.description : "")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? [];
  return {
    name,
    text,
    mtimeMs: (await stat(join(dir, name))).mtimeMs,
    type: typeof data?.type === "string" ? data.type : null,
    words: new Set(tokens.filter((t) => t.length >= 3 && !NEGATIONS.has(t))),
    negated: tokens.some((t) => NEGATIONS.has(t)),
  };
}

/** Index entries that point at a file that is not there. */
async function brokenLinksOf(dir: string, index: string): Promise<MemorySuggestion[]> {
  const links = index.split("\n").flatMap((line) =>
    [...line.matchAll(/\]\(([^)\s]+\.md)\)/g)].map((match) => ({
      name: match[1] as string,
      line,
    })),
  );
  const present = await Promise.all(links.map((link) => exists(join(dir, link.name))));
  return links
    .filter((_, i) => !present[i])
    .map(({ name, line }) => ({ kind: "broken-link", files: [name], detail: line }));
}

export async function suggestCleanup(dir: string, nowMs: number): Promise<MemorySuggestion[]> {
  if (!(await exists(dir))) return [];
  const names = (await readdir(dir, { withFileTypes: true }))
    .filter((e) => e.isFile() && e.name.endsWith(".md") && e.name !== "MEMORY.md")
    .map((e) => e.name);
  const topics = (await Promise.all(names.map((name) => topicOf(dir, name)))).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const indexPath = join(dir, "MEMORY.md");
  const index = (await exists(indexPath)) ? await readFile(indexPath, "utf8") : "";
  const found: MemorySuggestion[] = [
    ...duplicatesOf(topics),
    ...(await brokenLinksOf(dir, index)),
    ...orphansAndStaleOf(topics, index, nowMs),
    ...contradictionsOf(topics),
  ];
  return found.sort(
    (x, y) =>
      ORDER.indexOf(x.kind) - ORDER.indexOf(y.kind) || x.files.join().localeCompare(y.files.join()),
  );
}
