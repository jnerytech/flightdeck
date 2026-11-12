/**
 * The history's public entry in the app (#1589, #1596): the conversations Claude Code already
 * recorded, read from every host. Another domain imports from here, never a file inside.
 */
export {
  type GlobalHit,
  HISTORY_LIST_LIMIT,
  HISTORY_PAGE,
  type HistoryCore,
  type HistoryFilter,
  HistorySlice,
  type HistorySliceState,
  initialHistoryState,
  type SearchState,
} from "./store.ts";
export { type ReaderTarget, TranscriptReader } from "./transcript-reader.tsx";
export { wireHistory } from "./wire.ts";
