/**
 * The board domain's public entry (#1589). It exports, for now, only the board's type, as the
 * automations' wiring takes it; the rest of the domain moves behind this entry with the remaining
 * deep imports. Another domain imports from here.
 */

export type { Board } from "./board.ts";
