/**
 * Phase 26: cleanup the memory screen suggests. Heuristics over the files, read only: nothing is
 * edited because of a suggestion, the person decides on the screen.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { frontmatter } from "../agentcfg/files.ts";
import type { MemorySuggestion } from "./memory.ts";

const STALE_AFTER_MS = 90 * 86_400_000;
const NEGATIONS = new Set(["not", "never", "dont", "don", "nunca", "não", "nao", "jamais", "sem"]);
const ORDER: MemorySuggestion["kind"][] = [
  "duplicate",
  "broken-link",
  "orphan",
  "stale",
  "contradiction",
];

interface Topic {
  name: string;
  text: string;
  mtimeMs: number;
  type: string | null;
  /** The words of the description with the negations taken out, and whether there were any. */
  words: Set<string>;
  negated: boolean;
}

function topicOf(dir: string, name: string): Topic {
  const text = readFileSync(join(dir, name), "utf8");
  const data = frontmatter(text);
  const tokens =
    (typeof data?.description === "string" ? data.description : "")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? [];
  return {
    name,
    text,
    mtimeMs: statSync(join(dir, name)).mtimeMs,
    type: typeof data?.type === "string" ? data.type : null,
    words: new Set(tokens.filter((t) => t.length >= 3 && !NEGATIONS.has(t))),
    negated: tokens.some((t) => NEGATIONS.has(t)),
  };
}

const similar = (a: Set<string>, b: Set<string>) => {
  const shared = [...a].filter((w) => b.has(w)).length;
  return a.size >= 2 && b.size >= 2 && shared / (a.size + b.size - shared) >= 0.6;
};

/** Topics with the same text (ignoring surrounding blank space). */
function duplicatesOf(topics: Topic[]): MemorySuggestion[] {
  const byContent = new Map<string, string[]>();
  for (const t of topics) {
    const key = createHash("sha256").update(t.text.trim()).digest("hex");
    byContent.set(key, [...(byContent.get(key) ?? []), t.name]);
  }
  return [...byContent.values()]
    .filter((files) => files.length > 1)
    .map((files) => ({ kind: "duplicate", files }));
}

/** Index entries that point at a file that is not there. */
function brokenLinksOf(dir: string, index: string): MemorySuggestion[] {
  return index.split("\n").flatMap((line) =>
    [...line.matchAll(/\]\(([^)\s]+\.md)\)/g)]
      .map((match) => match[1] as string)
      .filter((name) => !existsSync(join(dir, name)))
      .map((name) => ({ kind: "broken-link", files: [name], detail: line })),
  );
}

/** Topics the index does not mention, and topics not touched for a long time. */
function orphansAndStaleOf(topics: Topic[], index: string, nowMs: number): MemorySuggestion[] {
  return topics.flatMap((t) => {
    const found: MemorySuggestion[] = [];
    if (!index.includes(t.name)) found.push({ kind: "orphan", files: [t.name] });
    if (nowMs - t.mtimeMs > STALE_AFTER_MS) found.push({ kind: "stale", files: [t.name] });
    return found;
  });
}

/** Two topics of the same type that say the same with and without a negation. */
const contradicts = (a: Topic, b: Topic): boolean =>
  a.type !== null && a.type === b.type && a.negated !== b.negated && similar(a.words, b.words);

function contradictionsOf(topics: Topic[]): MemorySuggestion[] {
  return topics.flatMap((a, i) =>
    topics
      .slice(i + 1)
      .filter((b) => contradicts(a, b))
      .map((b) => ({ kind: "contradiction", files: [a.name, b.name] })),
  );
}

export function suggestCleanup(dir: string, nowMs: number): MemorySuggestion[] {
  if (!existsSync(dir)) return [];
  const topics = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".md") && e.name !== "MEMORY.md")
    .map((e) => topicOf(dir, e.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  const indexPath = join(dir, "MEMORY.md");
  const index = existsSync(indexPath) ? readFileSync(indexPath, "utf8") : "";
  const found: MemorySuggestion[] = [
    ...duplicatesOf(topics),
    ...brokenLinksOf(dir, index),
    ...orphansAndStaleOf(topics, index, nowMs),
    ...contradictionsOf(topics),
  ];
  return found.sort(
    (x, y) =>
      ORDER.indexOf(x.kind) - ORDER.indexOf(y.kind) || x.files.join().localeCompare(y.files.join()),
  );
}
