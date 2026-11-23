/** Part of the print table (scripts/demo-shots.ts), in print order: the Claude account card of the host page (#4351). */

import type { AccountState } from "@flightdeck/protocol";
import type { Page } from "playwright-core";
import type { DemoIds } from "../../demo-seed.ts";
import { ALFA, type Shot, showSection } from "./shot.ts";
import type { WireRule } from "./wire.ts";

/** The card's panel: its title is the heading `showSection` scrolls to. */
const TITLE = /^(Claude account|Conta do Claude)$/;
const card = (page: Page) =>
  page.getByRole("region", { name: /^(Claude account of|Conta do Claude de) / });

/** The demo host does not always announce the account; the card is drawn only for a host that does. */
const CAN_SHOW: WireRule = { command: "host.info", with: { features: ["account"] } };
/** The host's own stream would push its real reading over the print's: it is never asked for. */
const NO_STREAM: WireRule = { command: "account.watch", stall: true };

/** An account as the host reads it; `"{in Ns}"` is the time N s from the answer (a negative N is in the past). */
const account = (over: Partial<AccountState>): AccountState => ({
  status: "signed_in",
  name: "ana.souza@example.com",
  organization: "Example Organization",
  plan: "max",
  provider: "firstParty",
  windows: [],
  readAt: "{in -120s}",
  stale: false,
  error: null,
  source: "sdk",
  loginCommand: "claude auth login",
  ...over,
});

const reading = (
  window: string,
  utilization: number,
  status: "allowed" | "allowed_warning" | "rejected",
  resets: number,
) => ({
  window,
  utilization,
  status,
  resetsAt: `{in ${resets}s}`,
  readAt: "{in -120s}",
});

/**
 * Every window the card draws: one far from its limit, one close, one rejected. The name and the
 * organization are long on purpose, so a narrow card has to wrap them.
 */
const SIGNED_IN = account({
  name: "ana.souza.with-a-long-address@example-organization-with-a-long-domain-name.com",
  organization: "Example Organization With A Very Long Name And A Department Inc.",
  windows: [
    reading("five_hour", 0.83, "allowed_warning", 5_400),
    reading("seven_day", 1, "rejected", 172_800),
    reading("seven_day_opus", 0.4, "allowed", 200_000),
    reading("seven_day_sonnet", 0.12, "allowed", 200_000),
  ],
});

/** A print whose host answers `account.get` with `state`; a print never lets the host read anything for real. */
const answered = (state: AccountState, ...more: WireRule[]): WireRule[] => [
  CAN_SHOW,
  NO_STREAM,
  { command: "account.get", reply: state },
  ...more,
];

/** The card has left its loading text: the print waits for the first thing a state draws. */
const drawn = async (page: Page) => {
  await card(page).locator("p, meter, code, [role=alert]").first().waitFor({ timeout: 15_000 });
  await showSection(TITLE)(page);
};

export function accountShots(_ids: DemoIds): Shot[] {
  const route = { name: "host", host: ALFA } as const;
  return [
    {
      name: "host-conta-conectada",
      route,
      wire: answered(SIGNED_IN),
      prepare: async (page) => {
        await card(page).locator("meter").first().waitFor({ timeout: 15_000 });
        await showSection(TITLE)(page);
      },
    },
    {
      name: "host-conta-desconectada",
      route,
      wire: answered(account({ status: "signed_out", name: null, organization: null, plan: null })),
      prepare: async (page) => {
        await card(page).locator("code").first().waitFor({ timeout: 15_000 });
        await showSection(TITLE)(page);
      },
    },
    {
      name: "host-conta-chave-api",
      route,
      wire: answered(account({ status: "api_key", name: null, organization: null, plan: null })),
      prepare: drawn,
    },
    {
      name: "host-conta-terceiros",
      route,
      wire: answered(
        account({
          status: "third_party",
          provider: "bedrock",
          name: null,
          organization: null,
          plan: null,
        }),
      ),
      prepare: drawn,
    },
    {
      name: "host-conta-desconhecida-erro",
      route,
      wire: answered(
        account({
          status: "unknown",
          name: null,
          organization: null,
          plan: null,
          readAt: null,
          error: "account_unavailable",
        }),
      ),
      prepare: async (page) => {
        await card(page).getByRole("alert").waitFor({ timeout: 15_000 });
        await showSection(TITLE)(page);
      },
    },
    {
      // Read, and still not a sign-in the app knows: not the same as a read that has not come back.
      name: "host-conta-desconhecida",
      route,
      wire: answered(account({ status: "unknown", name: null, organization: null, plan: null })),
      prepare: drawn,
    },
    {
      name: "host-conta-carregando",
      route,
      wire: [CAN_SHOW, NO_STREAM, { command: "account.get", hold: true }],
      prepare: async (page) => {
        await card(page)
          .getByText(/^(Reading the account…|Lendo a conta…)$/)
          .waitFor({ timeout: 15_000 });
        await showSection(TITLE)(page);
      },
    },
    {
      // The refresh is never answered: the button is off and the line says it is reading.
      name: "host-conta-atualizando",
      route,
      wire: answered(SIGNED_IN, { command: "account.refresh", stall: true }),
      prepare: async (page) => {
        await card(page).locator("meter").first().waitFor({ timeout: 15_000 });
        await card(page)
          .getByRole("button", { name: /^(Refresh the account of|Atualizar a conta de) / })
          .click();
        await card(page)
          .getByText(/^(Reading…|Lendo…)$/)
          .waitFor({ timeout: 15_000 });
        await showSection(TITLE)(page);
      },
    },
  ];
}
