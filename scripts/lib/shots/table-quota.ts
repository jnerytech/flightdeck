/** Part of the print table (scripts/demo-shots.ts), in print order: the Quota card's states (#4308). */
import type { Page } from "playwright-core";
import type { DemoIds } from "../../demo-seed.ts";
import type { Shot } from "./shot.ts";
import type { WireRule } from "./wire.ts";

const WAIT = 15_000;
const HOUR_MS = 3_600_000;
const route = { name: "hub" } as const;
const later = (ms: number) => new Date(Date.now() + ms).toISOString();
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

/** A reading of the plan's window, taken a minute ago. */
const reading = (window: string, utilization: number, resetsInMs: number, status = "allowed") => ({
  window,
  utilization,
  status,
  resetsAt: later(resetsInMs),
  readAt: ago(60_000),
});

/** Both windows, the 7-day one over the guard. */
const HOT_WINDOWS = [
  reading("five_hour", 0.42, 2 * HOUR_MS),
  reading("seven_day", 0.95, 48 * HOUR_MS, "allowed_warning"),
];

/** The streams that would replace the faked answers are answered in the page, so they never reach the host. */
const STREAMS: WireRule[] = [
  { command: "quota.watch", reply: {} },
  { command: "account.watch", reply: {} },
];

/** What the hosts answer to `account.get`: signed in to a plan, unless `over` says otherwise. */
const account = (over: Record<string, unknown> = {}): WireRule => ({
  command: "account.get",
  data: {
    status: "signed_in",
    name: null,
    organization: null,
    plan: "max",
    provider: "firstParty",
    windows: [],
    readAt: ago(60_000),
    stale: false,
    error: null,
    source: "sdk",
    loginCommand: "claude auth login",
    ...over,
  },
});

/** What the hosts answer to `quota.get`, with the streams and the account (an account of its own wins). */
const card = (windows: unknown[], ...rest: WireRule[]): WireRule[] => [
  ...rest,
  { command: "quota.get", data: { windows, pauseAt: 0.9 } },
  account(),
  ...STREAMS,
];

const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A text in both languages, as a pattern that must match the whole text. */
const both = (en: string, pt: string) => new RegExp(`^(${literal(en)}|${literal(pt)})$`);
const GUARD = /^(New cards wait from|Cartões novos esperam a partir de)/;

/** The card's text `text` shows, and the pointer is away from it. */
async function textShown(page: Page, text: RegExp): Promise<void> {
  await page.getByText(text).first().waitFor({ timeout: WAIT });
  await page.mouse.move(1000, 700);
  await page.waitForTimeout(400);
}

/** The card shows its bars, and the pointer is away from it. */
async function barsShown(page: Page): Promise<void> {
  await page.getByRole("meter").first().waitFor({ timeout: WAIT });
  await page.mouse.move(1000, 700);
  await page.waitForTimeout(400);
}

export function quotaShots(_ids: DemoIds): Shot[] {
  return [
    {
      // A window over the guard: the red bar, the notice and the guard's select.
      name: "cota-cartao-quente",
      route,
      wire: card(HOT_WINDOWS),
      prepare: async (page) => {
        await barsShown(page);
        await page.getByRole("combobox", { name: GUARD }).first().waitFor({ timeout: WAIT });
      },
    },
    {
      // A host that does not announce the guard: its state as text, with no select.
      name: "cota-cartao-trava-leitura",
      route,
      wire: card(HOT_WINDOWS, { command: "host.info", without: { features: ["quotaPause"] } }),
      prepare: barsShown,
    },
    {
      name: "cota-cartao-sem-leitura",
      route,
      wire: card([]),
      prepare: (page) => textShown(page, both("no reading yet", "sem leitura ainda")),
    },
    {
      name: "cota-cartao-chave-api",
      route,
      wire: card([], account({ status: "api_key", plan: null })),
      prepare: (page) =>
        textShown(page, /^(This host uses an API key|Este host usa uma chave de API)/),
    },
    {
      // Every host signed in to one account: one card, a guard for each host.
      name: "cota-cartao-conta-compartilhada",
      route,
      wire: card(HOT_WINDOWS, account({ name: "ana@example.com", windows: HOT_WINDOWS })),
      prepare: async (page) => {
        await barsShown(page);
        await page.getByRole("combobox", { name: GUARD }).nth(1).waitFor({ timeout: WAIT });
      },
    },
    {
      // The window's pace, as a line of text under its bar.
      name: "cota-cartao-projecao",
      route,
      wire: card(HOT_WINDOWS, {
        command: "quota.history",
        data: {
          window: "five_hour",
          hours: 5,
          samples: [],
          projection: { exhaustsAt: later(HOUR_MS), resetsAt: later(2 * HOUR_MS), samples: 6 },
          consumers: [],
        },
      }),
      prepare: (page) => textShown(page, /(runs out at|esgota)/),
    },
    {
      // The last read failed: the bars are the earlier ones, and the card says so.
      name: "cota-cartao-obsoleta",
      route,
      wire: card(HOT_WINDOWS, account({ stale: true, error: "account_unavailable" })),
      prepare: (page) =>
        textShown(
          page,
          /^(Could not refresh: this is the last reading|Não foi possível atualizar)/,
        ),
    },
  ];
}
