/**
 * The SSH side's public entry (#1589): the host's destinations, keys and askpass. Another
 * domain imports from here, never a file inside.
 */
export { runAskpass } from "./askpass.ts";
export type { SshSaveFields } from "./domain/ssh-save-view.ts";
export { runSshCli, type SshCliArgs } from "./ssh-cli.ts";
