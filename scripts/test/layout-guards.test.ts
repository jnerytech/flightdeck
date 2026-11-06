import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { registerDom } from "../../apps/desktop/test/dom.ts";
import {
  compareToBaseline,
  findingKey,
  GAPS,
  layoutFindings,
  pinnedProblem,
  SPACING,
  SPACING_RULES,
} from "../lib/layout-guards.ts";

registerDom();

/**
 * happy-dom has no layout: a test says where each box is with `data-rect="left,top,right,bottom"`
 * and how much it scrolls with `data-sw` (scrollWidth) and `data-cw` (clientWidth).
 */
const proto = window.Element.prototype as unknown as Record<string, unknown>;
const htmlProto = window.HTMLElement.prototype as unknown as Record<string, unknown>;
const saved = new Map<string, PropertyDescriptor | undefined>();
const NAMES = ["getBoundingClientRect", "scrollWidth", "clientWidth"];

beforeEach(() => {
  for (const name of NAMES) saved.set(name, Object.getOwnPropertyDescriptor(proto, name));
  const num = (el: Element, attr: string, fallback: number) =>
    Number(el.getAttribute(attr) ?? fallback);
  Object.defineProperty(proto, "getBoundingClientRect", {
    configurable: true,
    value(this: Element) {
      const [left = 0, top = 0, right = 0, bottom = 0] = (this.getAttribute("data-rect") ?? "")
        .split(",")
        .map(Number);
      return {
        left,
        top,
        right,
        bottom,
        width: right - left,
        height: bottom - top,
        x: left,
        y: top,
      };
    },
  });
  Object.defineProperty(proto, "scrollWidth", {
    configurable: true,
    get(this: Element) {
      return num(this, "data-sw", num(this, "data-cw", 0));
    },
  });
  Object.defineProperty(proto, "clientWidth", {
    configurable: true,
    get(this: Element) {
      return num(this, "data-cw", 0);
    },
  });
  // happy-dom defines these on HTMLElement, which sits above Element: both are shadowed.
  for (const [name, attr] of [
    ["scrollTop", "data-st"],
    ["clientHeight", "data-ch"],
    ["scrollHeight", "data-sh"],
  ] as const) {
    for (const holder of [proto, htmlProto]) {
      saved.set(
        `${holder === proto ? "E" : "H"}:${name}`,
        Object.getOwnPropertyDescriptor(holder, name),
      );
      Object.defineProperty(holder, name, {
        configurable: true,
        get(this: Element) {
          return num(this, attr, 0);
        },
      });
    }
  }
  // The widths too (#588): the text-spill rule reads both on a block, where happy-dom answers 0.
  for (const [name, read] of [
    ["clientWidth", (el: Element) => num(el, "data-cw", 0)],
    ["scrollWidth", (el: Element) => num(el, "data-sw", num(el, "data-cw", 0))],
  ] as const) {
    saved.set(`H:${name}`, Object.getOwnPropertyDescriptor(htmlProto, name));
    Object.defineProperty(htmlProto, name, {
      configurable: true,
      get(this: Element) {
        return read(this);
      },
    });
  }
  window.innerWidth = 1000;
  window.innerHeight = 700;
});

afterEach(() => {
  for (const [key, descriptor] of saved) {
    const holder = key.startsWith("H:") ? htmlProto : proto;
    const name = key.replace(/^[EH]:/, "");
    if (descriptor) Object.defineProperty(holder, name, descriptor);
    else delete holder[name];
  }
  saved.clear();
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("data-sw");
  document.documentElement.removeAttribute("data-cw");
});

const page = (html: string) => {
  document.body.innerHTML = html;
};
const rules = () => layoutFindings().map((f) => `${f.rule}: ${f.path}`);

