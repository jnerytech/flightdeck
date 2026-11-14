/**
 * The history's public entry in the app (#1589, #1596): the conversations Claude Code already
 * recorded, read from every host. Another domain imports from here, never a file inside. The
 * transcript reader component is in ui.ts (#2451).
 */
export {
  type GlobalHit,
  HISTORY_PAGE,
  type HistoryCore,
  type HistoryFilter,
  HistorySlice,
  type HistorySliceState,
  initialHistoryState,
  type ReaderTarget,
  type SearchState,
} from "./store.ts";
export { wireHistory } from "./wire.ts";
