/** Part of the print table (scripts/demo-shots.ts), in print order: the approving-devices panel of a host's Settings (#4154). */

import {
  type ApprovalKeyInfo,
  FEATURE_APPROVAL_COMMAND,
  FEATURE_APPROVAL_TRUST,
} from "@flightdeck/protocol";
import type { Page } from "playwright-core";
import {
  DEMO_NEW_KEY,
  DEMO_OTHER_KEY,
  DEMO_THIS_KEY,
} from "../../../apps/desktop/src/demo/approval-keys.ts";
import { encodeAdd } from "../../../apps/desktop/src/features/approval/add-text.ts";
import type { DemoIds } from "../../demo-seed.ts";
import { ALFA, openHostSettings, type Shot, showSection } from "./shot.ts";
import type { WireRule } from "./wire.ts";

/**
 * The demo's hosts have no enrolled device, and the web build holds no key. The prints open the host
 * page with a key store the page can use (`approvalKeys=enrolled`: this device's key is already made;
 * `empty`: none yet), and the host's answers are faked in the page, so every machine prints the same.
 */
const THIS_DEVICE: ApprovalKeyInfo = {
  keyId: DEMO_THIS_KEY.keyId,
  name: "Work laptop",
  client: "flightdeck-desktop",
  enrolledAt: "2026-11-02T14:00:00.000Z",
  address: "192.168.1.20",
};
const OTHER_DEVICE: ApprovalKeyInfo = {
  keyId: DEMO_OTHER_KEY.keyId,
  name: "Home PC",
  client: "flightdeck-desktop",
  enrolledAt: "2026-11-05T09:30:00.000Z",
  address: "192.168.1.31",
};

/** What `approval.list` answers when the host lists these devices, or none. */
const listing = (...keys: ApprovalKeyInfo[]) => ({ protectionOff: keys.length === 0, keys });
const LISTED: WireRule = { command: "approval.list", data: listing(THIS_DEVICE, OTHER_DEVICE) };

const TITLE = /^(Approving devices|Dispositivos que aprovam)$/;
const LOADING = /^(Reading the host's devices…|Lendo os dispositivos do host…)$/;
const FAILED =
  /^(The host's devices could not be read\.|Não foi possível ler os dispositivos do host\.)$/;
const OFF = /^(Protection is off|Proteção desligada)/;
const ON = /^(Protection is on|Proteção ligada)/;
const LOST = /^(Protection was on and|A proteção estava ligada e)/;
const UNCHECKED =
  /^(This host does not ask for a device|Este host não pede a confirmação de um dispositivo)/;
const OFFER = /^(Add this device\?|Adicionar este dispositivo\?)$/;
const WAITING =
  /^(Waiting for the other device to add this one\.|Aguardando o outro dispositivo adicionar este\.)$/;

/** The panel at the top of the host's Settings, once the text that says which of its states is up shows. */
function panelShows(
  ready: RegExp,
  then?: (page: Page) => Promise<void>,
): (page: Page) => Promise<void> {
  return async (page) => {
    await openHostSettings(page);
    await page.getByText(TITLE).first().waitFor({ timeout: 15_000 });
    await page.getByText(ready).first().waitFor({ timeout: 15_000 });
    await then?.(page);
    await showSection(TITLE)(page);
  };
}

/** An enrolled device reads the text a new device shows: the host's id is the one the key store was asked about. */
async function readNewDevice(page: Page): Promise<void> {
  const daemonId = await page.evaluate(() => document.documentElement.dataset.demoDaemonId ?? "");
  const text = encodeAdd({ daemonId, publicKey: DEMO_NEW_KEY.publicKey, name: "Tablet" });
  await page.getByLabel(/^(Text from the new device|Texto do novo dispositivo)$/).fill(text);
  await page.getByRole("button", { name: /^(Read|Ler)$/ }).click();
  await page.getByText(OFFER).first().waitFor();
}

/** A device that asks to be added: its name, then the text it shows while it waits. */
async function askToBeAdded(page: Page): Promise<void> {
  await page.getByLabel(/^(Name of this device|Nome deste dispositivo)$/).fill("Tablet");
  await page.getByRole("button", { name: /^(Show the text|Mostrar o texto)$/ }).click();
  await page.getByText(WAITING).first().waitFor();
}

/** Revokes the other device: the host then lists none, which the panel says was not turned off here. */
async function revokeOther(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^(Revoke|Revogar) Home PC$/ }).click();
  await page.getByText(LOST).first().waitFor();
}

export function devicesShots(_ids: DemoIds): Shot[] {
  const route = { name: "host" as const, host: ALFA };
  const enrolled = { approvalKeys: "enrolled" };
  const empty = { approvalKeys: "empty" };
  return [
    {
      name: "aprovacao-carregando",
      route,
      query: empty,
      wire: [{ command: "approval.list", hold: true }],
      prepare: panelShows(LOADING),
    },
    {
      name: "aprovacao-falha",
      route,
      query: empty,
      wire: [{ command: "approval.list", refuse: "The host could not list its devices." }],
      prepare: panelShows(FAILED),
    },
    {
      name: "aprovacao-ativar",
      route,
      query: empty,
      wire: [{ command: "approval.list", data: listing() }],
      prepare: panelShows(OFF),
    },
    { name: "aprovacao-lista", route, query: enrolled, wire: [LISTED], prepare: panelShows(ON) },
    {
      name: "aprovacao-perdida",
      route,
      query: enrolled,
      wire: [
        { command: "approval.list", data: listing(THIS_DEVICE, OTHER_DEVICE), after: listing() },
        {
          command: "approval.challenge",
          reply: { nonce: "demo", daemonId: "demo", expiresInMs: 60_000 },
        },
        { command: "approval.revoke", reply: null },
      ],
      prepare: panelShows(ON, revokeOther),
    },
    {
      name: "aprovacao-nao-checados",
      route,
      query: enrolled,
      wire: [
        LISTED,
        {
          command: "host.info",
          without: { features: [FEATURE_APPROVAL_COMMAND, FEATURE_APPROVAL_TRUST] },
        },
      ],
      prepare: panelShows(UNCHECKED),
    },
    {
      name: "aprovacao-oferta",
      route,
      query: enrolled,
      wire: [LISTED],
      prepare: panelShows(ON, readNewDevice),
    },
    {
      name: "aprovacao-aguardando",
      route,
      query: empty,
      wire: [{ command: "approval.list", data: listing(OTHER_DEVICE) }],
      prepare: panelShows(ON, askToBeAdded),
    },
  ];
}
