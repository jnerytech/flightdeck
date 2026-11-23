/**
 * The steps Settings > Backup's prints share (#4001, #4348): a backup taken, read back and restored
 * in the page. `keepSaves` keeps the file the save dialog would take, and `offerBackup` hands it to
 * the file input the Restore a backup form opens.
 */
import type { Page } from "playwright-core";
import { keepSaves, offerBackup } from "./save-file.ts";

/** Settings > Backup: the passphrase of a new backup, typed and repeated (#4001). */
export async function fillExport(page: Page): Promise<void> {
  const phrase = "a long enough passphrase";
  await page.getByLabel(/^(Passphrase|Frase-senha)$/).fill(phrase);
  await page.getByLabel(/^(Confirm passphrase|Confirmar frase-senha)$/).fill(phrase);
}

const BACKUP_PHRASE = "a long enough passphrase";
const READ = /^(Read backup|Ler backup)$/;
export const KEEP = /^(Keep what is here|Manter o que está aqui)$/;
export const RESTORE = /^(Restore|Restaurar)$/;

/**
 * Settings > Backup, with a backup of the demo's personas taken and then edited, so reading it back
 * finds one persona new here and one different (#4001). `keepSaves` keeps the file the save dialog
 * would take, and `offerBackup` hands it to the file input the Restore a backup form opens.
 */
export async function backedUpThenEdited(page: Page): Promise<void> {
  const personas = (list: Array<{ id: string; name: string }>) =>
    page.evaluate(
      `localStorage.setItem("flightdeck.personas", ${JSON.stringify(JSON.stringify(list))})`,
    );
  await page.evaluate(`(${keepSaves.toString()})(window)`);
  await page.evaluate(`(${offerBackup.toString()})(window)`);
  await personas([
    { id: "p-review", name: "Reviewer" },
    { id: "p-write", name: "Writer" },
  ]);
  await fillExport(page);
  await page.getByRole("button", { name: /^(Back up now|Fazer backup agora)$/ }).click();
  await page.getByText(/^(Backup saved|Backup salvo)/).waitFor();
  await personas([{ id: "p-review", name: "Reviewer (edited)" }]);
}

/** Types the file's passphrase and reads the backup: the preview shows with Keep chosen. */
export async function readBackup(page: Page, phrase = BACKUP_PHRASE): Promise<void> {
  await page.getByLabel(/^(File passphrase|Frase-senha do arquivo)$/).fill(phrase);
  await page.getByRole("button", { name: READ }).click();
}
