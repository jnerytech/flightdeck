import { diffWordsWithSpace } from "diff";

/** A run of text that stayed, was removed from the old text, or was added in the new one. */
export interface WordPart {
  kind: "same" | "del" | "add";
  text: string;
}

/** The comparison gives up after this long and shows the whole old text removed and the new one added. */
const BUDGET_MS = 500;

/**
 * What changed between two texts, word by word, spacing and line breaks included: the "same" and
 * "del" parts read back as `before`, the "same" and "add" parts as `after`.
 */
export function wordDiff(
  before: string,
  after: string,
  compare: typeof diffWordsWithSpace = diffWordsWithSpace,
): WordPart[] {
  const parts = compare(before, after, { timeout: BUDGET_MS });
  if (parts === undefined) {
    return [
      ...(before ? [{ kind: "del" as const, text: before }] : []),
      ...(after ? [{ kind: "add" as const, text: after }] : []),
    ];
  }
  return parts.map((part) => ({
    kind: part.added ? "add" : part.removed ? "del" : "same",
    text: part.value,
  }));
}
