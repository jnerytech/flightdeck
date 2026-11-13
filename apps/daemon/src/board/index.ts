/**
 * The board domain's public entry (#1589). It exports, for now, the board's type, as the
 * automations' wiring takes it, the spec reader the card review uses, the `flightdeckd card`
 * command (#1507) and the file reads and writes inside a project folder, never through a link,
 * that the harness shares (#75, #78); the rest of the domain moves behind this entry with the remaining deep imports. Another domain
 * imports from here.
 */

export type { Board } from "./board.ts";
export { runCardCli } from "./card-cli.ts";
export { createInside, readInside, type Walk, walkInside } from "./create-inside.ts";
export { readSpecText } from "./spec.ts";