describe("layout-guards: what the page function finds, named by data-slot path", () => {
  test("the page scrolls sideways, and the widest element is the culprit", () => {
    document.documentElement.setAttribute("data-sw", "2000");
    document.documentElement.setAttribute("data-cw", "1000");
    page(
      '<div data-slot="sidebar" data-rect="0,0,300,700"><ul data-slot="sidebar-hosts" data-rect="0,0,2000,50"></ul></div>',
    );
    expect(rules()).toContain("sideways: sidebar > sidebar-hosts");
  });

  test("a box cut by an ancestor that clips is found, and one under a scrolling ancestor is not", () => {
    page(`
      <main data-slot="main" style="overflow-x:hidden;overflow-y:hidden" data-rect="0,0,500,500">
        <div data-slot="card" data-rect="400,10,700,40"></div>
      </main>
      <div data-slot="strip" style="overflow-x:auto" data-rect="0,0,500,500">
        <div data-slot="tabs" data-rect="400,10,900,40"></div>
      </div>`);
    expect(rules()).toEqual(["clipped: main > card"]);
  });

  test("a fixed overlay and a screen-reader-only box are not clipped boxes", () => {
    page(`
      <main data-slot="main" style="overflow-x:hidden;overflow-y:hidden" data-rect="0,0,500,500">
        <div data-slot="toast" style="position:fixed" data-rect="400,10,900,40"></div>
        <span style="position:absolute;width:1px;height:1px" data-rect="498,0,499,1">skip</span>
      </main>`);
    expect(rules()).toEqual([]);
  });

  test("a region with content squeezed under 8 px is collapsed; an empty one, or one that is not shown, is not", () => {
    page(`
      <div data-slot="sidebar" data-rect="0,0,300,700">
        <ul data-slot="sidebar-hosts" data-rect="0,100,300,100"><li>alfa</li></ul>
        <ul data-slot="sidebar-pinned" data-rect="0,100,300,100"></ul>
        <ul data-slot="sidebar-gone" style="display:none" data-rect="0,100,300,100"><li>x</li></ul>
      </div>`);
    expect(rules()).toEqual(["collapsed: sidebar > sidebar-hosts"]);
  });

  test("text cut to under 48 px with an ellipsis is over-truncated", () => {
    page(
      '<nav data-slot="breadcrumb"><span data-slot="crumb" style="overflow:hidden;text-overflow:ellipsis" data-sw="120" data-cw="30" data-rect="0,0,30,20">long name</span></nav>',
    );
    expect(rules()).toEqual(["truncated: breadcrumb > crumb"]);
  });

  test("an alert that is below the screen is not fully visible", () => {
    page('<div role="alert" data-slot="notice" data-rect="10,650,400,740">careful</div>');
    expect(rules()).toEqual(["attention: notice"]);
  });

  test("an alert cut by any edge of the screen is found, with its box; one fully inside is not", () => {
    const edge = (rect: string) => {
      page(`<div data-attention data-slot="notice" data-rect="${rect}">careful</div>`);
      return layoutFindings().map((f) => `${f.rule}: ${f.path} (${f.detail})`);
    };
    // The page is 1000 x 700 (beforeEach): left, top, right, bottom.
    expect(edge("-5,100,300,140")).toEqual(["attention: notice (box -5,100 to 300,140)"]);
    expect(edge("10,-3,300,40")).toEqual(["attention: notice (box 10,-3 to 300,40)"]);
    expect(edge("700,100,1010,140")).toEqual(["attention: notice (box 700,100 to 1010,140)"]);
    expect(edge("10,100,300,140")).toEqual([]);
  });

  test("a bar that grew past its limit is found", () => {
    page('<div class="tab-bar" data-rect="0,0,1000,90"></div>');
    expect(
      layoutFindings({ bars: [{ selector: ".tab-bar", maxHeight: 48 }] }).map((f) => f.rule),
    ).toEqual(["growth"]);
  });

  test("key regions: small is a finding, missing is one only when required, fine is none", () => {
    page(`
      <div data-slot="approval-card" data-rect="0,0,400,20"></div>
      <div data-slot="board-columns" data-rect="0,0,900,300"></div>`);
    const found = layoutFindings({
      regions: [
        { slot: "approval-card", minHeight: 60 },
        { slot: "board-columns", minHeight: 100 },
        { slot: "form-actions", minHeight: 20, required: true },
        { slot: "sidebar-hosts", minHeight: 20 },
      ],
    });
    expect(found.map((f) => `${f.rule}: ${f.path}`)).toEqual([
      "region-small: approval-card",
      "region-missing: form-actions",
    ]);
  });

  test("a gap under the floor between two floating boxes that share columns is a finding, named by the upper one (#581)", () => {
    page(`
      <ol data-sonner-toaster><li data-sonner-toast data-rect="900,700,1260,760"></li></ol>
      <section data-slot="update-card" data-rect="940,764,1260,860"></section>
      <section data-slot="status-bar" data-rect="0,876,1280,900"></section>
      <div data-slot="far-left" data-rect="0,860,200,875"></div>`);
    const gaps = [
      { above: "[data-sonner-toast]", below: '[data-slot="update-card"]', min: 8 },
      { above: '[data-slot="update-card"]', below: '[data-slot="status-bar"]', min: 8 },
      { above: '[data-slot="far-left"]', below: '[data-slot="update-card"]', min: 8 },
    ];
    expect(layoutFindings({ gaps }).map((f) => `${f.rule}: ${f.path} (${f.detail})`)).toEqual([
      "gap: li (4 px above update-card, at least 8)",
    ]);
  });

  test("a box that overlaps the one it must sit above is a gap finding too; one that is gone is not", () => {
    page(`
      <li data-sonner-toast data-rect="900,800,1260,890"></li>
      <section data-slot="status-bar" data-rect="0,876,1280,900"></section>
      <li data-sonner-toast style="display: none" data-rect="900,890,1260,900"></li>`);
    expect(
      layoutFindings({
        gaps: [{ above: "[data-sonner-toast]", below: '[data-slot="status-bar"]', min: 8 }],
      }).map((f) => `${f.rule}: ${f.detail}`),
    ).toEqual(["gap: -14 px above status-bar, at least 8"]);
  });

  test("the floating boxes the guards keep apart: the toasts, the update card and the status bar (#581)", () => {
    expect(GAPS).toEqual([
      { above: "[data-sonner-toast]", below: '[data-slot="status-bar"]', min: 8 },
      { above: "[data-sonner-toast]", below: '[data-slot="update-card"]', min: 8 },
      { above: '[data-slot="update-card"]', below: '[data-slot="status-bar"]', min: 8 },
    ]);
  });

  test("a region that scrolls as one: a second scroller inside it is a finding, a single one is not (#567)", () => {
    const split = () =>
      layoutFindings({ single: ["sidebar"] })
        .filter((f) => f.rule === "scroll-split")
        .map((f) => `${f.path}: ${f.detail}`);
    page(`
      <aside data-slot="sidebar" data-rect="0,0,240,600" style="overflow-y: auto">
        <nav data-slot="sidebar-nav" data-rect="0,40,240,300" style="overflow-y: auto"></nav>
        <div data-slot="sidebar-hosts" data-rect="0,300,240,500" style="overflow-y: scroll"></div>
        <div data-slot="sidebar-foot" data-rect="0,500,240,600" style="overflow-y: hidden"></div>
      </aside>`);
    expect(split()).toEqual([
      "sidebar: 3 scroll areas (sidebar, sidebar > sidebar-nav, sidebar > sidebar-hosts)",
    ]);
    page(`
      <aside data-slot="sidebar" data-rect="0,0,240,600" style="overflow-y: hidden">
        <div data-slot="sidebar-body" data-rect="0,40,240,500" style="overflow-y: auto"></div>
      </aside>`);
    expect(split()).toEqual([]);
  });

  const spacing = () =>
    layoutFindings({ spacing: SPACING })
      .filter((f) => SPACING_RULES.includes(f.rule))
      .map((f) => `${f.rule}: ${f.path} (${f.detail})`);

  test("spacing (#588): the page body's blocks sit at least 8 px apart, stacked or side by side", () => {
    page(`
      <div data-slot="page-body" data-rect="0,0,1000,800">
        <div data-slot="links" data-rect="0,0,1000,100"></div>
        <div data-slot="config" data-rect="0,103,1000,300"></div>
        <div data-slot="left" data-rect="0,320,495,500"></div>
        <div data-slot="right" data-rect="500,320,1000,500"></div>
        <div data-slot="after" data-rect="0,524,1000,600"></div>
        <div data-slot="gone" style="display: none" data-rect="0,600,1000,601"></div>
      </div>`);
    expect(spacing()).toEqual([
      "block-gap: page-body > config (3 px under links, at least 8)",
      "block-gap: page-body > right (5 px beside left, at least 8)",
    ]);
  });

  test("spacing (#588): sibling cards keep 8 px between them; a card and its own content are not siblings", () => {
    page(`
      <div data-slot="grid" data-rect="0,0,1000,400">
        <div data-slot="card" data-rect="0,0,330,100"><div data-slot="card-content" data-rect="16,16,314,84"></div></div>
        <div data-slot="card" data-rect="334,0,664,100"></div>
        <div data-slot="card" data-rect="0,112,330,200"></div>
      </div>`);
    expect(spacing()).toEqual(["card-gap: grid > card[2] (4 px beside card[1], at least 8)"]);
  });

  test("spacing (#588): text in a card keeps 8 px of padding, and text that spills its own box is a finding", () => {
    page(`
      <div data-slot="card" data-rect="0,0,400,200">
        <p data-slot="title" data-rect="24,24,376,44">Hooks</p>
        <code data-slot="hook-command" data-rect="4,60,396,80">bun run a-very-long-command</code>
        <span data-slot="cut" style="overflow-x: hidden" data-rect="24,90,376,110" data-sw="500" data-cw="352">x</span>
        <pre data-slot="spill" data-rect="24,120,376,140" data-sw="600" data-cw="352">long line</pre>
      </div>`);
    expect(spacing()).toEqual([
      "text-spill: card > spill (248 px past its box)",
      "card-padding: card > hook-command (4 px from the card's left edge, at least 8)",
    ]);
  });

  test("spacing (#588): chips in a row keep 4 px between them, and a row under another its own gap", () => {
    page(`
      <div data-slot="chips" data-rect="0,0,400,60">
        <span data-slot="badge" data-rect="0,0,60,20">a</span>
        <span data-slot="badge" data-rect="62,0,120,20">b</span>
        <span data-slot="badge" data-rect="128,0,200,20">c</span>
        <span data-slot="badge" data-rect="0,30,60,50">d</span>
      </div>`);
    expect(spacing()).toEqual(["chip-gap: chips > badge[2] (2 px beside badge[1], at least 4)"]);
  });

  test("spacing (#588): two boxes that overlap are a finding, by how far they run into each other", () => {
    page(`
      <div data-slot="chips" data-rect="0,0,400,30">
        <span data-slot="badge" data-rect="0,0,60,20">a</span>
        <span data-slot="badge" data-rect="50,0,110,20">b</span>
      </div>`);
    expect(spacing()).toEqual(["chip-gap: chips > badge[2] (-10 px over badge[1], at least 4)"]);
  });

  test("spacing (#588): each finding names its element by number, so two tight pairs in a row or two tiles stay two findings", () => {
    page(`
      <div data-slot="chips" data-rect="0,0,400,30">
        <span data-slot="badge" data-rect="0,0,60,20">a</span>
        <span data-slot="badge" data-rect="62,0,120,20">b</span>
        <span data-slot="badge" data-rect="140,0,200,20">c</span>
        <span data-slot="badge" data-rect="202,0,260,20">d</span>
      </div>
      <ul data-rect="0,40,800,200">
        <li data-rect="0,40,390,200"><div data-slot="session-tile" data-rect="0,40,390,200">
          <span data-rect="8,48,382,60" data-sw="500" data-cw="374">first line</span>
        </div></li>
        <li data-rect="400,40,790,200"><div data-slot="session-tile" data-rect="400,40,790,200">
          <span data-rect="408,48,782,60">short</span>
          <span data-rect="408,62,782,74" data-sw="600" data-cw="374">second line</span>
        </div></li>
      </ul>`);
    expect(spacing()).toEqual([
      "text-spill: session-tile[1] > span (126 px past its box)",
      "text-spill: session-tile[2] > span[2] (226 px past its box)",
      "chip-gap: chips > badge[2] (2 px beside badge[1], at least 4)",
      "chip-gap: chips > badge[4] (2 px beside badge[3], at least 4)",
    ]);
  });

  test("spacing (#588): card padding counts from where an element's text starts, inside its own padding", () => {
    page(`
      <div data-slot="card" data-rect="0,0,400,200">
        <header data-slot="card-header" style="padding: 12px 24px" data-rect="0,0,400,48">Project configuration</header>
        <p data-slot="flush" data-rect="0,60,400,80">edge to edge</p>
      </div>`);
    expect(spacing()).toEqual([
      "card-padding: card > flush (0 px from the card's left edge, at least 8)",
    ]);
  });

  test("spacing (#588): the rules are heuristic, judged against a baseline; with none they fail nothing", () => {
    const tight = { rule: "block-gap" as const, path: "page-body > config", detail: "3 px" };
    expect(judge("dark en projeto", [tight], null).failures).toEqual([]);
    expect(judge("dark en projeto", [tight], {}).failures).toEqual([
      "dark en projeto: block-gap page-body > config (3 px)",
    ]);
    // None of them is in the contract: with no baseline, a finding of each rule fails nothing.
    const each = SPACING_RULES.map((rule) => ({ rule, path: "page-body > x", detail: "1 px" }));
    expect(judge("dark en projeto", each, null).failures).toEqual([]);
  });

  test("an element with no slot is named by its tag and first class", () => {
    page(
      '<main data-slot="main"><div class="flex min-h-0" data-rect="0,0,100,0"><b>x</b></div></main>',
    );
    expect(rules()).toEqual(["collapsed: main > div.flex"]);
  });
});

