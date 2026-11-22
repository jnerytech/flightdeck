/** Part of the print table (scripts/demo-shots.ts), in print order: Automations and Workflows (#3858). */
import type { Page } from "playwright-core";
import type { DemoIds } from "../../demo-seed.ts";
import {
  DEMO_AUTOMATIONS,
  DEMO_HISTORY_AUTOMATION,
  DEMO_OFF_AUTOMATION,
} from "../demo/automations.ts";
import { ALFA, type Shot } from "./shot.ts";

/** The seeded list is on screen: the print waits for the row of the automation that has a history. */
async function listLoaded(page: Page): Promise<void> {
  await page
    .getByRole("listitem", {
      name: new RegExp(`^(Automation|Automação) ${DEMO_HISTORY_AUTOMATION}$`),
    })
    .waitFor({ timeout: 15_000 });
}

/** The creation form, open on its trigger step with the list loaded behind it. */
async function formOpen(page: Page): Promise<void> {
  await listLoaded(page);
  await page.getByRole("button", { name: /^(New automation|Nova automação)$/ }).click();
  await page.getByRole("dialog").waitFor();
}

const next = (page: Page) => page.getByRole("button", { name: /^(Next|Próximo)$/ }).click();

/** The seeded automation that takes outside authors: turning it on asks with a warning. */
const EXTERNAL_AUTOMATION = DEMO_AUTOMATIONS.find((a) => a.allowExternalAuthors)?.name ?? "";

/** The button of a row, by what the row's name is in each language. */
const rowButton = (page: Page, en: string, pt: string, name: string) =>
  page.getByRole("button", { name: new RegExp(`^(${en}|${pt}) ${name}$`) });

/** Text on the page, in either language. */
const words = (page: Page, text: RegExp) => page.getByText(text);

/** The form on its last step: the trigger and the action are kept as they open, the limit is next. */
async function limitStep(page: Page): Promise<void> {
  await formOpen(page);
  await next(page);
  // The action step stays shut until the project's workflows have loaded.
  await page.getByRole("combobox", { name: /^(Workflow)$/ }).waitFor();
  await next(page);
  await page.getByRole("spinbutton").waitFor();
}

/** The form on its first step with the "new issue with a label" trigger and a label typed. */
async function labelTrigger(page: Page): Promise<void> {
  await formOpen(page);
  await page.getByRole("combobox", { name: /^(Trigger|Gatilho)$/ }).selectOption("issue_label");
  await page.getByRole("textbox", { name: /^(Label|Rótulo)$/ }).fill("bug");
}

