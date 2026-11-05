import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { registerDom } from "../../apps/desktop/test/dom.ts";
import { compareToBaseline, findingKey, layoutFindings } from "../lib/layout-guards.ts";

registerDom();

/**
 * happy-dom has no layout: a test says where each box is with `data-rect="left,top,right,bottom"`
 * and how much it scrolls with `data-sw` (scrollWidth) and `data-cw` (clientWidth).
 */
const proto = window.Element.prototype as unknown as Record<string, unknown>;
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
  window.innerWidth = 1000;
  window.innerHeight = 700;
});

afterEach(() => {
  for (const [name, descriptor] of saved) {
    if (descriptor) Object.defineProperty(proto, name, descriptor);
    else delete proto[name];
  }
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
import { KEY_REGIONS } from "../lib/layout-guards.ts";

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
});

import { waitForStable } from "../lib/layout-guards.ts";

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
});
