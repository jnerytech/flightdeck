/** Part of the print table (scripts/demo-shots.ts), in print order: the states of Messaging the audit of #168 found (#4297). */

import type { MessageInfo } from "@flightdeck/protocol";
import type { Locator, Page } from "playwright-core";
import type { DemoIds } from "../../demo-seed.ts";
import { DEMO_MESSAGE_ASK } from "../e2e/journeys.ts";
import { ALFA, type Shot, showSection } from "./shot.ts";

/** What the page asks every host for (`MESSAGE_LIMIT` of the page): a full answer is a list that may be cut. */
const PAGE_LIMIT = 200;

/** One delivered message between two sessions the hub does not know, as `messages.list` answers it. */
function message(n: number): MessageInfo {
  const at = new Date(Date.UTC(2026, 10, 20, 8, 0, 0) + n * 60_000).toISOString();
  return {
    id: `demo-cut-${n}`,
    fromSession: "3c9a41de-5b7f-4e02-a6d8-1f0b7c2e9a54",
    fromHost: "alfa",
    toSession: "8d2e6b70-41c3-49fa-b5e1-7a90c3d4f268",
    toHost: "alfa",
    text: `Status ${n}: the export job is at step ${(n % 7) + 1} of 7.`,
    status: "delivered",
    reason: null,
    createdAt: at,
    deliveredAt: at,
    teamId: null,
    kind: "session",
  };
}

/** A full page of the limit, so the page says a host may have more. */
const FULL_PAGE: MessageInfo[] = Array.from({ length: PAGE_LIMIT }, (_, i) => message(i + 1));

/** A project path with no break to wrap at: the rule's row must keep its button inside (#4297). */
const LONG_PATH =
  "/home/ubuntu/repos/acme-platform-monorepo/services/billing-reconciliation-worker/packages/shared-ledger-client/src/generated/".slice(
    0,
    120,
  );

/** Messaging rules with an exception on a long project and a pair paused between two long session ids. */
const LONG_RULES = {
  policy: {
    exceptions: [
      {
        id: "demo-long-exception",
        from: { project: LONG_PATH },
        to: { session: "8d2e6b70-41c3-49fa-b5e1-7a90c3d4f268" },
        bothWays: true,
      },
    ],
    retentionDays: 30,
  },
  paused: ["alfa/3c9a41de-5b7f-4e02-a6d8-1f0b7c2e9a54|alfa/8d2e6b70-41c3-49fa-b5e1-7a90c3d4f268"],
};

const conversationsRoute = { name: "conversations" } as const;

const filterBox = (page: Page) =>
  page.getByRole("textbox", { name: /^(Filtrar mensagens|Filter messages)$/ });

/** Conversations with its list loaded: the seeded rows are there. */
async function listed(page: Page): Promise<void> {
  await page.getByText(DEMO_MESSAGE_ASK).first().waitFor({ timeout: 15_000 });
}

/** The filter holds `text`; `ready` is what the page shows once it has filtered. */
const filtered = (text: string, ready: (page: Page) => Locator) => async (page: Page) => {
  await listed(page);
  await filterBox(page).fill(text);
  await ready(page).first().waitFor({ timeout: 15_000 });
};

/** A session's Messages tab, opened; `ready` is what the print waits for. */
const messagesTab = (ready: RegExp) => async (page: Page) => {
  await page.getByRole("tab", { name: /^(Mensagens|Messages)$/ }).click();
  await page.getByText(ready).first().waitFor({ timeout: 15_000 });
};

export function messagingShots(ids: DemoIds): Shot[] {
  const session = { name: "session", host: ALFA, id: ids.idleSession } as const;
  return [
    {
      name: "conversas-cortada",
      route: conversationsRoute,
      wire: [{ command: "messages.list", data: { messages: FULL_PAGE } }],
      prepare: async (page) => {
        await page
          .getByText(/(A host may have more|Um host pode ter mais)/)
          .first()
          .waitFor({ timeout: 15_000 });
      },
    },
    {
      // A rule is per command, not per host, so every host refuses: the page names them all and lists nothing.
      name: "conversas-host-mudo",
      route: conversationsRoute,
      wire: [{ command: "messages.list", refuse: "The host did not answer in time." }],
      prepare: async (page) => {
        await page
          .getByText(/(No answer from|Sem resposta de)/)
          .first()
          .waitFor({ timeout: 15_000 });
      },
    },
    {
      name: "conversas-filtro",
      route: conversationsRoute,
      prepare: filtered("128", (page) => page.getByText(/\d+ (of|de) \d+ (messages?|mensagens?)/)),
    },
    {
      name: "conversas-filtro-vazio",
      route: conversationsRoute,
      prepare: filtered("zzzz", (page) =>
        page.getByRole("button", { name: /^(Clear filter|Limpar filtro)$/ }),
      ),
    },
    {
      name: "sessao-mensagens-carregando",
      route: session,
      wire: [{ command: "messages.list", stall: true }],
      prepare: async (page) => {
        await page.getByRole("tab", { name: /^(Mensagens|Messages)$/ }).click();
        // The loading state has an accessible name and no text.
        await page
          .getByRole("status", { name: /^(Loading messages|Carregando mensagens)$/ })
          .waitFor({ timeout: 15_000 });
      },
    },
    {
      name: "sessao-mensagens-falhou",
      route: session,
      wire: [{ command: "messages.list", refuse: "The host could not read the messages." }],
      prepare: messagesTab(/(Could not load this session's messages|Não foi possível carregar)/),
    },
    {
      name: "sessao-mensagens-formulario",
      route: session,
      prepare: async (page) => {
        await messagesTab(new RegExp(DEMO_MESSAGE_ASK.slice(0, 20)))(page);
        await page
          .getByRole("button", { name: /^(Mandar para outra sessão…|Send to another session…)$/ })
          .click();
        await page.getByRole("textbox", { name: /^(Texto da mensagem|Message text)$/ }).waitFor();
      },
    },
    {
      name: "configuracoes-mensagens-longos",
      route: { name: "settings" },
      wire: [{ command: "messaging.rules.get", data: LONG_RULES }],
      prepare: async (page) => {
        await showSection(/^(Messages between sessions on|Mensagens entre sessões em) /)(page);
        // The card shows its title while the rules load: the print waits for the long value.
        await page
          .getByText(/billing-reconciliation-worker/)
          .first()
          .waitFor({ timeout: 15_000 });
      },
    },
  ];
}
