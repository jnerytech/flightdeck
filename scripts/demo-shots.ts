/**
 * Prints of the main screens and of the hard states (phase 10), in both themes and both
 * languages, from the running demo. Uses the Chrome installed on the machine through
 * playwright-core (no browser download); the CI job of the last area uses Chromium instead.
 * Files land in apps/desktop/screenshots/<theme>-<lang>/<screen>.png (ignored by git).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, join, resolve } from "node:path";
import { inSequence } from "@flightdeck/protocol";
import { type BrowserContext, chromium, type Page } from "playwright-core";
import type { Route } from "../apps/desktop/src/lib/router.ts";
import type { DemoIds } from "./demo-seed.ts";
import { AXE_RUN_OPTIONS, type AxeViolation, blocking, describeViolation } from "./lib/axe.ts";
import { launchFirst } from "./lib/browser.ts";
import {
  type Finding,
  GAP_BOXES,
  GAPS,
  KEY_REGIONS,
  layoutFindings,
  loadCounts,
  type Ratchet,
  RESPONSIVE,
  RESPONSIVE_RULES,
  ratchetScreen,
  SPACING,
  SPACING_RULES,
  waitForStable,
} from "./lib/layout-guards.ts";
import { type Rgb, themeProblem } from "./lib/print-theme.ts";
import { PENDING_SELECTOR } from "./lib/shots-loaded.ts";
import { narrowSizes, unknownNarrowShots } from "./lib/shots-narrow.ts";
import { pickVariants } from "./lib/shots-variants.ts";
import { type VisualMode, VOLATILE_RULES } from "./lib/visual.ts";

export const SHOTS_DIR = resolve(import.meta.dir, "../apps/desktop/screenshots");
/**
 * The spacing guard's baseline (#588): how many findings each print had when the guard came in, per
 * rule, "theme lang print" and data-slot path with no numbers (#641). More than its count fails;
 * fewer must lower the count, so fixes only push it down. Without the file, the findings are only
 * written down (spacing-findings.json, and each one by its numbered path in
 * spacing-findings-occurrences.json).
 */
export const SPACING_BASELINE = resolve(import.meta.dir, "../apps/desktop/spacing-baseline.json");
/**
 * The narrow-window guard's baseline (#641), the same way: rule, "theme lang WxH print" and path
 * with no numbers (responsive-findings.json, responsive-findings-occurrences.json).
 * The dark prints re-measure the pages of NARROW_SHOTS at each of NARROW_SIZES.
 */
export const NARROW_BASELINE = resolve(import.meta.dir, "../apps/desktop/responsive-baseline.json");

interface Shot {
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
  /** Demo switches added to the address (`update=<version>`: the update card shows). */
  query?: Record<string, string>;
  /** After the screen loads: open the palette, scroll a long list to its end… */
  prepare?(page: Page): Promise<void>;
}

/**
 * Issue #581: the demo shows a toast when the page hears `flightdeck:demo-toast`, sent right before
 * the shot (a toast lives 5 s); the print waits for it to be in place.
 */
async function showToast(page: Page): Promise<void> {
  await page.evaluate(() => window.dispatchEvent(new Event("flightdeck:demo-toast")));
  await page.locator('[data-sonner-toast][data-mounted="true"]').first().waitFor();
  // timing: sonner's enter animation (400 ms) ends before the shot.
  await page.waitForTimeout(500);
}

const ALFA = "demo-alfa";

