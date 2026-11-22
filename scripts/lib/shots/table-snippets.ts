/** Part of the print table (scripts/demo-shots.ts), in print order: the Snippets screen (#3973). */
import type { Page } from "playwright-core";
import type { DemoIds } from "../../demo-seed.ts";
import { DEMO_EDIT_PROMPT, DEMO_IMPORT_FILE, DEMO_USE_COMMAND } from "../demo/snippets.ts";
import type { Shot } from "./shot.ts";

const snippets = { name: "snippets" as const };

/** The seeded list is on screen: the print waits for the row of the command the use dialog opens. */
async function listLoaded(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: new RegExp(`^(Use|Usar) ${DEMO_USE_COMMAND}$`) })
    .waitFor({ timeout: 15_000 });
}

export function snippetShots(ids: DemoIds): Shot[] {
  return [
    // The list: commands and prompts, a favorite first, with their tags and where each one lives.
    { name: "snippets-lista", route: snippets, prepare: listLoaded },
    {
      // The editor, open on a prompt with a field.
      name: "snippets-editor",
      route: snippets,
      prepare: async (page) => {
        await listLoaded(page);
        await page
          .getByRole("button", { name: new RegExp(`^(Edit|Editar) ${DEMO_EDIT_PROMPT}$`) })
          .click();
        await page.getByRole("textbox", { name: /^(Name|Nome)$/ }).waitFor();
      },
    },
    {
      // The use dialog of a command, with its field to fill and its default.
      name: "snippets-usar",
      route: snippets,
      prepare: async (page) => {
        await listLoaded(page);
        await page
          .getByRole("button", { name: new RegExp(`^(Use|Usar) ${DEMO_USE_COMMAND}$`) })
          .click();
        await page.getByRole("dialog").waitFor();
      },
    },
    {
      // A project picked: its versioned file's notice (trusted) and the file's snippets.
      name: "snippets-projeto",
      route: snippets,
      prepare: async (page) => {
        await listLoaded(page);
        await page.getByLabel(/^(Project|Projeto)$/).selectOption({ label: ids.projectName });
        await page
          .getByText(/^(Trusted|Confiável):/)
          .first()
          .waitFor();
      },
    },
    {
      // Import from the shell history: the commands the host's shell ran most.
      name: "snippets-historico",
      route: snippets,
      prepare: async (page) => {
        await listLoaded(page);
        await page
          .getByRole("button", {
            name: /^(Import from the shell history|Importar do histórico do shell)$/,
          })
          .click();
        await page.getByRole("list", { name: /^(Shell history|Histórico do shell)$/ }).waitFor();
      },
    },
    {
      // Import from a file: the one picked, and the snippets found in it.
      name: "snippets-arquivo",
      route: snippets,
      prepare: async (page) => {
        await listLoaded(page);
        await page
          .getByRole("button", { name: /^(Import from a file|Importar de arquivo)$/ })
          .click();
        await page.getByLabel(/^(Snippets file|Arquivo de snippets)/).setInputFiles({
          name: "snippets.yaml",
          mimeType: "text/yaml",
          buffer: Buffer.from(DEMO_IMPORT_FILE),
        });
        await page
          .getByRole("list", { name: /^(Snippets in the file|Snippets do arquivo)$/ })
          .waitFor();
      },
    },
  ];
}
