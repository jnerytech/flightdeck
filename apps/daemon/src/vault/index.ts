/**
 * The vault's public entry (#1589): the secrets the app hands over for one use, and the rules of
 * who may use which. Another domain imports from here, never a file inside.
 */
export { VaultRules } from "./rules-store.ts";
export { Vault, vaultActions } from "./vault.ts";
