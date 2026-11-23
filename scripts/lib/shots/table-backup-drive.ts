/**
 * Part of the print table (scripts/demo-shots.ts): Settings > Backup where Google Drive is a choice
 * (#4348). The demo's address gives the page a Google client and a fake Google (`?google=`), so the
 * prints reach the Drive states the other backup prints cannot: nothing real is called.
 */
import type { Page } from "playwright-core";
import type { DemoIds } from "../../demo-seed.ts";
import { type Shot, showSection } from "./shot.ts";

const IMPORT = /^(Restore a backup|Restaurar um backup)$/;
const DRIVE = /^Google Drive$/;

/** Signs in through Scheduled backups: Google Drive as the target, then Sign in with Google. */
async function signedIn(page: Page): Promise<void> {
  const target = page.getByRole("group", { name: /^(Where to save|Onde salvar)$/ });
  await target.getByRole("radio", { name: DRIVE }).check();
  await page.getByRole("button", { name: /^(Sign in with Google|Entrar com o Google)$/ }).click();
  await page.getByText(/^(Signed in to Google|Conectado ao Google)$/).waitFor();
}

/** Restore a backup: Google Drive chosen as the source. */
async function fromDrive(page: Page): Promise<void> {
  await page
    .getByRole("group", { name: /^(Restore from|Restaurar de)$/ })
    .getByRole("radio", { name: DRIVE })
    .check();
}

const LOOK = /^(Look in Google Drive|Procurar no Google Drive)$/;

/** Signed in, Drive chosen and looked in: the Drive's answer is on the panel. */
async function lookedIn(page: Page): Promise<void> {
  await signedIn(page);
  await fromDrive(page);
  await page.getByRole("button", { name: LOOK }).click();
}

/** One print of the Restore a backup panel; `then` brings its state up before the panel is shown. */
function restorePrint(
  name: string,
  google: string,
  then: (page: Page) => Promise<void> = async () => {},
  waitFor?: RegExp,
): Shot {
  return {
    name,
    route: { name: "settings", section: "backup" },
    query: { google },
    prepare: async (page) => {
      await then(page);
      if (waitFor) await page.getByText(waitFor).waitFor();
      await showSection(IMPORT)(page);
    },
  };
}

export function backupDriveShots(_ids: DemoIds): Shot[] {
  return [
    // #4348: the choice of where the backup comes from, with Drive offered and a file chosen.
    restorePrint("configuracoes-restaurar-fonte", "files"),
    // Drive chosen while Google is signed out: the line that says to sign in first, and no lookup.
    restorePrint(
      "configuracoes-restaurar-drive-entrar",
      "files",
      fromDrive,
      /^(Sign in to Google under|Entre no Google primeiro)/,
    ),
    // Signed in and looked in: the backups on Drive, newest first.
    restorePrint(
      "configuracoes-restaurar-drive-lista",
      "files",
      lookedIn,
      /^flightdeck-backup-20261122-060000\.fdbackup$/,
    ),
    restorePrint(
      "configuracoes-restaurar-drive-vazio",
      "empty",
      lookedIn,
      /^(No backups on Google Drive yet|Ainda não há backups no Google Drive)/,
    ),
    // Google revoked the sign-in: Drive refuses twice and the panel says to sign in again.
    restorePrint(
      "configuracoes-restaurar-drive-auth",
      "revoked",
      lookedIn,
      /^(Google Drive does not accept|O Google Drive não aceita)/,
    ),
    // Drive answers with a server error: the panel says it could not be read.
    restorePrint(
      "configuracoes-restaurar-drive-falhou",
      "down",
      lookedIn,
      /^(Google Drive could not be read|Não foi possível ler o Google Drive)/,
    ),
  ];
}
