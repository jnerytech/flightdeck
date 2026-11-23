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

const TARGET = /^(Where to save|Onde salvar)$/;
const SIGN_IN = /^(Sign in with Google|Entrar com o Google)$/;

/** Scheduled backups: Google Drive picked as the target, nothing signed in yet. */
async function driveTarget(page: Page): Promise<void> {
  await page.getByRole("group", { name: TARGET }).getByRole("radio", { name: DRIVE }).check();
}

/** Signs in through Scheduled backups: Google Drive as the target, then Sign in with Google. */
async function signedIn(page: Page): Promise<void> {
  await driveTarget(page);
  await page.getByRole("button", { name: SIGN_IN }).click();
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
    // #4348: the choice of where the backup comes from, with Drive offered and the file source selected.
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

const SCHEDULE = /^(Scheduled backups|Backups agendados)$/;
/** One print of the Scheduled backups panel; `then` brings its state up before the panel is shown. */
function schedulePrint(
  name: string,
  google: string | undefined,
  then: (page: Page) => Promise<void>,
  waitFor: RegExp,
): Shot {
  return {
    name,
    route: { name: "settings", section: "backup" },
    ...(google && { query: { google } }),
    prepare: async (page) => {
      await then(page);
      await page.getByText(waitFor).waitFor();
      await showSection(SCHEDULE)(page);
    },
  };
}

/** Settings > Backup > Scheduled backups with Google Drive as the target, in its states (#4348). */
export function backupScheduleShots(_ids: DemoIds): Shot[] {
  return [
    // #4348: Drive chosen, nobody signed in: the status and the sign-in button.
    schedulePrint(
      "configuracoes-agendado-drive-saida",
      "files",
      driveTarget,
      /^(Not signed in to Google|Não conectado ao Google)$/,
    ),
    // #4348: signed in: the status and Sign out.
    schedulePrint(
      "configuracoes-agendado-drive-conectado",
      "files",
      signedIn,
      /^(Signed in to Google|Conectado ao Google)$/,
    ),
    // #4348: Google refuses the sign-in: the warning stays under the button.
    schedulePrint(
      "configuracoes-agendado-drive-recusado",
      "refused",
      async (page) => {
        await driveTarget(page);
        await page.getByRole("button", { name: SIGN_IN }).click();
      },
      /^(Google did not accept the sign-in\. Try again\.|O Google não aceitou a entrada\. Tente de novo\.)$/,
    ),
    // #4348: every day, with the passphrase set and Drive not signed in: the next backup waits for the sign-in.
    schedulePrint(
      "configuracoes-agendado-drive-aguardando",
      "files",
      async (page) => {
        await driveTarget(page);
        await page.getByRole("radio", { name: /^(Every day|Todo dia)$/ }).check();
        await page
          .getByLabel(/^(Passphrase for this session|Frase-senha desta sessão)$/)
          .fill("a long enough passphrase");
        await page.getByRole("button", { name: /^(Set passphrase|Definir frase-senha)$/ }).click();
      },
      /^(Next backup: waiting for you to sign in to Google Drive\.|Próximo backup: aguardando você entrar no Google Drive\.)$/,
    ),
    // #4348: a Keep number that is not a whole number from 1: the saved number stays and the field says so.
    schedulePrint(
      "configuracoes-agendado-manter-invalido",
      undefined,
      async (page) => {
        await page.getByLabel(/^(Files to keep|Arquivos a manter)$/).fill("0");
      },
      /^(Type a whole number from 1\.|Digite um número inteiro a partir de 1\.)/,
    ),
  ];
}
