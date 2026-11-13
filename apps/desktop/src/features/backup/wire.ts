import type { AppKernel } from "../../lib/kernel.ts";
import type { Platform } from "../../platform/types.ts";
import type { BackupScheduler } from "./backup-scheduler.ts";
import { BackupSlice } from "./store.ts";

/**
 * Builds the backup slice from the store's kernel (#1596): the backup file is written, read and
 * restored here, through the platform; Google Drive is the scheduler's. The platform, the
 * scheduler and the vault's work factor stay the store's, as deps.
 */
export function wireBackup(
  kernel: AppKernel<object>,
  deps: {
    platform: Platform;
    scheduler: BackupScheduler;
    vaultWorkFactor: number | undefined;
    /** A restore writes the vault through its own instance: the store's vault forgets what it derived. */
    vaultRestored(): void;
  },
): BackupSlice {
  const { platform, scheduler, vaultWorkFactor, vaultRestored } = deps;
  return new BackupSlice({
    createText: async (passphrase, confirmation) => {
      const { createBackup } = await import("./backup-bundle.ts");
      return createBackup(platform, passphrase, confirmation, {
        ...(vaultWorkFactor !== undefined && { workFactor: vaultWorkFactor }),
      });
    },
    saveFile: (name, text) => platform.saveFile(name, text),
    pickFile: () => platform.vault.pickFile(),
    previewText: async (text, passphrase) => {
      const { previewRestore } = await import("./backup-bundle.ts");
      return previewRestore(platform, text, passphrase);
    },
    applyPreview: async (preview, onConflict) => {
      const { applyRestore } = await import("./backup-bundle.ts");
      try {
        return await applyRestore(platform, preview, onConflict);
      } finally {
        // Also after a refused or half-undone restore: what was derived may no longer match the keyring.
        vaultRestored();
      }
    },
    driveNames: () => scheduler.driveBackups(),
    driveText: (name) => scheduler.driveBackupText(name),
    fail: (error) => kernel.fail(error),
  });
}
