/** Part of the print table (scripts/demo-shots.ts), in print order: the Activity board's states (#4244). */
import type { Page } from "playwright-core";
import type { DemoIds } from "../../demo-seed.ts";
import type { Shot } from "./shot.ts";

const WAIT = 8000;
const route = { name: "activity" } as const;

/** The Approve button of a request the card can take (not the hold button of a high risk). */
const approve = (page: Page) => page.getByRole("button", { name: /^(Approve|Aprovar) / }).first();

export function activityShots(_ids: DemoIds): Shot[] {
  return [
    {
      // A Needs you card with its request, Approve and Deny.
      name: "atividade-pedido",
      route,
      prepare: async (page) => {
        await approve(page).waitFor({ timeout: WAIT });
        await page
          .getByRole("button", { name: /^(Deny|Negar) / })
          .first()
          .waitFor();
      },
    },
    {
      // The terminal session that asks to run `rm -rf build` (#4203): Approve is the hold button.
      name: "atividade-alto-risco",
      route,
      prepare: async (page) => {
        await page
          .getByRole("button", { name: /^(Hold to approve|Segurar para aprovar) / })
          .first()
          .waitFor({ timeout: WAIT });
      },
    },
    {
      // Show idle sessions on: the Idle column comes in.
      name: "atividade-ociosas",
      route,
      prepare: async (page) => {
        await page
          .getByRole("checkbox", { name: /^(Show idle sessions|Mostrar sessões ociosas)$/ })
          .check();
        await page.getByRole("region", { name: /^(Idle|Ociosas)$/ }).waitFor({ timeout: WAIT });
      },
    },
    {
      // Filters that match nothing: the empty text and Clear filters.
      name: "atividade-filtro-vazio",
      route,
      prepare: async (page) => {
        await approve(page).waitFor({ timeout: WAIT });
        await page
          .getByRole("searchbox", { name: /^(Search sessions|Buscar sessões)$/ })
          .fill("no session has this name");
        await page
          .getByRole("button", { name: /^(Clear filters|Limpar filtros)$/ })
          .waitFor({ timeout: WAIT });
      },
    },
    {
      // The host refuses the Approve: the card says why and keeps its buttons.
      name: "atividade-resposta-falhou",
      route,
      wire: [
        {
          command: "permission.respond",
          reject: "The host could not take the answer: the request is not open here.",
        },
      ],
      prepare: async (page) => {
        await approve(page).click();
        await page
          .getByText(/^(Could not send the answer|Não foi possível enviar a resposta)/)
          .waitFor({ timeout: WAIT });
      },
    },
  ];
}
