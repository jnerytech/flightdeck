/**
 * Prints of the main screens and of the hard states (phase 10), in both themes and both
 * languages, from the running demo. Uses the Chrome installed on the machine through
 * playwright-core (no browser download); the CI job of the last area uses Chromium instead.
 * Files land in apps/desktop/screenshots/<theme>-<lang>/<screen>.png (ignored by git).
 */
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { chromium, type Page } from "playwright-core";
import type { Route } from "../apps/desktop/src/lib/router.ts";
import type { DemoIds } from "./demo-seed.ts";
import { type AxeViolation, blocking, describeViolation } from "./lib/axe.ts";
import { launchFirst } from "./lib/browser.ts";
import { type VisualMode, VOLATILE_RULES } from "./lib/visual.ts";

export const SHOTS_DIR = resolve(import.meta.dir, "../apps/desktop/screenshots");

interface Shot {
  name: string;
  route: Route;
  /** After the screen loads: open the palette, scroll a long list to its end… */
  prepare?(page: Page): Promise<void>;
}

const ALFA = "demo-alfa";

const agentRoute = (ids: DemoIds): Route => ({
  name: "agent",
  host: ALFA,
  projectId: ids.project,
  projectName: ids.projectName,
});

/** The session's timeline sheet, open with its turns loaded. */
async function openTimeline(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^(Linha do tempo|Timeline)$/ }).click();
  await page.waitForTimeout(1000);
}

/** Scrolls the first text matching `title` to the top of its scrolling box and lets it settle. */
function showSection(title: RegExp): (page: Page) => Promise<void> {
  return async (page) => {
    await page
      .getByText(title)
      .first()
      .evaluate((el) => el.scrollIntoView({ block: "start" }));
    await page.waitForTimeout(400);
  };
}

