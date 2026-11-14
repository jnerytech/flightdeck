/**
 * The issues domain's public entry (#1589): the issues service the automations' wiring builds, and
 * the issue references and remotes a card's pull request names. Another domain imports from here,
 * never a file inside.
 */

export { closingLine } from "./domain/issue-ref.ts";
export { Issues } from "./issues.ts";
export { azureCoords } from "./remote.ts";
