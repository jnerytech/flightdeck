/**
 * The history's public entry in the app (#1589, #1596): the conversations Claude Code already
 * recorded, read from every host. Another domain imports from here, never a file inside.
 */
export {
  type GlobalHit,
  type HistoryCore,
  HistorySlice,
  type HistorySliceState,
  initialHistoryState,
  type SearchState,
} from "./store.ts";
export { wireHistory } from "./wire.ts";
