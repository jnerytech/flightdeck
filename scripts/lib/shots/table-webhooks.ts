/** Part of the print table (scripts/demo-shots.ts), in print order: Settings > Notifications > Webhooks (#4405). */

import type { Page } from "playwright-core";
import type { DemoIds } from "../../demo-seed.ts";
import type { Shot } from "./shot.ts";

/**
 * The section keeps its list in the page's storage (`webhooks: true` seeds three rows) and the address of each
 * in memory. A row seeded that way has no address, so its test could not post: the two test prints add their
 * own webhook in the page, and the post is answered there too (`webhook.send`), so no host ever gets one.
 */
const ADD_FORM = /^(Add webhook|Adicionar webhook)$/;
const LIST_NAME = "Platform team Slack";
const FAILING_NAME = "Phone alerts";
/** The webhook a test print adds in the page: not the name of a seeded row, so the Test button is the only one. */
const ADDED_NAME = "Deploy alerts";
const SENT = { status: 200, retryAfterMs: null, refused: null };

/** The Add form, once the section has drawn. */
const addFormShown = async (page: Page): Promise<void> => {
  await page.getByRole("heading", { name: ADD_FORM }).waitFor();
};

/** The section with its three seeded rows. */
const listed = async (page: Page): Promise<void> => {
  await addFormShown(page);
  await page.getByText(LIST_NAME, { exact: true }).waitFor();
};

/** A webhook added in the page and its test pressed: the line under the row is the print. */
function testedAs(result: RegExp): NonNullable<Shot["prepare"]> {
  return async (page) => {
    await addFormShown(page);
    const form = page.getByRole("form", { name: ADD_FORM });
    await form.getByLabel(/^(Name|Nome)$/).fill(ADDED_NAME);
    await form
      .getByLabel(/^(Webhook URL|URL do webhook)$/)
      .fill("https://hooks.example.test/T000/B000");
    await form.getByLabel(/^(Needs you|Precisa de você)$/).check();
    await form.getByRole("button", { name: /^(Save webhook|Salvar webhook)$/ }).click();
    await page.getByText(ADDED_NAME, { exact: true }).waitFor();
    await page.getByRole("button", { name: new RegExp(`^(Test|Testar) ${ADDED_NAME}$`) }).click();
    await page.getByText(result).waitFor();
  };
}

export function webhooksShots(_ids: DemoIds): Shot[] {
  const route = { name: "settings", section: "webhooks" } as const;
  return [
    {
      name: "webhooks-vazio",
      route,
      prepare: async (page) => {
        await addFormShown(page);
        await page.getByText(/^(No webhook yet\.|Nenhum webhook ainda\.)$/).waitFor();
      },
    },
    { name: "webhooks-lista", route, webhooks: true, prepare: listed },
    {
      name: "webhooks-ntfy",
      route,
      prepare: async (page) => {
        await addFormShown(page);
        await page.getByLabel(/^(Type|Tipo)$/).selectOption("ntfy");
        await page.getByText(/^(Like https:\/\/ntfy\.sh|Como https:\/\/ntfy\.sh)/).waitFor();
      },
    },
    {
      name: "webhooks-editar",
      route,
      webhooks: true,
      prepare: async (page) => {
        await listed(page);
        await page
          .getByRole("button", { name: new RegExp(`^(Edit|Editar) ${LIST_NAME}$`) })
          .click();
        await page
          .getByText(/^(Leave empty to keep the current URL|Deixe vazio para manter a URL atual)$/)
          .waitFor();
      },
    },
    {
      name: "webhooks-teste-ok",
      route,
      wire: [{ command: "webhook.send", reply: SENT }],
      prepare: testedAs(/^(Sent|Enviado): HTTP 200/),
    },
    {
      name: "webhooks-teste-falhou",
      route,
      wire: [{ command: "webhook.send", reject: "The host could not post." }],
      prepare: testedAs(/^(Failed|Falhou): (no answer|sem resposta)/),
    },
    {
      name: "webhooks-sem-host",
      route,
      webhooks: true,
      wire: [{ command: "host.info", without: { features: ["webhook"] } }],
      prepare: async (page) => {
        await listed(page);
        await page
          .getByText(/^(No online host can post right now|Nenhum host online pode enviar agora)/)
          .waitFor();
      },
    },
    {
      name: "webhooks-remover",
      route,
      webhooks: true,
      prepare: async (page) => {
        await listed(page);
        await page
          .getByRole("button", { name: new RegExp(`^(Remove|Remover) ${FAILING_NAME}$`) })
          .click();
        await page.getByRole("alertdialog").waitFor();
      },
    },
  ];
}
