/** Issue #3623: what `flightdeckd knowledge` prints, as pure functions of what the daemon answered. */
import type {
  KnowledgeEntry,
  KnowledgeFeedState,
  KnowledgeIndexResult,
  KnowledgeListResult,
} from "@flightdeck/protocol";

/** A document with every key a script reads: what an older daemon leaves out is `null` or empty. */
export const entryJson = (entry: KnowledgeEntry) => ({
  ...entry,
  type: entry.type ?? null,
  supersedes: entry.supersedes ?? null,
  problems: entry.problems ?? [],
  warnings: entry.warnings ?? [],
  hash: entry.hash ?? null,
});

export const listJson = (list: KnowledgeListResult) => ({
  entries: list.entries.map(entryJson),
  truncated: list.truncated === true,
});

/** What a flagged document adds to its line: the document it replaces, what is wrong with it, what to look at. */
const notes = (entry: KnowledgeEntry): string[] => [
  ...(entry.supersedes ? [`supersedes ${entry.supersedes}`] : []),
  ...(entry.problems?.length ? [`problems ${entry.problems.join(", ")}`] : []),
  ...(entry.warnings?.length ? [`warnings ${entry.warnings.join(", ")}`] : []),
];

/** A document as one line: path, status, type, title and the hash `set-status` takes, then its notes. */
const entryLine = (entry: KnowledgeEntry): string =>
  [entry.path, entry.status, entry.type ?? "-", entry.title, entry.hash ?? "", ...notes(entry)]
    .filter((field) => field !== "")
    .join("  ");

/** A document the daemon wrote or changed, as `list` prints it. */
export const entryLines = (entry: KnowledgeEntry): string[] => [entryLine(entry)];

export const listLines = (list: KnowledgeListResult): string[] =>
  list.entries.length === 0 && !list.truncated
    ? ["no knowledge documents"]
    : [
        ...list.entries.map(entryLine),
        ...(list.truncated ? ["more documents than this list holds"] : []),
      ];

export const indexJson = (index: KnowledgeIndexResult) => ({
  text: index.text,
  fed: index.fed,
  truncated: index.truncated === true,
});

/** The Markdown a session is given, line by line, as the daemon wrote it. */
export const indexLines = (index: KnowledgeIndexResult): string[] =>
  index.text.trim() === ""
    ? ["no document is given to sessions"]
    : index.text.trimEnd().split(/\r?\n/u);

export const feedJson = (feed: KnowledgeFeedState) => ({
  on: feed.on,
  trusted: feed.trusted,
  offBy: feed.offBy ?? null,
  own: feed.own === true,
});

/** On or off, and why it is off or not given: the folder that switches it off, or an untrusted project. */
export function feedLines(feed: KnowledgeFeedState): string[] {
  if (feed.on)
    return [
      feed.trusted
        ? "on"
        : "on  but the project is not trusted, so sessions are not given the index",
    ];
  if (feed.offBy === null || feed.offBy === undefined) return ["off"];
  return [
    `off  switched off for ${feed.offBy} (${feed.own ? "the project itself" : "a folder above the project"})`,
  ];
}

/** What a write that got no answer may have done: the next step is to look, not to repeat it. */
export const unsure = (action: string): string =>
  `; the change may or may not have gone in: check with \`knowledge ${action === "set-feed" ? "feed" : "list"}\` before trying again`;
