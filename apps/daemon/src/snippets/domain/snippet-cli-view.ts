/** Issue #3615: what `flightdeckd snippet` prints, as pure rules over the daemon's answers. */
import type {
  Snippet,
  SnippetFileInfo,
  SnippetHistoryResult,
  SnippetInput,
} from "@flightdeck/protocol";

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

/** A snippet the daemon saved. */
export const savedLine = (s: Snippet): string => `saved ${s.name}  ${s.type}  ${s.id}`;

/** A snippet's mark after `favorite`. */
export const favoriteLine = (s: Snippet): string =>
  `${s.name}  ${s.favorite ? "favorite" : "not a favorite"}`;

/** The project file the person trusted, and the hash of the content that was trusted. */
export const trustedLine = (info: SnippetFileInfo): string => `trusted ${info.path}  ${info.hash}`;

/** What an import made and what it left, or a sentence when it did neither. */
export function importedLines(result: Pick<SnippetHistoryResult, "created" | "skipped">): string[] {
  const lines = [
    ...result.created.map((s) => `imported ${s.name}  ${s.type}`),
    ...result.skipped.map((s) => `skipped ${s.id}  ${s.reason}`),
  ];
  return lines.length ? lines : ["nothing imported"];
}

/** What went into the terminal, and whether Enter ran it. */
export const usedLine = (terminalId: string, ran: boolean, text: string): string =>
  `${ran ? "ran in" : "typed into"} ${terminalId}  ${text}`;
