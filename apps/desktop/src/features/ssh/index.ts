/**
 * The ssh's public entry in the app (#1589, #1596): the destinos of the hosts, the prompts ssh
 * raises and the terminals opened from a destino. Another domain imports from here, never a file
 * inside.
 */
export { isProd, savePayload } from "./domain/ssh.ts";
export { initialSshState, type SshCore, SshSlice, type SshSliceState } from "./store.ts";
export { wireSsh } from "./wire.ts";