/** The notifications of the bell's print: today in UTC (the prints' zone), and one three days ago. */
function demoInbox(lang: string): string {
  const pt = lang.startsWith("pt");
  const dayStart = new Date().setUTCHours(0, 0, 0, 0);
  const today = (second: number) => new Date(dayStart + second * 1000).toISOString();
  const earlier = new Date(dayStart - 3 * 86_400_000 + 12 * 3_600_000).toISOString();
  const need = pt ? "Precisa de você" : "Needs you";
  const ask = (question: string) => (pt ? `Pergunta: ${question}` : `Asks: ${question}`);
  const entry = (id: string, at: string, extra: Record<string, unknown>) => ({
    id,
    at,
    title: need,
    body: "",
    read: false,
    ...extra,
  });
  return JSON.stringify([
    entry("1", today(300), {
      subject: "api · refactor",
      host: "alfa",
      ask: ask(pt ? "qual banco usar?" : "which DB to use?"),
      group: "alfa/api",
    }),
    entry("2", today(240), {
      subject: "api · refactor",
      host: "alfa",
      ask: ask(pt ? "devo migrar agora?" : "migrate now?"),
      group: "alfa/api",
    }),
    entry("3", today(180), {
      subject: "api · refactor",
      host: "alfa",
      ask: ask(pt ? "qual esquema?" : "which schema?"),
      group: "alfa/api",
    }),
    entry("4", today(120), {
      subject: "web · tests",
      host: "alfa",
      ask: pt ? "Quer executar: bun test" : "Wants to run: bun test",
      group: "alfa/web",
    }),
    entry("5", today(60), {
      title: pt ? "Card desbloqueado" : "Card unblocked",
      subject: "Card B",
      host: "alfa",
      ask: pt ? "Quer alterar main.ts" : "Wants to change main.ts",
      route: { name: "card", host: "demo-alfa", projectId: "gone", cardId: "gone" },
    }),
    entry("6", today(30), {
      subject: "docs · notes",
      host: "alfa",
      body: pt ? "ociosa" : "idle",
      read: true,
    }),
    entry("7", earlier, {
      title: pt ? "Orçamento" : "Budget",
      body: "alfa · 80%",
      read: true,
    }),
  ]);
}