describe("layout-guards: the baseline keeps heuristic findings quiet and only lets them go down", () => {
  const finding = (path: string, detail = "x") => ({ rule: "clipped" as const, path, detail });

  test("the key is the rule, the screen and the path: no text, no pixels", () => {
    expect(findingKey("board@720", finding("main > card", "12 px of text"))).toBe(
      "clipped|board@720|main > card",
    );
  });

  test("a finding that is not in the baseline is new, and one the baseline holds that is gone is fixed", () => {
    const baseline = { "clipped|board@720|main > old": true as const };
    const result = compareToBaseline("board@720", [finding("main > card")], baseline);
    expect(result.fresh.map((f) => f.path)).toEqual(["main > card"]);
    expect(result.fixed).toEqual(["clipped|board@720|main > old"]);
    expect(compareToBaseline("board@720", [finding("main > old")], baseline).fresh).toEqual([]);
  });

  test("the baseline of another screen is not this screen's", () => {
    const baseline = { "clipped|hub@720|main > old": true as const };
    expect(compareToBaseline("board@720", [], baseline).fixed).toEqual([]);
  });
});

import { judge, loadBaseline } from "../lib/layout-guards.ts";

describe("layout-guards: what the findings mean for the build", () => {
  const clipped = { rule: "clipped" as const, path: "main > card", detail: "cut" };
  const small = { rule: "region-small" as const, path: "approval-card", detail: "400 x 20 px" };

  test("a gap finding fails with no baseline too: it is the contract (#581)", () => {
    const gap = { rule: "gap" as const, path: "li", detail: "4 px above status-bar, at least 8" };
    expect(judge("hub@1280", [gap], null).failures).toEqual([
      "hub@1280: gap li (4 px above status-bar, at least 8)",
    ]);
  });

  test("a region split into several scroll areas fails with no baseline too: it is the contract (#567)", () => {
    const split = { rule: "scroll-split" as const, path: "sidebar", detail: "2 scroll areas" };
    expect(judge("home@1280x600", [split], null).failures).toEqual([
      "home@1280x600: scroll-split sidebar (2 scroll areas)",
    ]);
  });

  test("a key region that is small fails with no baseline too: it is the contract", () => {
    expect(judge("needs-you@1280", [small], null).failures).toEqual([
      "needs-you@1280: region-small approval-card (400 x 20 px)",
    ]);
  });

  test("heuristic findings fail nothing until there is a baseline, then only the new ones", () => {
    expect(judge("board@720", [clipped], null).failures).toEqual([]);
    expect(judge("board@720", [clipped], {}).failures).toEqual([
      "board@720: clipped main > card (cut)",
    ]);
    expect(
      judge("board@720", [clipped], { "clipped|board@720|main > card": true }).failures,
    ).toEqual([]);
  });

  test("a baseline entry whose finding is gone comes back as fixed, for the baseline to go down", () => {
    expect(judge("board@720", [], { "clipped|board@720|main > card": true }).fixed).toEqual([
      "clipped|board@720|main > card",
    ]);
  });

  test("the baseline file is read as its keys; no file is no baseline", () => {
    expect(loadBaseline(() => null)).toBeNull();
    expect(loadBaseline(() => '{"clipped|a@1|x":"main > card"}')).toEqual({
      "clipped|a@1|x": true,
    });
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { KEY_REGIONS, SINGLE_SCROLL } from "../lib/layout-guards.ts";

describe("layout-guards: the key regions carry the data-slot the guards look for (a cheap guard on the source)", () => {
  const sources = [
    "components/approval/approval-card.tsx",
    "ui/Sidebar.tsx",
    "ui/BoardView.tsx",
    "components/layout/form.tsx",
  ].map((file) => readFileSync(join(import.meta.dir, "../../apps/desktop/src", file), "utf8"));

  test("each key region is named in the page it belongs to", () => {
    for (const { slot } of KEY_REGIONS) {
      expect(sources.some((text) => text.includes(`data-slot="${slot}"`))).toBe(true);
    }
  });

  test("each region that scrolls as one is named in the shell (#567)", () => {
    const shell = readFileSync(
      join(import.meta.dir, "../../apps/desktop/src/components/layout/app-shell.tsx"),
      "utf8",
    );
    for (const slot of SINGLE_SCROLL) {
      expect([slot, shell.includes(`data-slot="${slot}"`)]).toEqual([slot, true]);
    }
  });
});

import { GAP_BOXES, waitForStable } from "../lib/layout-guards.ts";

describe("layout-guards: a layout that settles late is waited for, not guessed with a fixed wait", () => {
  /** The page height the next frames will report, one entry per frame. */
  function heights(values: number[]) {
    let at = 0;
    Object.defineProperty(document.documentElement, "scrollHeight", {
      configurable: true,
      get: () => values[Math.min(at++, values.length - 1)] ?? 0,
    });
    return () => at;
  }
  afterEach(() => {
    Reflect.deleteProperty(document.documentElement, "scrollHeight");
  });

  test("it resolves once the height held for three frames in a row, and says how many", async () => {
    heights([100, 100, 120, 130, 130, 130, 130, 130]);
    const settled = await waitForStable({ frames: 3, maxMs: 2000 });
    expect(settled).toEqual({ stable: true, frames: 3 });
  });

  test("a page that keeps growing is given up on at the time limit, and says it did not settle", async () => {
    let n = 0;
    Object.defineProperty(document.documentElement, "scrollHeight", {
      configurable: true,
      get: () => 100 + n++,
    });
    const settled = await waitForStable({ frames: 3, maxMs: 120 });
    expect(settled.stable).toBe(false);
  });

  /** A toast over the status bar (top at 800) whose bottom edge reads the next value on each read. */
  function slidingToast(bottoms: number[]) {
    document.body.innerHTML = `
      <div data-sonner-toast data-rect="1500,700,1900,780">saved</div>
      <div data-slot="status-bar" data-rect="0,800,1920,824"></div>`;
    const toast = document.querySelector("[data-sonner-toast]") as Element;
    let at = 0;
    Object.defineProperty(toast, "getBoundingClientRect", {
      configurable: true,
      value: () => {
        const bottom = bottoms[Math.min(at++, bottoms.length - 1)] ?? 0;
        return { left: 1500, right: 1900, top: bottom - 80, bottom, width: 400, height: 80 };
      },
    });
  }
  const gapFindings = () =>
    layoutFindings({ gaps: GAPS })
      .filter((f) => f.rule === "gap")
      .map((f) => `${f.path}: ${f.detail}`);

  test("issue #655: a toast still sliding in is waited for: one that reads 7 px and settles at 8 is no finding", async () => {
    heights([100]);
    slidingToast([793, 792.5, 792, 792, 792, 792, 792]);
    const settled = await waitForStable({ frames: 3, maxMs: 2000, boxes: GAP_BOXES });
    expect(settled.stable).toBe(true);
    expect(gapFindings()).toEqual([]);
  });

  test("issue #655: the gap rule allows half a pixel of rounding, and no more", () => {
    slidingToast([792.4]);
    expect(gapFindings()).toEqual([]);
    slidingToast([792.6]);
    expect(gapFindings()).toEqual(["div: 7 px above status-bar, at least 8"]);
  });
});

describe("layout-guards: where a session opens (issues #173 and #456)", () => {
  /** A timeline 300 px tall at 100..400 that scrolls `st` of `sh`, with an optional request card. */
  const session = (st: number, sh: number, card?: string) => {
    document.body.innerHTML = `<div data-slot="timeline" data-rect="0,100,800,400" data-st="${st}" data-ch="300" data-sh="${sh}">${
      card ? `<div data-request-id="r1" data-rect="${card}"></div>` : ""
    }</div>`;
    return pinnedProblem();
  };

  test("a conversation at its end, with its request whole, is fine", () => {
    expect(session(200, 500, "0,250,800,390")).toBeNull();
  });

  test("a conversation that stops short of its end, with no request to explain it, is a problem", () => {
    expect(session(100, 500)).toBe("the timeline is not at its end (400 of 500)");
  });

  test("a request taller than the window stops the view at its top: that is not a problem", () => {
    // 340 px of card in a 300 px window: the end is 40 px further, the card's top is at the edge.
    expect(session(160, 500, "0,100,800,440")).toBeNull();
  });

  test("a request that fits, with the view short of the end, is still a problem", () => {
    expect(session(100, 500, "0,150,800,300")).toBe("the timeline is not at its end (400 of 500)");
  });

  test("a request whose top is cut above the window is a problem", () => {
    expect(session(200, 500, "0,60,800,300")).toBe(
      "the request card (60..300) is cut by the timeline (100..400)",
    );
  });

  test("a request that fits but is cut at the bottom is a problem", () => {
    expect(session(200, 500, "0,250,800,450")).toBe(
      "the request card (250..450) is cut by the timeline (100..400)",
    );
  });

  test("no timeline is named as such", () => {
    document.body.innerHTML = "";
    expect(pinnedProblem()).toBe("no timeline");
  });
});
