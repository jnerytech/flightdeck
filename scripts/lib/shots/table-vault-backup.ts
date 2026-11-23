/**
 * Part of the print table (scripts/demo-shots.ts): the Vault's Backup tab (#4348): the exported
 * message, the import preview, a wrong passphrase, the Replace dialog and the result line.
 * The web build keeps secrets in memory, so each print stores its own, exports them through the
 * kept save (`keepSaves`), edits one, and reads the file back through the file offer (`offerBackup`).
 */
import type { Page } from "playwright-core";
import type { DemoIds } from "../../demo-seed.ts";
import { keepFiles } from "./backup-steps.ts";
import { type Shot, showSection } from "./shot.ts";

const PHRASE = "a long enough passphrase";
const EXPORT_SECTION = /^(Export vault|Exportar cofre)$/;
const IMPORT_SECTION = /^(Import vault|Importar cofre)$/;

/** The pointer leaves the button it clicked: its hover color is not what the contrast check should see. */
const awayFromButtons = (page: Page) => page.mouse.move(1000, 700);

async function store(page: Page, name: string, value: string): Promise<void> {
  await page.getByRole("button", { name: /^(New secret|Novo segredo)$/ }).click();
  await page.getByLabel(/^(Name|Nome)$/).fill(name);
  await page.getByLabel(/^(Value|Valor)$/).fill(value);
  await page.getByRole("button", { name: /^(Save|Guardar)$/ }).click();
  await page.getByRole("button", { name: new RegExp(`^(Edit|Editar) ${name}$`) }).waitFor();
}

/** Secrets stored and exported: the file the save dialog would take is kept in the page. */
async function exported(page: Page, secrets: Array<[name: string, value: string]>): Promise<void> {
  await keepFiles(page);
  for (const [name, value] of secrets) await store(page, name, value);
  await page.getByRole("tab", { name: "Backup" }).click();
  await page.getByLabel(/^(Passphrase|Frase-senha)$/).fill(PHRASE);
  await page.getByLabel(/^(Confirm passphrase|Confirmar frase-senha)$/).fill(PHRASE);
  await page.getByRole("button", { name: /^(Export vault|Exportar cofre)$/ }).click();
  await awayFromButtons(page);
  await page
    .getByText(/^(Vault saved as cofre\.fdvault|Cofre salvo como cofre\.fdvault)/)
    .waitFor();
}

/** One secret edited after the export, so reading the file back finds it different. */
async function editedAfterExport(page: Page): Promise<void> {
  await exported(page, [
    ["demo-token", "demo-not-a-real-token"],
    ["demo-other", "demo-other-value"],
  ]);
  await page.getByRole("tab", { name: /^(Secrets|Segredos)$/ }).click();
  await page.getByRole("button", { name: /^(Edit|Editar) demo-other$/ }).click();
  await page.getByLabel(/^(Description|Descrição)$/).fill("changed after the backup");
  const save = page.getByRole("button", { name: /^(Save changes|Salvar alterações)$/ });
  await save.click();
  await awayFromButtons(page);
  await save.waitFor({ state: "hidden" });
  await page.getByRole("tab", { name: "Backup" }).click();
}

/** Types the file's passphrase and reads the file: the preview, or the refusal, shows. */
async function readFile(page: Page, phrase: string, shown: RegExp): Promise<void> {
  await page.getByLabel(/^(File passphrase|Frase-senha do arquivo)$/).fill(phrase);
  await page.getByRole("button", { name: /^(Import vault|Importar cofre)$/ }).click();
  await awayFromButtons(page);
  await page.getByText(shown).waitFor();
}

const previewed = (page: Page) => readFile(page, PHRASE, /^(Conflicting|Conflitantes): 1$/);

/** The preview with Replace chosen and Apply clicked: the dialog asks before anything is lost. */
async function replaceAsked(page: Page): Promise<void> {
  await editedAfterExport(page);
  await previewed(page);
  await page
    .getByRole("radio", { name: /^(Replace with the backup|Substituir pelo backup)$/ })
    .check();
  await page.getByRole("button", { name: /^(Apply|Aplicar)$/ }).click();
  await awayFromButtons(page);
  await page.getByRole("alertdialog").waitFor();
}

export function vaultBackupShots(_ids: DemoIds): Shot[] {
  return [
    {
      name: "cofre-backup-exportado",
      route: { name: "vault" },
      prepare: async (page) => {
        await exported(page, [["demo-token", "demo-not-a-real-token"]]);
        await showSection(EXPORT_SECTION)(page);
      },
    },
    {
      name: "cofre-backup-previa",
      route: { name: "vault" },
      prepare: async (page) => {
        await editedAfterExport(page);
        await previewed(page);
        await showSection(IMPORT_SECTION)(page);
      },
    },
    {
      name: "cofre-backup-frase-errada",
      route: { name: "vault" },
      prepare: async (page) => {
        await editedAfterExport(page);
        await readFile(
          page,
          "not the passphrase at all",
          /^(The file could not be read\.|Não foi possível ler o arquivo\.)/,
        );
        await showSection(IMPORT_SECTION)(page);
      },
    },
    { name: "cofre-backup-substituir", route: { name: "vault" }, prepare: replaceAsked },
    {
      name: "cofre-backup-resultado",
      route: { name: "vault" },
      prepare: async (page) => {
        await replaceAsked(page);
        await page.getByRole("button", { name: /^(Replace secrets|Substituir segredos)$/ }).click();
        await awayFromButtons(page);
        await page
          .getByText(
            /^(Added: 0, replaced: 1, kept: 0\.|Adicionados: 0, substituídos: 1, mantidos: 0\.)/,
          )
          .waitFor();
        await showSection(IMPORT_SECTION)(page);
      },
    },
  ];
}
