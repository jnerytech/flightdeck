/**
 * The actions' public entry (#1589): commands that use a vault secret without Claude seeing it, and
 * how such a command and its environment travel to a remote host over SSH. Another domain imports
 * from here, never a file inside.
 */

export type { Actions } from "./actions.ts";
export { runActionCli, runSnippetCli } from "./cli.ts";
export { envInput, remoteCommand } from "./ssh-command.ts";