export function automationShots(ids: DemoIds): Shot[] {
  const automations = {
    name: "automations" as const,
    host: ALFA,
    projectId: ids.project,
    projectName: ids.projectName,
  };
  return [
    // The list: one automation on with a history, one off, one off that takes outside authors.
    { name: "automacoes-lista", route: automations, prepare: listLoaded },
    {
      // The History of the automation that has firings, its list open under the row.
      name: "automacoes-historico",
      route: automations,
      prepare: async (page) => {
        await listLoaded(page);
        await page
          .getByRole("button", {
            name: new RegExp(`^(History of|Histórico de) ${DEMO_HISTORY_AUTOMATION}$`),
          })
          .click();
        await page
          .getByRole("list", {
            name: new RegExp(`^(Firings of|Disparos de) ${DEMO_HISTORY_AUTOMATION}$`),
          })
          .waitFor();
      },
    },
    // The form's three steps, one print each: the trigger, the action, then the limit.
    { name: "automacoes-gatilho", route: automations, prepare: formOpen },
    {
      name: "automacoes-acao",
      route: automations,
      prepare: async (page) => {
        await formOpen(page);
        await next(page);
        await page.getByRole("combobox", { name: /^(Action|Ação)$/ }).waitFor();
      },
    },
    {
      name: "automacoes-limite",
      route: automations,
      prepare: limitStep,
    },
    {
      // Turning an automation on asks first, and names what it will do.
      name: "automacoes-ligar",
      route: automations,
      prepare: async (page) => {
        await listLoaded(page);
        await page
          .getByRole("switch", {
            name: new RegExp(`^(Automation|Automação) ${DEMO_OFF_AUTOMATION}$`),
          })
          .click();
        await page.getByRole("alertdialog").waitFor();
      },
    },
    // #4190: the states the code has and no print showed. A change of the host's answer is a `wire` rule.
    {
      // A project with no automation: the empty text and the way to the first one.
      name: "automacoes-vazio",
      route: automations,
      wire: [{ command: "automation.list", data: { automations: [] } }],
      prepare: async (page) => {
        await words(
          page,
          /^(No automations in this project|Nenhuma automação neste projeto)$/,
        ).waitFor({
          timeout: 15_000,
        });
      },
    },
    {
      // The list did not load: the message and Try again.
      name: "automacoes-falhou",
      route: automations,
      wire: [{ command: "automation.list", refuse: "The automations could not be read." }],
      prepare: async (page) => {
        await page.getByRole("button", { name: /^(Try again|Tentar de novo)$/ }).waitFor({
          timeout: 15_000,
        });
      },
    },
    {
      // The host never answers the list, so the page stays loading.
      name: "automacoes-carregando",
      route: automations,
      wire: [{ command: "automation.list", hold: true }],
      prepare: async (page) => {
        await page
          .getByRole("status", { name: /^(Loading automations|Carregando automações)$/ })
          .waitFor({ timeout: 15_000 });
        // The placeholders are drawn 200 ms after the label: the print waits for the first one.
        await page.locator('[role="status"][aria-busy="true"] > *').first().waitFor();
      },
    },
    {
      // The History of an automation that never fired.
      name: "automacoes-historico-vazio",
      route: automations,
      prepare: async (page) => {
        await listLoaded(page);
        await rowButton(page, "History of", "Histórico de", DEMO_OFF_AUTOMATION).click();
        await words(page, /^(No firings yet|Nenhum disparo ainda)$/).waitFor();
      },
    },
    {
      // Delete asks first, and says the recorded firings go too.
      name: "automacoes-excluir",
      route: automations,
      prepare: async (page) => {
        await listLoaded(page);
        await rowButton(page, "Delete", "Excluir", DEMO_HISTORY_AUTOMATION).click();
        await page.getByRole("alertdialog").waitFor();
      },
    },
    {
      // Save on the last step with no name and a limit of 0: both fields say what is wrong.
      name: "automacoes-form-erros",
      route: automations,
      prepare: async (page) => {
        await limitStep(page);
        await page.getByRole("spinbutton").fill("0");
        await page.getByRole("button", { name: /^(Save|Salvar)$/ }).click();
        await words(page, /^(Give the automation a name\.|Dê um nome à automação\.)$/).waitFor();
      },
    },
    {
      // Editing an automation that is on: saving turns it off, and the form says so.
      name: "automacoes-editar",
      route: automations,
      prepare: async (page) => {
        await listLoaded(page);
        await rowButton(page, "Edit", "Editar", DEMO_HISTORY_AUTOMATION).click();
        await page.getByRole("dialog").waitFor();
        await next(page);
        await page.getByRole("combobox", { name: /^(Action|Ação)$/ }).waitFor();
        await next(page);
        await words(
          page,
          /^(Saving turns the automation off until you turn it on again|Salvar desliga a automação até você ligá-la de novo)$/,
        ).waitFor();
      },
    },
    {
      // The trigger "a new issue with a label" adds the label field.
      name: "automacoes-rotulo",
      route: automations,
      prepare: labelTrigger,
    },
    {
      // The project has no valid workflow: the action step says so instead of offering one.
      name: "automacoes-sem-workflows",
      route: automations,
      wire: [{ command: "workflow.list", data: { workflows: [] } }],
      prepare: async (page) => {
        await formOpen(page);
        await next(page);
        await words(
          page,
          /^(This project has no valid workflows|Este projeto não tem workflows válidos)$/,
        ).waitFor();
      },
    },
    {
      // A trigger that carries third-party text: the limit step offers the outside-authors switch, turned on.
      name: "automacoes-externos",
      route: automations,
      prepare: async (page) => {
        await labelTrigger(page);
        await next(page);
        await page.getByRole("combobox", { name: /^(Action|Ação)$/ }).waitFor();
        await next(page);
        const external = page.getByRole("switch", {
          name: /^(Also act on outside authors|Agir também sobre autores externos)$/,
        });
        await external.click();
        await page
          .getByRole("switch", {
            name: /^(Also act on outside authors|Agir também sobre autores externos)$/,
            checked: true,
          })
          .waitFor();
      },
    },
    {
      // Turning on an automation that takes outside authors: the confirmation adds its warning.
      name: "automacoes-ligar-externo",
      route: automations,
      prepare: async (page) => {
        await listLoaded(page);
        await page
          .getByRole("switch", {
            name: new RegExp(`^(Automation|Automação) ${EXTERNAL_AUTOMATION}$`),
          })
          .click();
        await page.getByRole("alertdialog").waitFor();
      },
    },
    {
      // The Workflows page itself (the templates dialog has its own print, workflows-modelos).
      name: "workflows",
      route: {
        name: "workflows",
        host: ALFA,
        projectId: ids.project,
        projectName: ids.projectName,
      },
      prepare: async (page) => {
        await page
          .getByRole("listitem", { name: /^Workflow feature$/ })
          .waitFor({ timeout: 15_000 });
      },
    },
  ];
}
