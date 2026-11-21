/**
 * Issue #3618: what `flightdeckd memory` prints, as pure rules over the daemon's answers. A `--json`
 * value keeps every key: `null` where the daemon sends none (`type` and `description` of a file, `detail`
 * of a suggestion).
 */
import type {
  ContextBudget,
  MemoryFile,
  MemoryListing,
  MemorySuggestion,
} from "@flightdeck/protocol";

/** A file with every key a script reads. */
export const fileJson = (file: MemoryFile) => ({
  ...file,
  type: file.type ?? null,
  description: file.description ?? null,
});

export const listingJson = (listing: MemoryListing) => ({
  ...listing,
  files: listing.files.map(fileJson),
});

export const suggestionJson = (suggestion: MemorySuggestion) => ({
  ...suggestion,
  detail: suggestion.detail ?? null,
});

/** The file's size, whether the index names it, and its type and description when it has them. */
const facts = (file: MemoryFile): string[] => [
  `${file.bytes} bytes`,
  `${file.lines} lines`,
  file.inIndex ? "in index" : "not in index",
  ...[file.type, file.description].filter((part) => part !== undefined),
];

export const listLines = (listing: MemoryListing): string[] => {
  if (!listing.exists) return [`no memory folder: ${listing.dir}`];
  if (listing.files.length === 0) return [`no memory files in ${listing.dir}`];
  return listing.files.map((file) => [file.name, file.hash, ...facts(file)].join("  "));
};

/** The file's identity, its hash (what a later write repeats), a blank line, and its content. */
export const readLines = (file: MemoryFile, content: string): string[] => [
  [file.name, ...facts(file)].join("  "),
  `hash: ${file.hash}`,
  "",
  ...content.split(/\r\n|\r|\n/),
];

export const budgetLines = ({ startTokens, memory: m }: ContextBudget): string[] => [
  `start of a session: ${startTokens} tokens`,
  `index: ${m.indexLines} lines of ${m.limitLines}, ${m.indexBytes} bytes of ${m.limitBytes}`,
  `loaded: ${m.loadedLines} lines, ${m.loadedBytes} bytes, ${m.cutBy ? `cut by ${m.cutBy}` : "all of it"}`,
  ...m.leftOutLines.map((line) => `left out of the index: ${line}`),
  ...(m.leftOutFiles.length > 0 ? [`left out files: ${m.leftOutFiles.join(", ")}`] : []),
];

export const suggestLines = (suggestions: readonly MemorySuggestion[]): string[] =>
  suggestions.length === 0
    ? ["no suggestions"]
    : suggestions.map((s) =>
        [s.kind, s.files.join(", "), ...(s.detail === undefined ? [] : [s.detail])].join("  "),
      );

/** What a write printed: the file and the hash a later write repeats. */
export const wroteLine = (name: string, hash: string): string => `wrote ${name}  hash: ${hash}`;

export const deletedLine = (name: string): string => `deleted ${name}`;
