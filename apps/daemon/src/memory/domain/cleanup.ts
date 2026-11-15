// Pure memory-cleanup rules: which topics are duplicates, orphans, stale or contradictory.
import { createHash } from "node:crypto";
import type { MemorySuggestion } from "@flightdeck/protocol";

const STALE_AFTER_MS = 90 * 86_400_000;
export const NEGATIONS = new Set([
  "not",
  "never",
  "dont",
  "don",
  "nunca",
  "não",
  "nao",
  "jamais",
  "sem",
]);
export const ORDER: MemorySuggestion["kind"][] = [
  "duplicate",
  "broken-link",
  "orphan",
  "stale",
  "contradiction",
];

export interface Topic {
  name: string;
  text: string;
  mtimeMs: number;
  type: string | null;
  /** The words of the description with the negations taken out, and whether there were any. */
  words: Set<string>;
  negated: boolean;
}

const similar = (a: Set<string>, b: Set<string>) => {
  const shared = [...a].filter((w) => b.has(w)).length;
  return a.size >= 2 && b.size >= 2 && shared / (a.size + b.size - shared) >= 0.6;
};

/** Topics with the same text (ignoring surrounding blank space). */
export function duplicatesOf(topics: Topic[]): MemorySuggestion[] {
  const byContent = new Map<string, string[]>();
  for (const t of topics) {
    const key = createHash("sha256").update(t.text.trim()).digest("hex");
    byContent.set(key, [...(byContent.get(key) ?? []), t.name]);
  }
  return [...byContent.values()]
    .filter((files) => files.length > 1)
    .map((files) => ({ kind: "duplicate", files }));
}

/** Topics the index does not mention, and topics not touched for a long time. */
export function orphansAndStaleOf(
  topics: Topic[],
  index: string,
  nowMs: number,
): MemorySuggestion[] {
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

export function contradictionsOf(topics: Topic[]): MemorySuggestion[] {
  return topics.flatMap((a, i) =>
    topics
      .slice(i + 1)
      .filter((b) => contradicts(a, b))
      .map((b) => ({ kind: "contradiction", files: [a.name, b.name] })),
  );
}
