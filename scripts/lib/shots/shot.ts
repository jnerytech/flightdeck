/**
 * What the print table is made of: the `Shot` type, and the helpers and fixtures its
 * tables and the print machinery of scripts/demo-shots.ts share.
 */

import type { Page } from "playwright-core";
import type { Route } from "../../../apps/desktop/src/lib/router.ts";
import type { DemoIds } from "../../demo-seed.ts";
import type { WireRule } from "./wire.ts";

export interface Shot {
  name: string;
  route: Route;
  /**
   * Clients kept in the page's storage before it loads (phase 29), and the one selected; the other
   * prints have none, so they look as they did before clients existed.
   */
  clients?: { selected?: string };
  /** Simple mode on the demo's first host (phase 33): the print starts at its Home. */
  simple?: boolean;
  /** Phase 36: an hourly rate and one person kept in the page's storage before it loads. */
  roi?: boolean;
  /** Issue #137: notifications kept in the page's storage before it loads (read, unread, collapsed, gone). */
  inbox?: boolean;
  /** Issue #1168: one session finished since the last look, kept in the page's storage before it loads (Needs you's Finished group). */
  finished?: boolean;
  /** Issue #1344: the app was last active long ago, so Needs you opens with "While you were away". */
  away?: boolean;
  /** #1414: the hosts answer with their memory and a budget over their holds (`holdsScript`). */
  holds?: boolean;
  /** #3602: the vault's list kept in the page's storage before it loads (the secrets' rows, with no value). */
  secrets?: boolean;
  /** #3602: the vault's usage log kept in the page's storage before it loads. */
  vaultUsage?: boolean;
  /** #3982: what the page's sockets do to a command (a host's answer refused or replaced, a request sent as another), for a state the demo's hosts cannot be left in. */
  wire?: WireRule[];
  /** #3943: the hosts answer Connections with fake destinos, config names and an askpass prompt (`sshScript`). */
  ssh?: boolean;
  /** #3943: with `ssh`, an askpass prompt follows the first destinos answer, so the print shows it. */
  askpass?: boolean;
  /** Demo switches added to the address (`update=<version>`: the update card shows). */
  query?: Record<string, string>;
  /** After the screen loads: open the palette, scroll a long list to its end… */
  prepare?(page: Page): Promise<void>;
}

/**
 * Issue #581: the demo shows a toast when the page hears `flightdeck:demo-toast`, sent right before
 * the shot (a toast lives 5 s); the print waits for it to be in place.
 */
export async function showToast(page: Page): Promise<void> {
  await page.evaluate(() => window.dispatchEvent(new Event("flightdeck:demo-toast")));
  await page.locator('[data-sonner-toast][data-mounted="true"]').first().waitFor();
  // timing: sonner's enter animation (400 ms) ends before the shot.
  await page.waitForTimeout(500);
}

export const ALFA = "demo-alfa";

/** The clients the client prints start with: Acme claims the demo's `github.com/acme/*` projects. */
export const DEMO_CLIENTS = JSON.stringify({
  v: 1,
  clients: [
    {
      id: "acme",
      name: "Acme",
      color: "indigo",
      rules: [{ id: "r1", kind: "remote", pattern: "github.com/acme/*" }],
      defaults: { vaultScope: false },
    },
    {
      id: "beta",
      name: "Beta",
      color: "rose",
      rules: [{ id: "r2", kind: "remote", pattern: "github.com/beta/*" }],
      defaults: { vaultScope: false },
    },
  ],
  overrides: {},
  budgets: { acme: 500 },
});

/** What the ROI prints start with: a rate of 60 an hour and Ana, who owns the first host. */
export const DEMO_ROI = JSON.stringify({
  v: 1,
  defaultRate: 60,
  clientRates: {},
  projectRates: {},
  planPrice: null,
  countReview: false,
  reviewCapMinutes: 5,
  people: [{ id: "ana", name: "Ana", hostIds: [ALFA], tokenLimit: 5_000_000, costLimit: null }],
});

export const agentRoute = (ids: DemoIds): Route => ({
  name: "agent",
  host: ALFA,
  projectId: ids.project,
  projectName: ids.projectName,
});

/** The session's timeline sheet, open with its turns loaded. */
export async function openTimeline(page: Page): Promise<void> {
  const button = page.getByRole("button", { name: /^(Linha do tempo|Timeline)$/ });
  const more = page.getByRole("button", { name: /^(Mais ações|More actions)$/ });
  // A narrow session header keeps its actions in the More actions popover, and it measures its width
  // after the first paint: each round clicks the button where it is, or opens the popover first.
  for (let round = 1; ; round++) {
    try {
      await button.or(more).first().waitFor({ timeout: 10_000 });
      if ((await button.count()) === 0) await more.click({ timeout: 5000 });
      await button.click({ timeout: 5000 });
      break;
    } catch (error) {
      if (round === 4) throw error;
    }
  }
  await page.waitForTimeout(1000);
}

/** Scrolls the first text matching `title` to the top of its scrolling box and lets it settle. */
/** #1354: Ctrl-click four cards of the demo board, three in Backlog and the one at a gate. */
export async function selectCards(page: Page): Promise<void> {
  for (const title of [
    "Definir o esquema do carrinho",
    "API do carrinho",
    "Tela do carrinho",
    "Revisar o fluxo de login",
  ]) {
    await page // NOSONAR: the cards are Ctrl-clicked one after the other, in this order
      .locator("li[data-card]", { hasText: title })
      .first()
      .click({ modifiers: ["Control"], position: { x: 40, y: 4 } });
  }
  await page.getByRole("group", { name: /^(Selection|Seleção)$/ }).waitFor();
}

export function showSection(title: RegExp): (page: Page) => Promise<void> {
  return async (page) => {
    await page
      .getByText(title)
      .first()
      .evaluate((el) => {
        // The whole card, not just its title, goes to the top of the scrolling box; a small gap
        // keeps its border from being cut.
        const card = el.closest("section, [role=region], .rounded-lg") ?? el;
        card.scrollIntoView({ block: "start" });
        for (let box = card.parentElement; box; box = box.parentElement) {
          const { overflowY } = getComputedStyle(box);
          if ((overflowY === "auto" || overflowY === "scroll") && box.scrollTop > 0) {
            box.scrollTop -= 12;
            break;
          }
        }
      });
    await page.waitForTimeout(400);
  };
}

/** The host page's Settings tab, where its configuration sections (folders, terminal, telemetry…) are. */
export async function openHostSettings(page: Page): Promise<void> {
  await page.getByRole("tab", { name: /^(Configurações|Settings)$/ }).click();
  await page.waitForTimeout(300);
}
