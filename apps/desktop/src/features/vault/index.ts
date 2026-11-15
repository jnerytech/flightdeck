/**
 * The vault's public entry in the app (#1589, #1596): the secrets (create, edit, remove, the
 * `.fdvault` file) and their usage rules, checked by the connected hosts and sent again when a
 * client's scope changes. Another domain imports from here, never a file inside. The secret
 * picker component is in ui.ts (#2451).
 */
export {
  type VaultApprovalsCore,
  VaultApprovalsSlice,
} from "./approvals-store.ts";
export { BackupError, type BackupErrorCode } from "./domain/backup-error.ts";
// `vault-backup.ts` is left out on purpose: it imports `age`, and the app store loads this index at
// start-up. `features/backup/backup-bundle.ts`, a lazy chunk, imports it from the file; only a type comes through here.
export type { ConflictChoice } from "./domain/vault-backup.ts";
export type { DeliveryRefusal } from "./domain/vault-delivery.ts";
export type { VaultPolicy } from "./domain/vault-requests.ts";
export {
  type VaultRulesCore,
  VaultRulesSlice,
} from "./rules-store.ts";
export { VaultScanSlice } from "./scan-store.ts";
export {
  type VaultSecretsCore,
  VaultSecretsSlice,
} from "./secrets-store.ts";
export { type SecretMeta, Vault } from "./vault.ts";
export { VaultRules } from "./vault-rules.ts";
export { type UsageEntry, VaultUsageLog } from "./vault-usage.ts";
export { wireVaultApprovals, wireVaultRules, wireVaultSecrets } from "./wire.ts";
