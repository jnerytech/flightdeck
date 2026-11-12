/**
 * The issues domain's public entry (#1589). It exports, for now, only the issues service, as the
 * automations' wiring builds it; the rest of the domain moves behind this entry with the remaining
 * deep imports. Another domain imports from here.
 */

export { Issues } from "./issues.ts";
