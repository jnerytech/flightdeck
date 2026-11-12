/**
 * The board domain's public entry (#1589). It exports, for now, the board's type, as the
 * automations' wiring takes it, the spec reader the card review uses and the `flightdeckd card`
 * command (#1507); the rest of the domain moves behind this entry with the remaining deep imports.
 * Another domain imports from here.
 */

export type { Board } from "./board.ts";
export { runCardCli } from "./card-cli.ts";
export { readSpecText } from "./spec.ts";
