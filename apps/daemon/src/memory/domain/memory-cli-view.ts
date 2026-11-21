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
export const fileJson = (file: MemoryFile): Record<string, unknown> => ({ ...file });

export const listingJson = (listing: MemoryListing): Record<string, unknown> => ({ ...listing });

export const listLines = (listing: MemoryListing): string[] =>
  listing.files.length === 0 ? [] : [listing.dir];

export const readLines = (file: MemoryFile, content: string): string[] => [file.name, content];

export const budgetLines = (budget: ContextBudget): string[] => [String(budget.startTokens)];

export const suggestionJson = (suggestion: MemorySuggestion): Record<string, unknown> => ({
  ...suggestion,
});

export const suggestLines = (suggestions: readonly MemorySuggestion[]): string[] =>
  suggestions.length === 0 ? [] : [suggestions[0]?.kind ?? ""];
