/**
 * The workflows domain's public entry (#1589). It exports, for now, the `{{ expression }}`
 * references a card's steps and the run env's configs share (#1594); the rest of the domain moves
 * behind this entry with the remaining deep imports. Another domain imports from here.
 */

export { referencesIn, replaceReferences } from "./references.ts";
