/**
 * Part of the print table (scripts/demo-shots.ts): Settings > Backup when a step fails (#4348): a
 * restore that could not be written, a backup with nothing to restore, and a scheduled backup whose
 * old files could not be removed.
 */
import type { Page } from "playwright-core";
import type { DemoIds } from "../../demo-seed.ts";
import { backedUp, backedUpThenEdited, RESTORE, readBackup } from "./backup-steps.ts";
import { failFolderWrites } from "./folder-fail.ts";
import { type Shot, showSection } from "./shot.ts";

const RESTORE_FORM = /^(Restore a backup|Restaurar um backup)$/;
const SCHEDULE = /^(Scheduled backups|Backups agendados)$/;
const PERSONAS_KEY = "flightdeck.personas";
const FOLDER_KEY = "flightdeck.demoBackupFolder";
/** The name the app gives a backup, dated before the one the run saves. */
const OLD_BACKUP = "flightdeck-backup-20200101-000000.fdbackup";

/** Makes the page's storage refuse `key` after `allowed` writes of it. */
async function refuseWrites(page: Page, key: string, allowed: number): Promise<void> {
  await page.evaluate(
    `(${failFolderWrites.toString()})(window, ${JSON.stringify(key)}, ${allowed})`,
  );
}

export function backupFailShots(_ids: DemoIds): Shot[] {
  return [
    {
      // The personas cannot be written back (the storage refuses them): the restore says nothing changed.
      name: "configuracoes-backup-restaurar-falhou",
      route: { name: "settings", section: "backup" },
      prepare: async (page) => {
        await backedUpThenEdited(page);
        await readBackup(page);
        await refuseWrites(page, PERSONAS_KEY, 0);
        await page.getByRole("button", { name: RESTORE }).click();
        // The pointer stays over the button it clicked: its hover color is not what the print shows.
        await page.mouse.move(1000, 700);
        await page
          .getByText(
            /^(The restore failed and nothing was changed\.|A restauração falhou e nada foi alterado\.)$/,
          )
          .waitFor();
        await showSection(RESTORE_FORM)(page);
      },
    },
    {
      // The backup holds what is here already: Restore is off and says why.
      name: "configuracoes-backup-nada-a-restaurar",
      route: { name: "settings", section: "backup" },
      prepare: async (page) => {
        await backedUp(page);
        await readBackup(page);
        await page
          .getByText(
            /^(Nothing here is new\. Choose to replace a difference to restore it\.|Nada aqui é novo\. Escolha substituir uma diferença para restaurar\.)$/,
          )
          .waitFor();
        await showSection(RESTORE_FORM)(page);
      },
    },
    {
      // The run saves its backup, and the folder refuses the removal of the older one.
      name: "configuracoes-agenda-limpeza-falhou",
      route: { name: "settings", section: "backup" },
      query: { backupFolder: "demo" },
      prepare: async (page) => {
        await page.evaluate(
          `localStorage.setItem(${JSON.stringify(FOLDER_KEY)}, ${JSON.stringify(
            JSON.stringify({ chosen: false, files: { [OLD_BACKUP]: "an older backup" } }),
          )})`,
        );
        await page.getByRole("radio", { name: /^(Every day|Todo dia)$/ }).check();
        await page.getByRole("button", { name: /^(Choose folder|Escolher pasta)$/ }).click();
        await page.getByText("/demo/backups").first().waitFor();
        await refuseWrites(page, FOLDER_KEY, 1);
        await page.getByLabel(/^(Files to keep|Arquivos a manter)$/).fill("1");
        await page
          .getByLabel(/^(Passphrase for this session|Frase-senha desta sessão)$/)
          .fill("a long enough passphrase");
        await page.getByRole("button", { name: /^(Set passphrase|Definir frase-senha)$/ }).click();
        await page
          .getByText(
            /^(The backup was saved, but the old files could not be removed\.|O backup foi salvo, mas não deu para apagar os arquivos antigos\.)$/,
          )
          .waitFor({ timeout: 60_000 });
        await showSection(SCHEDULE)(page);
      },
    },
  ];
}
