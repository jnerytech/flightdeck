/** Part of the print table (scripts/demo-shots.ts), in print order: Automations and Workflows (#3858). */
import type { Page } from "playwright-core";
import type { DemoIds } from "../../demo-seed.ts";
import { DEMO_HISTORY_AUTOMATION, DEMO_OFF_AUTOMATION } from "../demo/automations.ts";
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
      prepare: async (page) => {
        await formOpen(page);
        await next(page);
        await next(page);
        await page.getByRole("spinbutton").waitFor();
      },
    },
    {
      // Turning an automation on asks first, and names what it will do.
      name: "automacoes-ligar",
      route: automations,
      prepare: async (page) => {
        await listLoaded(page);
        await page
          .getByRole("switch", { name: new RegExp(`^(Turn on|Ligar) ${DEMO_OFF_AUTOMATION}$`) })
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
