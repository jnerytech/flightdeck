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
import type { DemoIds } from "./demo-seed.ts";
import {
  AXE_RUN_OPTIONS,
  type AxeViolation,
  blocking,
  describeViolation,
} from "./lib/browser/axe.ts";
import { launchFirst } from "./lib/browser/browser.ts";
import { type VisualMode, VOLATILE_RULES } from "./lib/browser/visual.ts";
import { demoFinished, demoInbox } from "./lib/demo/seeds.ts";
import { DEMO_AWAY_SINCE } from "./lib/e2e/journeys.ts";
import { holdsScript } from "./lib/shots/holds.ts";
import { PENDING_SELECTOR } from "./lib/shots/loaded.ts";
import { narrowSizes, unknownNarrowShots } from "./lib/shots/narrow.ts";
import { ALFA, DEMO_CLIENTS, DEMO_ROI, type Shot } from "./lib/shots/shot.ts";
import { agentShots } from "./lib/shots/table-agent.ts";
import { boardShots } from "./lib/shots/table-board.ts";
import { hostShots } from "./lib/shots/table-hosts.ts";
import { shellShots } from "./lib/shots/table-shell.ts";
import { pickVariants } from "./lib/shots/variants.ts";
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
} from "./lib/styles/layout-guards.ts";
import { type Rgb, themeProblem } from "./lib/styles/print-theme.ts";

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

/** The prints, in print order: each table is a stretch of the list, so the order is the tables' order. */
function shots(ids: DemoIds): Shot[] {
  return [...shellShots(ids), ...boardShots(ids), ...agentShots(ids), ...hostShots(ids)];
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
  finished: string | null;
  /** The time the app was last active, long ago: Needs you shows "While you were away" (#1344). */
  away: string | null;
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
      "flightdeck.finished",
      "flightdeck.lastActive",
      // The "barra-recolhida" print folds the sidebar, and the fold is kept: not into the next print.
      "flightdeck.sidebarFolded",
      // Every scoped screen reads the data scope (#126): a print that picks a host does not scope the next.
      "flightdeck.dataScope",
      // configuracoes-backup-agenda (#1328) turns the schedule on and picks the demo folder: not for the next.
      "flightdeck.backupSchedule",
      "flightdeck.demoBackupFolder",
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
    if (seed.finished) localStorage.setItem("flightdeck.finished", seed.finished);
    if (seed.away) localStorage.setItem("flightdeck.lastActive", seed.away);
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
  /** The demo's ids: the bell's print links a row to the open request of `waitingSession` (#1168). */
  ids: DemoIds;
}

/** One print and its checks (theme, layout, accessibility); what is wrong goes to `problems`. */
async function printShot(
  context: BrowserContext,
  shot: Shot,
  setup: PrintSetup,
  problems: string[],
): Promise<void> {
  const { url, theme, lang, dir, visual, log, spacing, narrow, ids } = setup;
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
      inbox: shot.inbox ? demoInbox(lang, { hostId: ALFA, requestId: ids.waitingRequest }) : null,
      finished: shot.finished
        ? demoFinished(
            { hostId: ALFA, sessionId: ids.idleSession, name: "Revisão do PR 128" },
            new Date(),
          )
        : null,
      away: shot.away ? DEMO_AWAY_SINCE : null,
      simple: shot.simple === true,
    });
    const query = new URLSearchParams({
      theme,
      lang,
      route: JSON.stringify(shot.route),
      ...shot.query,
    });
    // Playwright's routeWebSocket never saw the app's sockets under Bun: the page's own WebSocket is
    // wrapped instead.
    if (shot.holds) await page.addInitScript({ content: holdsScript() });
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
      await page.setViewportSize(size); // NOSONAR: one window size at a time on the same page
      await page.evaluate(waitForStable, { frames: 3, maxMs: 5000, boxes: GAP_BOXES }); // NOSONAR: the layout must settle at this size before the shot
      const at = `${size.width}x${size.height}`;
      const shooting = page.screenshot({
        path: join(SHOTS_DIR, `narrow-${theme}-${lang}`, `${shot.name}@${at}.png`),
      });
      await shooting; // NOSONAR: the shot is taken before the window is resized again
      const measuring = page.evaluate(layoutFindings, { responsive: RESPONSIVE });
      const found: Finding[] = await measuring; // NOSONAR: measured at this size, before the next one
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
              ids,
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
