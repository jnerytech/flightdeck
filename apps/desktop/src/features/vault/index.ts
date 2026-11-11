/**
 * The vault's public entry in the app (#1589, #1596): the secrets (create, edit, remove, the
 * `.fdvault` file) and their usage rules, checked by the connected hosts and sent again when a
 * client's scope changes. Another domain imports from here, never a file inside.
 */
export {
  type ApprovalHost,
  type VaultApprovalsCore,
  VaultApprovalsSlice,
} from "./approvals-store.ts";
export {
  type RulesConnection,
  type RulesHost,
  type RulesRefusal,
  type VaultRulesCore,
  VaultRulesSlice,
} from "./rules-store.ts";
export {
  type VaultFileFailure,
  type VaultSecretsCore,
  VaultSecretsSlice,
} from "./secrets-store.ts";
