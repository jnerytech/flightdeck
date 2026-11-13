import {
  type Attention,
  BackupScheduler,
  type BackupSlice,
  googleConfig,
  wireBackup,
} from "../../features/backup/index.ts";
import type { InboxSlice } from "../../features/inbox/index.ts";
import {
  Vault,
  type VaultApprovalsSlice,
  VaultRules,
  type VaultRulesSlice,
  VaultScanSlice,
  type VaultSecretsSlice,
  VaultUsageLog,
  wireVaultApprovals,
  wireVaultRules,
  wireVaultSecrets,
} from "../../features/vault/index.ts";
import type { Platform } from "../../platform/types.ts";
import type { AppState, AppStoreOptions } from "../app-state.ts";
import type { AppKernel } from "../kernel.ts";

/** The vault, what is asked of it, and the backups that carry it (#2376). */
export interface VaultSlices {
  /** Phase 16: the vault, whose values live in the system keyring. */
  readonly vault: Vault;
  /** The daemon's requests for a secret: the policy, the queue and the outcome listeners. */
  readonly vaultApprovals: VaultApprovalsSlice;
  /** The vault's secrets and their `.fdvault` file; `state.secrets` is the list the screens read. */
  readonly secrets: VaultSecretsSlice;
  /** What the app's log and the screens must never show: the hosts' tokens and the vault's values. */
  readonly scan: VaultScanSlice;
  /** Phase 19: each secret's usage rules, kept with the vault and handed to the hosts (#1596). */
  readonly vaultRules: VaultRulesSlice;
  /** Phase 16: what was asked of the vault, kept in `storage`. */
  readonly usage: VaultUsageLog;
  /** Issue #1264: scheduled backups to a picked folder (the desktop app only). */
  readonly backupScheduler: BackupScheduler;
  /** The whole-app backup file: save, read, compare and restore (#1596). */
  readonly backup: BackupSlice;
}

/** What the vault slices read from the rest of the store; each is read when a slice asks, so a slice built later is fine. */
interface VaultDeps {
  platform: Platform;
  /** The store's options: the vault's policy and work factor, and the Google backup config. */
  options: AppStoreOptions;
  /** The notification center (the bell). */
  notify: InboxSlice["notify"];
  /** Tells the state what the vault was asked, after the log changed. */
  keepUsage: () => void;
  /** Copies a text through the machine's clipboard slice. */
  copyText: (text: string) => Promise<boolean>;
  /** The project keys of a client, as the person assigned them. */
  projectKeysOf: (clientId: string) => string[];
}

/**
 * Builds the vault slices. Every slice is built through its own domain's entry; the store keeps
 * only what it owns (#2376).
 */
export function composeVault(kernel: AppKernel<AppState>, deps: VaultDeps): VaultSlices {
  const { platform, options } = deps;
  const vault = new Vault(platform);
  const usage = new VaultUsageLog(platform);
  const backupScheduler = new BackupScheduler(platform, {
    // Issue #1327: a scheduled backup that cannot go reaches the bell, and a click opens its settings.
    onAttention: (kind: Attention) => {
      const t = kernel.t();
      deps.notify(
        {
          title: t(`backupSchedule.attention.${kind}.title`),
          body: t(`backupSchedule.attention.${kind}.body`),
        },
        { name: "settings", section: "backup" },
      );
    },
    google: options.google ?? { config: googleConfig() },
    ...(options.vaultWorkFactor !== undefined && { workFactor: options.vaultWorkFactor }),
  });
  return {
    vault,
    usage,
    backupScheduler,
    vaultApprovals: wireVaultApprovals(kernel, {
      vault,
      optionsPolicy: () => options.vaultPolicy,
      notify: (title, body) => deps.notify({ title, body, event: "needs-you" }),
      recorded: (outcome) => {
        usage.recordOutcome(outcome);
        deps.keepUsage();
      },
    }),
    secrets: wireVaultSecrets(kernel, {
      vault,
      workFactor: () => options.vaultWorkFactor,
      saveFile: (name, text) => platform.saveFile(name, text),
      pickFile: () => platform.vault.pickFile(),
      fail: (error) => kernel.fail(error),
      copyText: deps.copyText,
      clearClipboardIn: (ms) => {
        setTimeout(() => void platform.copyText("").catch(() => {}), ms);
      },
    }),
    scan: new VaultScanSlice({ vault }),
    vaultRules: wireVaultRules(kernel, {
      rules: new VaultRules(platform.storage),
      secrets: () => vault.list(),
      clients: () => kernel.state().clientList,
      projectKeysOf: deps.projectKeysOf,
      fail: (error, text) => kernel.fail(error, text),
      success: (text) => kernel.success(text),
    }),
    backup: wireBackup(kernel, {
      platform,
      scheduler: backupScheduler,
      vaultWorkFactor: options.vaultWorkFactor,
    }),
  };
}
