/**
 * The actions' public entry (#1589): commands that use a vault secret without Claude seeing it. Another
 * domain imports from here, never a file inside.
 */

export { Actions, type ActionsOptions } from "./actions.ts";
export { runActionCli, runSnippetCli } from "./cli.ts";
