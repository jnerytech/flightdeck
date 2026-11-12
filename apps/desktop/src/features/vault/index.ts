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
export { type VaultScanCore, VaultScanSlice } from "./scan-store.ts";
export { SecretPicker, type SecretPickerProps } from "./secret-picker.tsx";
export {
  type VaultFileFailure,
  type VaultSecretsCore,
  VaultSecretsSlice,
} from "./secrets-store.ts";
export { type SecretMeta, Vault } from "./vault.ts";
export type { VaultAnswer } from "./vault-approval.ts";
// `vault-backup.ts` is left out on purpose: it imports `age`, and the app store loads this index at
// start-up. `lib/backup-bundle.ts`, a lazy chunk, imports it from the file; only a type comes through here.
export type { ConflictChoice } from "./vault-backup.ts";
export {
  checkDelivery,
  type DeliveryRefusal,
  type VaultPolicy,
} from "./vault-requests.ts";
export { VaultRules } from "./vault-rules.ts";
export { type UsageEntry, VaultUsageLog } from "./vault-usage.ts";
export { wireVaultApprovals, wireVaultRules, wireVaultSecrets } from "./wire.ts";
