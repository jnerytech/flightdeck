/**
 * Prints of the main screens and of the hard states (phase 10), in both themes and both
 * languages, from the running demo. Uses the Chrome installed on the machine through
 * playwright-core (no browser download); the CI job of the last area uses Chromium instead.
 * Files land in apps/desktop/screenshots/<theme>-<lang>/<screen>.png (ignored by git).
 */
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, type Page } from "playwright-core";
import type { Route } from "../apps/desktop/src/lib/router.ts";
import type { DemoIds } from "./demo-seed.ts";

export const SHOTS_DIR = resolve(import.meta.dir, "../apps/desktop/screenshots");

interface Shot {
  name: string;
  route: Route;
  /** After the screen loads: open the palette, scroll a long list to its end… */
  prepare?(page: Page): Promise<void>;
}

const ALFA = "demo-alfa";

function shots(ids: DemoIds): Shot[] {
  return [
    { name: "hub", route: { name: "hub" } },
    {
      // The sidebar's queue with the Bash request open: its command, folder, age and buttons.
      name: "precisa-de-voce",
      route: { name: "hub" },
      prepare: async (page) => {
        await page.getByRole("button", { name: /Testes do backend: Bash/ }).click();
        await page.waitForTimeout(500);
      },
    },
    { name: "sessao-aprovacao", route: { name: "session", host: ALFA, id: ids.waitingSession } },
    { name: "sessao", route: { name: "session", host: ALFA, id: ids.idleSession } },
    { name: "board", route: { name: "board", host: ALFA, projectId: ids.project } },
    {
      name: "card",
      route: { name: "card", host: ALFA, projectId: ids.project, cardId: ids.diffCard },
    },
    {
      name: "card-gate",
      route: { name: "card", host: ALFA, projectId: ids.project, cardId: ids.gateCard },
    },
    { name: "historico", route: { name: "history", host: ALFA } },
    {
      name: "leitor-longo",
      route: { name: "reader", target: { hostId: ALFA, claudeSessionId: "hist-longo" } },
    },
    { name: "host", route: { name: "host", host: ALFA } },
    { name: "custos", route: { name: "costs" } },
    { name: "configuracoes", route: { name: "settings" } },
    {
      name: "paleta",
      route: { name: "hub" },
      prepare: async (page) => {
        await page.keyboard.press("Control+K");
        await page.waitForTimeout(800);
      },
    },
    // The hard states.
    { name: "host-offline", route: { name: "host", host: "demo-offline" } },
    { name: "host-incompativel", route: { name: "host", host: "demo-old" } },
    {
      name: "projeto-vazio",
      route: { name: "board", host: ALFA, projectId: ids.emptyProject },
    },
    {
      name: "lista-longa-fim",
      route: { name: "hub" },
      prepare: async (page) => {
        // Every scrolling box to its end: the last row must show.
        await page.evaluate(() => {
          for (const el of document.querySelectorAll<HTMLElement>("*")) {
            if (el.scrollHeight > el.clientHeight + 4) el.scrollTop = el.scrollHeight;
          }
        });
        await page.waitForTimeout(300);
      },
    },
    {
      name: "erro",
      route: { name: "reader", target: { hostId: ALFA, claudeSessionId: "nao-existe" } },
    },
  ];
}

export async function takeShots(
  url: string,
  ids: DemoIds,
  env: Record<string, string>,
  log: (msg: string) => void,
): Promise<string> {
  // The installed Chrome; Edge when Chrome refuses automation (some managed installs do).
  const browser = await chromium
    .launch({ channel: "chrome", headless: true, env })
    .catch(() => chromium.launch({ channel: "msedge", headless: true, env }));
  try {
    for (const theme of ["light", "dark"] as const) {
      for (const lang of ["pt-BR", "en"] as const) {
        const dir = join(SHOTS_DIR, `${theme}-${lang}`);
        mkdirSync(dir, { recursive: true });
        const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        for (const shot of shots(ids)) {
          const page = await context.newPage();
          const query = new URLSearchParams({ theme, lang, route: JSON.stringify(shot.route) });
          await page.goto(`${url}?${query}`);
          // The hosts connect and the screen loads its data.
          await page.waitForTimeout(1500);
          await shot.prepare?.(page);
          await page.screenshot({ path: join(dir, `${shot.name}.png`) });
          await page.close();
        }
        await context.close();
        log(`prints ${theme} ${lang}`);
      }
    }
  } finally {
    await browser.close();
  }
  return SHOTS_DIR;
}
