import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type CountEntry,
  compareToBaseline,
  confirmGaps,
  type Finding,
  findingKey,
  GAP_BOXES,
  GAPS,
  judge,
  KEY_REGIONS,
  layoutFindings,
  loadBaseline,
  loadCounts,
  PAGE_AREA,
  pinnedProblem,
  type Ratchet,
  RESPONSIVE,
  RESPONSIVE_RULES,
  ratchetScreen,
  SINGLE_SCROLL,
  SPACING,
  SPACING_RULES,
  waitForStable,
} from "../../lib/styles/layout-guards.ts";
import { readStyles } from "../../lib/styles/styles-source.ts";
import { installLayoutStubs, page } from "./layout-guards-setup.ts";

installLayoutStubs();

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
describe("layout-guards: the key regions carry the data-slot the guards look for (a cheap guard on the source)", () => {
  const sources = [
    "features/permissions/approval-card.tsx",
    "features/shell/sidebar.tsx",
    "features/board/board-view.tsx",
    "shared/layout/form.tsx",
  ].map((file) => readFileSync(join(import.meta.dir, "../../../apps/desktop/src", file), "utf8"));

  test("each key region is named in the page it belongs to", () => {
    for (const { slot } of KEY_REGIONS) {
      expect(sources.some((text) => text.includes(`data-slot="${slot}"`))).toBe(true);
    }
  });

  // #785: the area around a screen scrolls only for a screen that is not a Page.
  test("the area that holds a screen is named, and stops scrolling when the screen is a Page", () => {
    const areas = readFileSync(
      join(import.meta.dir, "../../../apps/desktop/src/app/Areas.tsx"),
      "utf8",
    );
    const css = readStyles(join(import.meta.dir, "../../../apps/desktop/src/styles.css"));
    const rule = css.split(`@utility ${PAGE_AREA} {`)[1]?.split(/\n}\n/)[0] ?? "";
    const journeys = readFileSync(join(import.meta.dir, "../../e2e/journeys.ts"), "utf8");
    expect({
      named:
        areas.includes(`data-slot="${PAGE_AREA}"`) &&
        areas.includes(`className="@container ${PAGE_AREA}"`),
      scrolls: rule.includes("overflow-y: auto"),
      notAroundPage: /&:has\(\[data-slot="page"\]\) \{\s*overflow: hidden;/.test(rule),
      guarded: journeys.includes("pageArea: PAGE_AREA"),
    }).toEqual({ named: true, scrolls: true, notAroundPage: true, guarded: true });
  });

  test("each region that scrolls as one is named in the shell (#567)", () => {
    const shell = readFileSync(
      join(import.meta.dir, "../../../apps/desktop/src/features/shell/app-shell.tsx"),
      "utf8",
    );
    for (const slot of SINGLE_SCROLL) {
      expect([slot, shell.includes(`data-slot="${slot}"`)]).toEqual([slot, true]);
    }
  });
});
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
describe("layout-guards: one screen against a ratchet of counts, as demo:shots runs it (#641)", () => {
  const S = "dark en 640x800 board";
  const wide = (path: string, group: string, detail: string) => ({
    rule: "overflow-x" as const,
    path,
    group,
    detail,
  });
  const fresh = (baseline: Record<string, CountEntry> | null) => ({
    baseline,
    seen: {} as Ratchet["seen"],
    occurrences: {} as Record<string, string>,
    gone: [] as string[],
  });

  test("a key counts its findings under the path with no numbers: one more than the baseline fails, naming each", () => {
    const ratchet = fresh({
      [`overflow-x|${S}|tab-strip > tab`]: 1,
      [`overflow-x|${S}|page > old`]: 2,
      [`overflow-x|${S}|page > two`]: 2,
    });
    const failures = ratchetScreen(
      S,
      [
        wide("tab-strip > tab[1]", "tab-strip > tab", "16 px past the right of tab-strip"),
        wide("tab-strip > tab[2]", "tab-strip > tab", "112 px past the right of tab-strip"),
        wide("page > two[1]", "page > two", "3 px past the right of page"),
      ],
      ratchet,
    );
    expect(failures).toEqual([
      `${S}: overflow-x tab-strip > tab, 2 where the baseline has 1: tab-strip > tab[1] (16 px past the right of tab-strip); tab-strip > tab[2] (112 px past the right of tab-strip)`,
    ]);
    expect(ratchet.seen).toEqual({
      [`overflow-x|${S}|tab-strip > tab`]: { count: 2 },
      [`overflow-x|${S}|page > two`]: { count: 1 },
    });
    expect(ratchet.occurrences).toEqual({
      [`overflow-x|${S}|tab-strip > tab[1]`]: "16 px past the right of tab-strip",
      [`overflow-x|${S}|tab-strip > tab[2]`]: "112 px past the right of tab-strip",
      [`overflow-x|${S}|page > two[1]`]: "3 px past the right of page",
    });
    // Fewer than the baseline: the file must come down with the fix.
    expect(ratchet.gone).toEqual([
      `overflow-x|${S}|page > old: 0 where the baseline has 2: remove it`,
      `overflow-x|${S}|page > two: 1 where the baseline has 2: lower it`,
    ]);
  });

  test("with no baseline a heuristic finding fails nothing, and a contract finding fails anyway", () => {
    const ratchet = fresh(null);
    const gap = { rule: "gap" as const, path: "toast", detail: "3 px above status-bar" };
    expect(ratchetScreen(S, [wide("page > a[1]", "page > a", "9 px"), gap], ratchet)).toEqual([
      `${S}: gap toast (3 px above status-bar)`,
    ]);
    expect(ratchet.gone).toEqual([]);
  });

  test("the spacing and narrow rules carry the path with no numbers, so the count survives a button added above", () => {
    page(`
      <div data-slot="chips" data-rect="0,0,400,30">
        <span data-slot="badge" data-rect="0,0,60,20">a</span>
        <span data-slot="badge" data-rect="62,0,120,20">b</span>
      </div>`);
    const found = layoutFindings({ spacing: SPACING }).filter((f) => f.rule === "chip-gap");
    expect(found.map((f) => `${f.path} / ${f.group}`)).toEqual([
      "chips > badge[2] / chips > badge",
    ]);
  });

  test("#677: a baseline of counts loads as counts; an entry that is not a count, or bad JSON, is refused by file name", () => {
    expect(loadCounts(() => null, "spacing-baseline.json")).toBeNull();
    expect(loadCounts(() => '{"a|s|p": 3}', "spacing-baseline.json")).toEqual({ "a|s|p": 3 });
    // #637: a count with the worst px past the rule's limit.
    const read = (text: string) => {
      try {
        return loadCounts(() => text, "responsive-baseline.json");
      } catch (error) {
        return String(error);
      }
    };
    expect(read('{"a|s|p": {"count": 2, "worst": 76}}')).toEqual({
      "a|s|p": { count: 2, worst: 76 },
    });
    expect(() =>
      loadCounts(() => '{"a|s|p": {"count": 2, "worst": "far"}}', "responsive-baseline.json"),
    ).toThrow("responsive-baseline.json: a|s|p is not a count of findings");
    expect(() =>
      loadCounts(() => '{"b|s|p": "1406 px past its box"}', "spacing-baseline.json"),
    ).toThrow("spacing-baseline.json: b|s|p is not a count of findings");
    expect(() => loadCounts(() => "{ nope", "responsive-baseline.json")).toThrow(
      "responsive-baseline.json is not valid JSON",
    );
  });

  test("#637: a key whose worst px past its limit grows by more than 2 fails, with both values", () => {
    const over = (path: string, excess: number) => ({
      rule: "overflow-x" as const,
      path,
      group: "card > table",
      detail: `${excess} px past the right of card`,
      excess,
    });
    const key = `overflow-x|${S}|card > table`;
    const worse = fresh({ [key]: { count: 2, worst: 76 } });
    expect(
      ratchetScreen(S, [over("card > table[1]", 40), over("card > table[2]", 79)], worse),
    ).toEqual([
      `${S}: overflow-x card > table, worst 79 px past its limit where the baseline has 76: card > table[2] (79 px past the right of card)`,
    ]);
    expect(worse.seen).toEqual({ [key]: { count: 2, worst: 79 } });
    const close = fresh({ [key]: { count: 2, worst: 76 } });
    expect(
      ratchetScreen(S, [over("card > table[1]", 40), over("card > table[2]", 78)], close),
    ).toEqual([]);
  });

  test("#724: a worst that dropped by more than 2 px is for the baseline to lower, like a count", () => {
    const over = (path: string, excess: number) => ({
      rule: "overflow-x" as const,
      path,
      group: "card > table",
      detail: `${excess} px past the right of card`,
      excess,
    });
    const key = `overflow-x|${S}|card > table`;
    const better = fresh({ [key]: { count: 2, worst: 76 } });
    expect(
      ratchetScreen(S, [over("card > table[1]", 40), over("card > table[2]", 70)], better),
    ).toEqual([]);
    expect(better.gone).toEqual([`${key}: worst 70 px where the baseline has 76: lower it`]);
    // Within the rendering tolerance, the baseline stays.
    const close = fresh({ [key]: { count: 2, worst: 76 } });
    ratchetScreen(S, [over("card > table[1]", 40), over("card > table[2]", 74)], close);
    expect(close.gone).toEqual([]);
    // A plain count, or a key with no px (nested-scroll), has no worst to lower.
    const plain = fresh({ [key]: 2 });
    ratchetScreen(S, [over("card > table[1]", 40), over("card > table[2]", 10)], plain);
    expect(plain.gone).toEqual([]);
  });

  test("#724: a negative or fractional count, a negative or infinite worst, or a baseline that is not an object is refused by file name", () => {
    const read = (text: string) => {
      try {
        return loadCounts(() => text, "responsive-baseline.json");
      } catch (error) {
        return String(error);
      }
    };
    for (const text of [
      '{"a|s|p": -1}',
      '{"a|s|p": 1.5}',
      '{"a|s|p": {"count": -1}}',
      '{"a|s|p": {"count": 2, "worst": -5}}',
      '{"a|s|p": {"count": 2, "worst": 1e999}}',
    ]) {
      expect(read(text)).toBe("Error: responsive-baseline.json: a|s|p is not a count of findings");
    }
    for (const text of ["null", "[1]", "3"]) {
      expect(read(text)).toBe("Error: responsive-baseline.json is not an object of counts");
    }
    expect(read('{"a|s|p": {"count": 0, "worst": 0}}')).toEqual({
      "a|s|p": { count: 0, worst: 0 },
    });
  });

  test("#637: each spacing and narrow finding says how many px it is past its rule's limit", () => {
    page(`
      <div data-slot="page-body" data-rect="0,0,1000,800">
        <div data-slot="links" data-rect="0,0,1000,100"></div>
        <div data-slot="config" data-rect="0,103,1000,300"></div>
      </div>
      <div data-slot="card" data-rect="0,400,400,600">
        <code data-slot="hook-command" data-rect="4,420,396,440">bun run a-very-long-command</code>
        <pre data-slot="spill" data-rect="24,460,376,480" data-sw="600" data-cw="352">long line</pre>
      </div>`);
    const excess = (f: { rule: string; excess?: number }) => `${f.rule} ${f.excess}`;
    expect(
      layoutFindings({ spacing: SPACING })
        .filter((f) => SPACING_RULES.includes(f.rule))
        .map(excess),
    ).toEqual(["text-spill 248", "block-gap 5", "card-padding 4"]);
    page(`
      <div class="tab-strip" role="tablist" data-rect="0,0,640,40"></div>
      <section data-slot="page" data-rect="0,32,640,800">
        <div data-slot="page-header" data-rect="0,32,640,100">
          <h1 data-slot="page-title" data-rect="24,48,400,76" data-sw="520" data-cw="376">A long name</h1>
        </div>
        <div data-slot="card" data-rect="16,120,600,300">
          <div data-slot="table" data-rect="16,140,676,280">a table</div>
        </div>
        <div data-slot="timeline" style="overflow-y: auto" data-rect="0,320,640,500" data-ch="180" data-sh="680">x</div>
      </section>`);
    // The page itself scrolls, so the timeline is a second scrollbar.
    document.documentElement.setAttribute("data-sh", "1000");
    document.documentElement.setAttribute("data-ch", "800");
    try {
      expect(
        layoutFindings({ responsive: RESPONSIVE })
          .filter((f) => RESPONSIVE_RULES.includes(f.rule))
          .map(excess),
        // #703 review: what a nested scroll hides grows with the demo's data, so it is counted only.
      ).toEqual([
        "overflow-x 76",
        "nested-scroll undefined",
        "header-clipped 8",
        "header-clipped 144",
      ]);
    } finally {
      document.documentElement.removeAttribute("data-sh");
      document.documentElement.removeAttribute("data-ch");
    }
  });
});
describe("layout-guards: a gap read while a toast slides in is measured again (issue #747)", () => {
  const gap: Finding = { rule: "gap", path: "li", detail: "7 px above status-bar, at least 8" };
  const other: Finding = { rule: "overflow-x", path: "area-screen", detail: "wide" };

  /** A measure that answers the given lists in order, then the last one for good; and a settle that counts. */
  function rig(answers: Finding[][]) {
    let reads = 0;
    let settles = 0;
    return {
      measure: async () => answers[Math.min(reads++, answers.length - 1)] ?? [],
      settle: async () => {
        settles++;
      },
      reads: () => reads,
      settles: () => settles,
    };
  }

  test("a gap that is gone once the boxes hold still is no finding", async () => {
    const r = rig([[gap], []]);
    expect(await confirmGaps(r.measure, r.settle)).toEqual([]);
    expect(r.settles()).toBe(1);
  });

  test("a gap that stays through every re-measure is reported, after three settles", async () => {
    const r = rig([[gap]]);
    expect(await confirmGaps(r.measure, r.settle)).toEqual([gap]);
    expect(r.settles()).toBe(3);
    expect(r.reads()).toBe(4);
  });

  test("findings that are not gaps are returned at once, with no settle and no second read", async () => {
    const r = rig([[other]]);
    expect(await confirmGaps(r.measure, r.settle)).toEqual([other]);
    expect(r.settles()).toBe(0);
    expect(r.reads()).toBe(1);
  });

  test("the last read is the answer: a gap that was steady and moves off is not kept", async () => {
    const r = rig([[gap, other], [gap, other], [other]]);
    expect(await confirmGaps(r.measure, r.settle)).toEqual([other]);
  });
});
