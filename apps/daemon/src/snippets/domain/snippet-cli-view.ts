/** Issue #3615: what `flightdeckd snippet render`, `parse` and `import-history` print, as pure rules over the daemon's answers. */
import type { SnippetHistoryResult, SnippetInput } from "@flightdeck/protocol";

/** The rendered text, line by line so that a multi-line prompt stays one text on stdout. */
export const renderLines = (text: string): string[] => text.split("\n");

/** One line per snippet the text held: its name, its type and its tags. */
export function parseLines(snippets: SnippetInput[]): string[] {
  return snippets.map((s) =>
    [s.name, s.type, ...(s.tags?.length ? [`tags: ${s.tags.join(",")}`] : [])].join("  "),
  );
}

/** One line per candidate, or a sentence when there is none; a command the secret scan hid shows what it found, never the value. */
export function historyLines(result: SnippetHistoryResult): string[] {
  if (result.candidates.length === 0) {
    const read = result.sources.filter((s) => s.found).map((s) => s.shell);
    return [
      read.length
        ? `no commands to import from the ${read.join(", ")} history`
        : "no shell history found",
    ];
  }
  return result.candidates.map((c) => {
    const what =
      c.command === null
        ? `hidden: ${c.flagged.join(",")}`
        : [c.command, ...(c.flagged.length ? [`flagged: ${c.flagged.join(",")}`] : [])].join("  ");
    return [c.id, `${c.count}x`, c.shells.join(","), what].join("  ");
  });
}
