/**
 * The vault's public entry in the app (#1589, #1596): the usage rules of each secret, checked by the
 * connected hosts and sent again when a client's scope changes. Another domain imports from here,
 * never a file inside.
 */
export {
  type RulesConnection,
  type RulesHost,
  type RulesRefusal,
  type VaultRulesCore,
  VaultRulesSlice,
} from "./rules-store.ts";
