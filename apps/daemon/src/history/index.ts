/**
 * The history domain's public entry (#1589): the conversations Claude Code already recorded,
 * indexed and read only, and what a person typed in a transcript's user turn, which the session
 * summary reads too. Another domain imports from here, never a file inside.
 */
export { HistoryIndexer } from "./indexer.ts";
export { promptText } from "./transcript-text.ts";
