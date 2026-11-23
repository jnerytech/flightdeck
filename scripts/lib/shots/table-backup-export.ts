/**
 * Part of the print table (scripts/demo-shots.ts): Settings > Backup > Back up everything when the
 * backup is refused (#4348): the passphrases that differ, a passphrase that is too short, and a
 * backup over the size the app can read back.
 */
import type { Page } from "playwright-core";
import type { DemoIds } from "../../demo-seed.ts";
import { type Shot, showSection } from "./shot.ts";

const SECTION = /^(Back up everything|Backup de tudo)$/;
const PHRASE = "a long enough passphrase";
const FIELD = /^(Passphrase|Frase-senha)$/;
const CONFIRM = /^(Confirm passphrase|Confirmar frase-senha)$/;
const BACK_UP = /^(Back up now|Fazer backup agora)$/;

/** The personas of a backup too big to be restored later: one persona with a very long note. */
export function oversizedPersonas(): string {
  return JSON.stringify([{ id: "p-big", name: "Big persona", note: "x".repeat(1_100_000) }]);
}

/** Types the passphrase and its confirmation of the form. */
async function typeBoth(page: Page, passphrase: string, confirmation: string): Promise<void> {
  await page.getByLabel(FIELD).fill(passphrase);
  await page.getByLabel(CONFIRM).fill(confirmation);
}

function refusal(name: string, prepare: (page: Page) => Promise<void>): Shot {
  return {
    name,
    route: { name: "settings", section: "backup" },
    prepare: async (page) => {
      await prepare(page);
      await showSection(SECTION)(page);
    },
  };
}

/**
 * Clicks Back up now, then moves the pointer off it: it would stay over the button, and its hover
 * color is not the one the print and the contrast check should see.
 */
async function backUpNow(page: Page): Promise<void> {
  await page.getByRole("button", { name: BACK_UP }).click();
  await page.mouse.move(1000, 700);
}

export function backupExportShots(_ids: DemoIds): Shot[] {
  return [
    // The two passphrases are not the same: Back up now is on, and the click is refused.
    refusal("configuracoes-backup-erro-diferente", async (page) => {
      await typeBoth(page, PHRASE, "another long passphrase");
      await backUpNow(page);
      await page
        .getByText(/^(The passphrases do not match\.|As frases-senha não são iguais\.)$/)
        .waitFor();
    }),
    // Shorter than 12 characters: Back up now stays off and says what it needs.
    refusal("configuracoes-backup-erro-curta", async (page) => {
      await typeBoth(page, "too short", "too short");
      await page
        .getByText(
          /^(Type a passphrase of at least 12 characters and repeat it\.|Digite uma frase-senha de pelo menos 12 caracteres e repita-a\.)$/,
        )
        .waitFor();
    }),
    // A persona with more than 1 MiB of text: the backup would not be read back, so it is not saved.
    refusal("configuracoes-backup-erro-grande", async (page) => {
      await page.evaluate(
        `localStorage.setItem("flightdeck.personas", ${JSON.stringify(oversizedPersonas())})`,
      );
      await typeBoth(page, PHRASE, PHRASE);
      await backUpNow(page);
      await page
        .getByText(
          /^(This backup is too big to be restored later|Este backup é grande demais para ser restaurado depois)/,
        )
        .waitFor();
    }),
  ];
}