function shots(ids: DemoIds): Shot[] {
  return [
    { name: "hub", route: { name: "hub" } },
    {
      // Precisa de você with the Bash request chosen: its command, folder, age and buttons.
      name: "precisa-de-voce",
      route: { name: "needs-you" },
      prepare: async (page) => {
        const request = page.getByRole("button", { name: /Testes do backend: Bash/ });
        await request.click();
        await page.waitForTimeout(500);
      },
    },
    {
      // The sidebar as a 56 px rail of icons.
      name: "barra-recolhida",
      route: { name: "hub" },
      prepare: async (page) => {
        await page
          .getByRole("button", { name: /^(Recolher barra lateral|Collapse sidebar)$/ })
          .click();
        await page.waitForTimeout(400);
      },
    },
    { name: "sessao-aprovacao", route: { name: "session", host: ALFA, id: ids.waitingSession } },
    { name: "sessao", route: { name: "session", host: ALFA, id: ids.idleSession } },
    // The form with its Criar sessão off and the reason beside it.
    { name: "nova-sessao", route: { name: "new-session", host: ALFA } },
    { name: "board", route: { name: "board", host: ALFA, projectId: ids.project } },
    {
      name: "card",
      route: { name: "card", host: ALFA, projectId: ids.project, cardId: ids.diffCard },
    },
    {
      // The card's Mudanças tab: files, numbered diff and the composer open on a line.
      name: "card-mudancas",
      route: { name: "card", host: ALFA, projectId: ids.project, cardId: ids.diffCard },
      prepare: async (page) => {
        await page.getByRole("button", { name: /^(Mudanças|Changes)$/ }).click();
        await page
          .getByRole("button", {
            name: /^(Comentar a linha 1 de fake-1.txt|Comment on line 1 of fake-1.txt)$/,
          })
          .click();
        await page.waitForTimeout(500);
      },
    },
    {
      // A session's Mudanças tab: the repository's working tree against HEAD.
      name: "sessao-mudancas",
      route: { name: "session", host: ALFA, id: ids.idleSession },
      prepare: async (page) => {
        await page.getByRole("button", { name: /^(Mudanças|Changes)$/ }).click();
        await page.waitForTimeout(800);
      },
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
    {
      // Phase 14: two tabs, the second on alfa's page, and the window split in two areas.
      name: "abas-divididas",
      route: { name: "hub" },
      prepare: async (page) => {
        await page
          .getByRole("button", { name: /^(Abrir host alfa|Open host alfa)$/ })
          .click({ modifiers: ["Control"] });
        await page.getByRole("button", { name: /^(Dividir a tela|Split the screen)$/ }).click();
        await page.waitForTimeout(800);
      },
    },
    {
      // Phase 14: an embedded terminal on alfa, live, after an echo.
      name: "terminal",
      route: { name: "host", host: ALFA },
      prepare: async (page) => {
        await page.getByRole("button", { name: /^(Novo terminal|New terminal)$/ }).click();
        await page.getByText(/^(Ao vivo|Live)$/).waitFor({ timeout: 15_000 });
        await page.locator(".xterm").first().click();
        await page.keyboard.type("echo flightdeck\n");
        await page.waitForTimeout(1000);
      },
    },
    // The Agente screen of a project: its four tabs, with a file of each open.
    { name: "agente-mcp", route: agentRoute(ids) },
    {
      name: "agente-claude-md",
      route: agentRoute(ids),
      prepare: async (page) => {
        await page.getByRole("tab", { name: "CLAUDE.md" }).click();
        await page
          .getByRole("button", { name: /^CLAUDE\.md \(/ })
          .first()
          .click();
        await page.waitForTimeout(600);
      },
    },
    {
      name: "agente-agentes",
      route: agentRoute(ids),
      prepare: async (page) => {
        await page.getByRole("tab", { name: /^(Agentes|Agents)$/ }).click();
        await page.getByRole("button", { name: /^revisor \(/ }).click();
        await page.waitForTimeout(600);
      },
    },
    {
      name: "agente-skills",
      route: agentRoute(ids),
      prepare: async (page) => {
        await page.getByRole("tab", { name: "Skills" }).click();
        await page.getByRole("button", { name: /^deploy \(/ }).click();
        await page.waitForTimeout(600);
      },
    },
    // Phase 26: the Memória and Contexto tabs of the Agente screen, and the Plugins page.
    {
      name: "agente-memoria",
      route: agentRoute(ids),
      prepare: async (page) => {
        await page.getByRole("tab", { name: /^(Memória|Memory)$/ }).click();
        await page.getByRole("button", { name: /^(Abrir|Open) MEMORY\.md$/ }).click();
        await page.waitForTimeout(600);
      },
    },
    {
      name: "agente-contexto",
      route: agentRoute(ids),
      prepare: async (page) => {
        await page.getByRole("tab", { name: /^(Contexto|Context)$/ }).click();
        await page.waitForTimeout(600);
      },
    },
    { name: "plugins", route: { name: "plugins" } },
    // Phase 20: the persona library (the pack in the app's language) and the editor's preview.
    { name: "personas", route: { name: "personas" } },
    {
      name: "personas-editor",
      route: { name: "personas" },
      prepare: async (page) => {
        await page.getByRole("button", { name: /^(Nova persona|New persona)$/ }).click();
        await page.waitForTimeout(600);
      },
    },
    // The timeline of a session, and its two dialogs.
    {
      name: "linha-do-tempo",
      route: { name: "session", host: ALFA, id: ids.rewindSession },
      prepare: openTimeline,
    },
    {
      name: "linha-do-tempo-voltar",
      route: { name: "session", host: ALFA, id: ids.rewindSession },
      prepare: async (page) => {
        await openTimeline(page);
        await page
          .getByRole("button", { name: /\((turno|turn) 2\)$/ })
          .first()
          .click();
        await page.waitForTimeout(800);
      },
    },
    {
      name: "linha-do-tempo-bifurcar",
      route: { name: "session", host: ALFA, id: ids.rewindSession },
      prepare: async (page) => {
        await openTimeline(page);
        await page
          .getByRole("button", { name: /^(Bifurcar daqui|Fork from here) \(/ })
          .first()
          .click();
        await page.waitForTimeout(600);
      },
    },
    { name: "custos", route: { name: "costs" } },
    { name: "configuracoes", route: { name: "settings" } },
    // The sections below the first screen of Settings, the host page and the vault: their rows of
    // buttons and fields are checked in the prints too.
    {
      name: "configuracoes-orcamentos",
      route: { name: "settings" },
      prepare: showSection(/^(Budgets of|Orçamentos de) /),
    },
    {
      name: "configuracoes-mensagens",
      route: { name: "settings" },
      prepare: showSection(/^(Messages between sessions on|Mensagens entre sessões em) /),
    },
    {
      name: "host-manutencao",
      route: { name: "host", host: ALFA },
      prepare: showSection(/^(Maintenance|Manutenção)$/),
    },
    {
      name: "cofre-backup",
      route: { name: "vault" },
      prepare: async (page) => {
        await page.getByRole("tab", { name: "Backup" }).click();
        await page.waitForTimeout(400);
      },
    },
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
    { name: "host-reconectando", route: { name: "host", host: "demo-slow" } },
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

/** axe-core's browser bundle. */
const AXE = createRequire(import.meta.url).resolve("axe-core/axe.min.js");

/**
 * Makes two runs print the same pixels: no animation or caret, and the text that changes from
 * run to run (folders, ports, times, ages) written the same.
 */
async function stabilize(page: Page): Promise<void> {
  await page.addStyleTag({
    content:
      "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}",
  });
  await page.evaluate(
    (rules) => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        let text = node.nodeValue ?? "";
        for (const [source, flags, to] of rules) text = text.replace(new RegExp(source, flags), to);
        node.nodeValue = text;
      }
    },
    VOLATILE_RULES.map(([pattern, to]) => [pattern.source, pattern.flags, to] as const),
  );
}

export async function takeShots(
  url: string,
  ids: DemoIds,
  env: Record<string, string>,
  log: (msg: string) => void,
  visual: VisualMode = "off",
): Promise<string> {
  const browser = await launchFirst((attempt) =>
    chromium.launch({ ...attempt, headless: true, env }),
  );
  const problems: string[] = [];
  try {
    for (const theme of ["light", "dark"] as const) {
      for (const lang of ["pt-BR", "en"] as const) {
        const dir = join(SHOTS_DIR, `${theme}-${lang}`);
        mkdirSync(dir, { recursive: true });
        // For the comparison: the same locale, zone and scale on every machine.
        const context = await browser.newContext({
          viewport: { width: 1280, height: 800 },
          ...(visual === "off"
            ? {}
            : {
                reducedMotion: "reduce" as const,
                deviceScaleFactor: 1,
                timezoneId: "UTC",
                locale: lang,
              }),
        });
        for (const shot of shots(ids).filter((s) =>
          s.name.includes(process.env.DEMO_SHOTS ?? ""),
        )) {
          const page = await context.newPage();
          page.on("pageerror", (error) =>
            log(`erro na página ${shot.name} ${page.url()}: ${error.stack}`),
          );
          const query = new URLSearchParams({ theme, lang, route: JSON.stringify(shot.route) });
          await page.goto(`${url}?${query}`);
          // The hosts connect and the screen loads its data.
          await page.waitForTimeout(1500);
          // The host nothing listens on shows as offline (hollow gray), not still connecting.
          await page
            .getByRole("img", { name: /^notebook: offline$/ })
            .first()
            .waitFor({ timeout: 8000 })
            .catch(() => undefined);
          await shot.prepare?.(page).catch(async (error) => {
            await page.screenshot({ path: join(dir, `${shot.name}-FALHOU.png`) });
            throw error;
          });
          if (visual !== "off") await stabilize(page);
          await page.screenshot({
            path: join(dir, `${shot.name}.png`),
            ...(visual === "off"
              ? {}
              : { animations: "disabled" as const, caret: "hide" as const }),
          });
          // The same screen, checked for accessibility: serious and critical violations fail.
          await page.addScriptTag({ path: AXE });
          const found = await page.evaluate(() =>
            (
              globalThis as unknown as {
                axe: { run(): Promise<{ violations: AxeViolation[] }> };
              }
            ).axe
              .run()
              .then((result) => result.violations),
          );
          for (const violation of blocking(found)) {
            problems.push(describeViolation(`${theme} ${lang} ${shot.name}`, violation));
          }
          await page.close();
        }
        await context.close();
        log(`prints ${theme} ${lang}`);
      }
    }
  } finally {
    await browser.close();
  }
  if (problems.length > 0) {
    throw new Error(
      `axe: ${problems.length} violações serious ou critical\n${problems.join("\n")}`,
    );
  }
  return SHOTS_DIR;
}