/** The clients the client prints start with: Acme claims the demo's `github.com/acme/*` projects. */
const DEMO_CLIENTS = JSON.stringify({
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
const DEMO_ROI = JSON.stringify({
  v: 1,
  defaultRate: 60,
  clientRates: {},
  projectRates: {},
  planPrice: null,
  countReview: false,
  reviewCapMinutes: 5,
  people: [{ id: "ana", name: "Ana", hostIds: [ALFA], tokenLimit: 5_000_000, costLimit: null }],
});

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
async function openHostSettings(page: Page): Promise<void> {
  await page.getByRole("tab", { name: /^(Configurações|Settings)$/ }).click();
  await page.waitForTimeout(300);
}

function shots(ids: DemoIds): Shot[] {
  return [
    { name: "hub", route: { name: "hub" } },
    // Issue #581: a toast sits over the status bar, 0.75rem clear of it, like the update card.
    { name: "aviso-barra", route: { name: "hub" }, prepare: showToast },
    // ...and over the update card while it shows, never on it.
    {
      name: "aviso-atualizacao",
      route: { name: "hub" },
      query: { update: "9.9.9" },
      async prepare(page) {
        await page.locator('[data-slot="update-card"]').waitFor();
        await showToast(page);
      },
    },
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
    // The folder dialog over the form: centered, with the page dimmed behind it.
    {
      name: "pasta-escolher",
      route: { name: "new-session", host: ALFA },
      async prepare(page) {
        await page.getByRole("button", { name: /^(Procurar|Browse)/ }).click();
        await page.getByRole("dialog").waitFor();
      },
    },
    // The tab strip with twenty tabs: it scrolls, keeps each width and offers the menu of all.
    {
      name: "abas-muitas",
      route: { name: "hub" },
      async prepare(page) {
        for (let i = 0; i < 20; i++) {
          await page.keyboard.press("Control+t");
          await page.keyboard.press("Escape");
        }
        await page.getByRole("button", { name: /^(Todas as abas|All tabs)( \(|$)/ }).waitFor();
      },
    },
    // The list of all tabs open over that strip (#576): icons, hosts, the active one marked.
    {
      name: "abas-lista",
      route: { name: "hub" },
      async prepare(page) {
        for (let i = 0; i < 20; i++) {
          await page.keyboard.press("Control+t");
          await page.keyboard.press("Escape");
        }
        await page.getByRole("button", { name: /^(Todas as abas|All tabs)( \(|$)/ }).click();
        await page.getByRole("listbox", { name: /^(Todas as abas|All tabs)$/ }).waitFor();
      },
    },
    { name: "board", route: { name: "board", host: ALFA, projectId: ids.project } },
    // #117: the files of a worktree picked in the sidebar tree, in a panel beside the columns.
    {
      name: "board-arquivos",
      route: { name: "board", host: ALFA, projectId: ids.project },
      async prepare(page) {
        const tree = page.locator("[data-slot=project-tree]");
        const head = tree.locator('[data-project="flightdeck-web"]');
        if ((await head.getAttribute("aria-expanded")) === "false") await head.click();
        await tree.getByRole("button", { name: /fd\/revisar-o-fluxo-de-login/ }).click();
        await page.locator("[data-slot=board-files]").getByText("app.ts").waitFor();
      },
    },
    // #812: a pressed toggle (Blocked) looks pressed, in fill and in a ring, beside unpressed ones.
    {
      name: "board-bloqueados",
      route: { name: "board", host: ALFA, projectId: ids.project },
      async prepare(page) {
        const blocked = page.getByRole("button", { name: /^(Bloqueados|Blocked)$/ });
        await blocked.click();
        // Blocked itself, pressed: another toggle on the page (Files) could already be.
        await page
          .locator('[data-slot="button"][aria-pressed="true"]')
          .filter({ hasText: /^(Bloqueados|Blocked)$/ })
          .waitFor();
      },
    },
    // #117: a content search in that panel, each match as path:line with its line.
    {
      name: "board-arquivos-busca",
      route: { name: "board", host: ALFA, projectId: ids.project },
      async prepare(page) {
        const tree = page.locator("[data-slot=project-tree]");
        const head = tree.locator('[data-project="flightdeck-web"]');
        if ((await head.getAttribute("aria-expanded")) === "false") await head.click();
        await tree.getByRole("button", { name: /fd\/revisar-o-fluxo-de-login/ }).click();
        const panel = page.locator("[data-slot=board-files]");
        await panel.getByRole("button", { name: /^(Conteúdo|Content)$/ }).click();
        await panel.getByRole("searchbox").fill("export");
        await panel.getByText("app.ts:1").waitFor();
      },
    },
    {
      name: "card",
      route: { name: "card", host: ALFA, projectId: ids.project, cardId: ids.diffCard },
    },
    // Phase 31: the detail of the last card of a chain, and the refusal of its start.
    {
      // Opened from the board: a card in the Backlog is only known to the app once its board is.
      name: "card-bloqueado",
      route: { name: "board", host: ALFA, projectId: ids.project },
      prepare: async (page) => {
        await page.getByRole("button", { name: "Tela do carrinho", exact: true }).click();
        await page.getByRole("region", { name: /^(Bloqueado por|Blocked by)$/ }).waitFor();
        await page.waitForTimeout(400);
      },
    },
    {
      name: "board-inicio-recusado",
      route: { name: "board", host: ALFA, projectId: ids.project },
      prepare: async (page) => {
        await page
          .getByRole("button", { name: /^(Ações de|Actions for) Tela do carrinho$/ })
          .click();
        await page.getByRole("menuitem", { name: /^(Iniciar card|Start card)$/ }).click();
        await page.waitForTimeout(600);
      },
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
        await page.getByRole("tab", { name: /^(Mudanças|Changes)$/ }).click();
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
        // In the sidebar only: the host page and the project headers have buttons of the same name.
        await page
          .locator("aside")
          .first()
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
        await openHostSettings(page);
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
        // The pointer stays where the click was, over the new screen's button: its hover color
        // is not the one the print (and the contrast check) should see.
        await page.mouse.move(1000, 700);
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
    {
      // Issue #137: the bell's panel, unread rows with their dots, a session's repeats as one row, a read row and a gone target.
      name: "sino-painel",
      inbox: true,
      route: { name: "hub" },
      prepare: async (page) => {
        await page.getByRole("button", { name: /^(Notifications|Notificações)/ }).click();
        await page.getByRole("dialog").waitFor({ timeout: 8000 });
        await page.waitForTimeout(400);
      },
    },
    {
      // Issue #123: Home, the four cards with their seven days.
      name: "inicio-kpis",
      route: { name: "overview" },
      prepare: async (page) => {
        await page.locator(".kpi-card").first().waitFor({ timeout: 8000 });
        await page.waitForTimeout(600);
      },
    },
    // #126: Home with its data scope on one host, from the Data from menu in its toolbar.
    {
      name: "inicio-escopo",
      route: { name: "overview" },
      prepare: async (page) => {
        await page.locator(".kpi-card").first().waitFor({ timeout: 8000 });
        await page.getByRole("button", { name: /^(Dados de|Data from) / }).click();
        await page.getByRole("menuitemradio", { name: "alfa" }).click();
        await page.getByRole("button", { name: /^(Dados de|Data from) alfa$/ }).waitFor();
        await page.waitForTimeout(600);
      },
    },
    { name: "custos", route: { name: "costs" } },
    // Issue #151: the Activity board, its columns and cards (axe checks it in both themes).
    { name: "atividade", route: { name: "activity" } },
    // Phase 36: the ROI card of the web project, and the project and people tables of Costs.
    {
      name: "roi-cartao",
      roi: true,
      route: { name: "board", host: ALFA, projectId: ids.project },
      prepare: async (page) => {
        const card = page.getByRole("region", { name: /^(Return on cost|Retorno sobre o custo)$/ });
        await card.waitFor({ timeout: 8000 });
        // The card opens folded (issue #178): the print shows it open.
        await card.getByRole("button", { name: /^(Details|Detalhes)$/ }).click();
      },
    },
    {
      name: "roi-custos-pessoas",
      roi: true,
      route: { name: "costs" },
      prepare: async (page) => {
        const table = page.getByRole("table", {
          name: /^(Tokens against delivery, by person|Tokens contra entrega, por pessoa)$/,
        });
        await table.waitFor({ timeout: 8000 });
        await table.scrollIntoViewIfNeeded();
      },
    },
    {
      name: "roi-custos-tabelas",
      roi: true,
      route: { name: "costs" },
      prepare: async (page) => {
        const table = page.getByRole("table", {
          name: /^(Return on cost by project|Retorno sobre o custo por projeto)$/,
        });
        await table.waitFor({ timeout: 8000 });
        await table.scrollIntoViewIfNeeded();
      },
    },
    // The time panel of Custos (phase 23): the wait for permissions and the slowest tools.
    {
      name: "custos-tempo",
      route: { name: "costs" },
      prepare: showSection(/^(Tempo por projeto|Time per project)$/),
    },
    {
      // A session's Tempo tab: each prompt with its tools, the permission wait and the API error.
      name: "sessao-tempo",
      route: { name: "session", host: ALFA, id: ids.idleSession },
      prepare: async (page) => {
        await page.getByRole("tab", { name: /^(Tempo|Time)$/ }).click();
        await page.waitForTimeout(800);
      },
    },
    {
      // A finished terminal session's Rastro tab: the tree with a subagent, bars and highlights.
      name: "rastro",
      route: { name: "external", host: ALFA, claudeSessionId: ids.traceSession },
      prepare: async (page) => {
        await page.getByRole("tab", { name: /^(Rastro|Trace)$/ }).click();
        await page.waitForTimeout(800);
      },
    },
    {
      name: "rastro-replay",
      route: { name: "external", host: ALFA, claudeSessionId: ids.traceSession },
      prepare: async (page) => {
        await page.getByRole("tab", { name: /^(Rastro|Trace)$/ }).click();
        await page.getByRole("button", { name: "Replay" }).click();
        await page.getByRole("button", { name: /^(Próximo|Next)$/ }).click();
        await page.getByRole("button", { name: /^(Próximo|Next)$/ }).click();
        await page.waitForTimeout(500);
      },
    },
    {
      name: "host-telemetria",
      route: { name: "host", host: ALFA },
      prepare: async (page) => {
        await openHostSettings(page);
        await showSection(/^(Telemetria|Telemetry)$/)(page);
      },
    },
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
      // Issue #38: the allowed-folders row, its input and its button on one line.
      name: "host-pastas",
      route: { name: "host", host: ALFA },
      prepare: async (page) => {
        await openHostSettings(page);
        await showSection(/^(Allowed folders|Pastas permitidas)$/)(page);
      },
    },
    {
      // The host's Health & dependencies section, scrolled into view so its colors can be judged.
      name: "host-saude",
      route: { name: "host", host: ALFA },
      prepare: showSection(/^(Health & dependencies|Saúde e dependências)$/),
    },
    {
      name: "host-manutencao",
      route: { name: "host", host: ALFA },
      prepare: async (page) => {
        await openHostSettings(page);
        await showSection(/^(Maintenance|Manutenção)$/)(page);
      },
    },
    {
      name: "cofre-backup",
      route: { name: "vault" },
      prepare: async (page) => {
        await page.getByRole("tab", { name: "Backup" }).click();
        await page.waitForTimeout(400);
      },
    },
    // Phase 29: the clients' screen, the switcher open, Sessões for one client, and Custos by client.
    { name: "clientes", route: { name: "clients" }, clients: {} },
    {
      name: "seletor-de-clientes",
      route: { name: "hub" },
      clients: {},
      prepare: async (page) => {
        await page.getByRole("button", { name: /^(Cliente|Client): / }).click();
        await page.waitForTimeout(400);
      },
    },
    { name: "sessoes-do-cliente", route: { name: "hub" }, clients: { selected: "acme" } },
    {
      name: "custos-por-cliente",
      route: { name: "costs" },
      clients: {},
      prepare: async (page) => {
        await page
          .getByRole("combobox", { name: /^(Host dos custos|Costs host)/ })
          .selectOption("__all__");
        await page.waitForTimeout(1500);
      },
    },
    { name: "simples-inicio", route: { name: "hub" }, simple: true },
    {
      name: "simples-tarefa-espera",
      route: { name: "hub" },
      simple: true,
      prepare: async (page) => {
        await page
          .getByRole("button", { name: /Testes do backend/ })
          .first()
          .click();
        // The pointer stays where the click was, over the new screen's button: its hover color
        // is not the one the print (and the contrast check) should see.
        await page.mouse.move(1000, 700);
        await page.waitForTimeout(800);
      },
    },
    {
      name: "simples-tarefa-pronta",
      route: { name: "hub" },
      simple: true,
      prepare: async (page) => {
        await page
          .getByRole("button", { name: /Revisão do PR 128/ })
          .first()
          .click();
        // The pointer stays where the click was, over the new screen's button: its hover color
        // is not the one the print (and the contrast check) should see.
        await page.mouse.move(1000, 700);
        await page.waitForTimeout(800);
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
      // Issue #105: the project page with its session tiles; it fails if no tile shows.
      name: "projeto-blocos",
      route: { name: "project", host: ALFA, projectId: ids.project },
      prepare: async (page) => {
        await page.locator("[data-slot='session-tile']").first().waitFor({ timeout: 15_000 });
      },
    },
    {
      // Issue #669: the Board screen of a host, its projects as cards with their counts.
      name: "board-projetos",
      route: { name: "projects", host: ALFA, focus: "board" },
      prepare: async (page) => {
        await page.locator("[data-slot='board-card']").first().waitFor({ timeout: 15_000 });
      },
    },
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
      const normalize = (node: Node) => {
        const text = node.nodeValue ?? "";
        const next = rules.reduce(
          (out, [source, flags, to]) => out.replace(new RegExp(source, flags), to),
          text,
        );
        if (next !== text) node.nodeValue = next;
      };
      const walk = (root: Node) => {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) normalize(node);
      };
      walk(document.body);
      // A screen that re-renders a time ("9 min ago" to "10 min ago") writes the raw text back:
      // every change is normalized again before it is painted.
      new MutationObserver((changes) => {
        for (const change of changes) {
          if (change.type === "characterData") normalize(change.target);
          for (const added of change.addedNodes) {
            if (added.nodeType === Node.TEXT_NODE) normalize(added);
            else walk(added);
          }
        }
      }).observe(document.body, { characterData: true, childList: true, subtree: true });
    },
    VOLATILE_RULES.map(([pattern, to]) => [pattern.source, pattern.flags, to] as const),
  );
}

/**
 * Runs in the page: the page's background as sRGB, whatever CSS color syntax computes to (oklch,
 * color-mix...), read back from a canvas pixel.
 */
function pageBackground(): Rgb {
  const style = getComputedStyle(document.body);
  const paint = style.backgroundColor === "rgba(0, 0, 0, 0)" ? "white" : style.backgroundColor;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  ctx.fillStyle = paint;
  ctx.fillRect(0, 0, 1, 1);
  const [r = 255, g = 255, b = 255] = ctx.getImageData(0, 0, 1, 1).data;
  return [r, g, b];
}

/** What the page storage starts with, for the init script of a print. */
interface StorageSeed {
  clients: { clients: string; selected: string } | null;
  roi: string | null;
  inbox: string | null;
  simple: boolean;
}

/** Runs in the page before it loads (so it holds no outside names): the storage of a print. */
function seedStorage(seed: StorageSeed): void {
  try {
    const keys = ["flightdeck.clients", "flightdeck.clientFilter"];
    for (const key of [
      ...keys,
      "flightdeck.clientBudgetAlerts",
      "flightdeck.roi",
      "flightdeck.uiMode",
      "flightdeck.inbox",
      // The "barra-recolhida" print folds the sidebar, and the fold is kept: not into the next print.
      "flightdeck.sidebarFolded",
    ]) {
      localStorage.removeItem(key);
    }
    if (seed.simple) {
      localStorage.setItem("flightdeck.uiMode", JSON.stringify({ "demo-alfa": "simple" }));
    }
    if (seed.clients) {
      localStorage.setItem(keys[0] as string, seed.clients.clients);
      if (seed.clients.selected) {
        localStorage.setItem(keys[1] as string, seed.clients.selected);
      }
    }
    if (seed.roi) localStorage.setItem("flightdeck.roi", seed.roi);
    if (seed.inbox) localStorage.setItem("flightdeck.inbox", seed.inbox);
  } catch {
    // No storage, no clients.
  }
}

/** The layout findings that fail a print: sideways scroll, a gap, a region without room. */
const blocksPrint = (finding: Finding) =>
  finding.rule === "sideways" || finding.rule === "gap" || finding.rule.startsWith("region-");

/** Where and how the prints of one theme and language are taken. */
interface PrintSetup {
  url: string;
  theme: Parameters<typeof themeProblem>[0];
  lang: string;
  dir: string;
  visual: VisualMode;
  log: (msg: string) => void;
  /** The spacing guard's ratchet (#588): its baseline, and what this run saw and found gone. */
  spacing: Ratchet;
  /** The narrow-window guard's ratchet (#641). */
  narrow: Ratchet;
}

/** One print and its checks (theme, layout, accessibility); what is wrong goes to `problems`. */
async function printShot(
  context: BrowserContext,
  shot: Shot,
  setup: PrintSetup,
  problems: string[],
): Promise<void> {
  const { url, theme, lang, dir, visual, log, spacing, narrow } = setup;
  const page = await context.newPage();
  page.on("pageerror", (error) => log(`erro na página ${shot.name} ${page.url()}: ${error.stack}`));
  // A print that throws or times out still closes its page (#677).
  try {
    // The storage is the context's: a print with no clients clears what an earlier one kept.
    await page.addInitScript(seedStorage, {
      clients: shot.clients
        ? { clients: DEMO_CLIENTS, selected: shot.clients.selected ?? "" }
        : null,
      roi: shot.roi ? DEMO_ROI : null,
      inbox: shot.inbox ? demoInbox(lang) : null,
      simple: shot.simple === true,
    });
    const query = new URLSearchParams({
      theme,
      lang,
      route: JSON.stringify(shot.route),
      ...shot.query,
    });
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
    // A skeleton or a busy region is a screen still loading: the print waits for the real one.
    await page.waitForFunction(
      (selector) => document.querySelector(selector) === null,
      PENDING_SELECTOR,
      { timeout: 15_000 },
    );
    if (visual !== "off") await stabilize(page);
    await page.screenshot({
      path: join(dir, `${shot.name}.png`),
      ...(visual === "off" ? {} : { animations: "disabled" as const, caret: "hide" as const }),
    });
    // A dark print that came out light is a broken print, not a pretty one.
    const mismatch = themeProblem(
      theme,
      `${theme} ${lang} ${shot.name}`,
      await page.evaluate(pageBackground),
    );
    if (mismatch) problems.push(mismatch);
    // The window never scrolls sideways (issue #103) and the key regions have room (#192): the
    // shared guards name the culprit by its data-slot path. What floats in the corner keeps clear
    // of the status bar and of each other (#581).
    const layout: Finding[] = await page.evaluate(layoutFindings, {
      regions: KEY_REGIONS,
      gaps: GAPS,
      spacing: SPACING,
    });
    for (const finding of layout.filter(blocksPrint)) {
      problems.push(
        `${theme} ${lang} ${shot.name}: ${finding.rule} ${finding.path} (${finding.detail})`,
      );
    }
    // The spacing guard (#588): judged against its own baseline, which only goes down.
    const screen = `${theme} ${lang} ${shot.name}`;
    const spaced = layout.filter((finding) => SPACING_RULES.includes(finding.rule));
    problems.push(...ratchetScreen(screen, spaced, spacing));
    // The same screen, checked for accessibility: serious and critical violations fail.
    await page.addScriptTag({ path: AXE });
    const found = await page.evaluate(
      (options) =>
        (
          globalThis as unknown as {
            axe: {
              run(options: unknown): Promise<{ violations: AxeViolation[] }>;
            };
          }
        ).axe
          .run(options)
          .then((result) => result.violations),
      AXE_RUN_OPTIONS,
    );
    for (const violation of blocking(found)) {
      problems.push(describeViolation(`${theme} ${lang} ${shot.name}`, violation));
    }
    // Narrow windows (#641): the same page resized, judged against its own baseline. The contract
    // rules stay at 1280: the page scrolling sideways is overflow-x here, a finding with a baseline.
    for (const size of narrowSizes(theme, shot.name)) {
      await page.setViewportSize(size);
      await page.evaluate(waitForStable, { frames: 3, maxMs: 5000, boxes: GAP_BOXES });
      const at = `${size.width}x${size.height}`;
      await page.screenshot({
        path: join(SHOTS_DIR, `narrow-${theme}-${lang}`, `${shot.name}@${at}.png`),
      });
      const found: Finding[] = await page.evaluate(layoutFindings, { responsive: RESPONSIVE });
      const kept = found.filter((finding) => RESPONSIVE_RULES.includes(finding.rule));
      problems.push(...ratchetScreen(`${theme} ${lang} ${at} ${shot.name}`, kept, narrow));
    }
  } finally {
    await page.close();
  }
}

export async function takeShots(
  url: string,
  ids: DemoIds,
  env: Record<string, string>,
  log: (msg: string) => void,
  visual: VisualMode = "off",
): Promise<string> {
  // All four pairs, or the one a CI job prints (SHOTS_THEME, SHOTS_LANG; #291), refused before
  // Chrome starts when the filter keeps none.
  const variants = pickVariants(process.env);
  // #677: a typo in the narrow list would skip a page in silence.
  const unknown = unknownNarrowShots(shots(ids).map((shot) => shot.name));
  if (unknown.length > 0) {
    throw new Error(`NARROW_SHOTS names no print of demo:shots: ${unknown.join(", ")}`);
  }
  const browser = await launchFirst((attempt) =>
    chromium.launch({ ...attempt, headless: true, env }),
  );
  const problems: string[] = [];
  const ratchet = (file: string): Ratchet => ({
    baseline: loadCounts(
      () => (existsSync(file) ? readFileSync(file, "utf8") : null),
      basename(file),
    ),
    seen: {},
    occurrences: {},
    gone: [],
  });
  const spacing = ratchet(SPACING_BASELINE);
  const narrow = ratchet(NARROW_BASELINE);
  const ratchets: Array<[file: string, findings: string, ratchet: Ratchet]> = [
    [SPACING_BASELINE, "spacing-findings", spacing],
    [NARROW_BASELINE, "responsive-findings", narrow],
  ];
  try {
    await inSequence(variants, async ({ theme, lang }) => {
      const dir = join(SHOTS_DIR, `${theme}-${lang}`);
      mkdirSync(dir, { recursive: true });
      mkdirSync(join(SHOTS_DIR, `narrow-${theme}-${lang}`), { recursive: true });
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
      await inSequence(
        shots(ids).filter((s) => s.name.includes(process.env.DEMO_SHOTS ?? "")),
        (shot) =>
          printShot(
            context,
            shot,
            {
              url,
              theme,
              lang,
              dir,
              visual,
              log,
              spacing,
              narrow,
            },
            problems,
          ),
      );
      await context.close();
      log(`prints ${theme} ${lang}`);
    });
  } finally {
    await browser.close();
    // What the run saw, for the baseline (the screenshots folder is the CI job's artifact), even
    // when a print crashed or timed out.
    mkdirSync(SHOTS_DIR, { recursive: true });
    // The counts are the baseline's format; the occurrences name each finding for a person.
    for (const [, findings, { seen, occurrences }] of ratchets) {
      writeFileSync(join(SHOTS_DIR, `${findings}.json`), JSON.stringify(seen, null, 2));
      writeFileSync(
        join(SHOTS_DIR, `${findings}-occurrences.json`),
        JSON.stringify(occurrences, null, 2),
      );
      log(`${findings}: ${Object.keys(occurrences).length} findings`);
    }
  }
  for (const [file, , { gone }] of ratchets) {
    if (gone.length > 0) {
      problems.push(
        `${basename(file)} holds more findings, or a worse worst px, than this run saw: lower or remove\n${gone.join("\n")}`,
      );
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `prints: ${problems.length} problems (axe serious or critical, a background that does not match the theme, or a page that scrolls sideways)\n${problems.join("\n")}`,
    );
  }
  return SHOTS_DIR;
}
