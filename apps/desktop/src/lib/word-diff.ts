/** A run of text that stayed, was removed from the old text, or was added in the new one. */
export interface WordPart {
  kind: "same" | "del" | "add";
  text: string;
}

export function wordDiff(_before: string, _after: string): WordPart[] {
  return [];
}
