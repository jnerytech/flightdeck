import { describe, expect, test } from "bun:test";
import { GAPS, judge, layoutFindings, SPACING_RULES } from "../../lib/styles/layout-guards.ts";
import { installLayoutStubs, page, rules, spacing } from "./layout-guards-setup.ts";

installLayoutStubs();

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

  // #785: the user saw two scrollbars on the Host page. A Page scrolls by itself, so the area that
  // holds it must not scroll too, or any overflow of the page shows a second bar beside its own.
  test("an area that holds a Page and scrolls itself is a finding; one that holds another screen may scroll", () => {
    const around = () =>
      layoutFindings({ pageArea: "area-screen" })
        .filter((f) => f.rule === "scroll-split")
        .map((f) => `${f.path}: ${f.detail}`);
    page(`
      <div data-slot="area-screen" data-rect="0,0,800,600" style="overflow-y: auto">
        <section data-slot="page" data-rect="0,0,800,600"></section>
      </div>`);
    const auto = around();
    page(`
      <div data-slot="area-screen" data-rect="0,0,800,600" style="overflow-x: auto">
        <section data-slot="page" data-rect="0,0,800,600"></section>
      </div>`);
    const sideways = around();
    page(`
      <div data-slot="area-screen" data-rect="0,0,800,600" style="overflow: hidden">
        <section data-slot="page" data-rect="0,0,800,600"></section>
      </div>`);
    const hidden = around();
    page(`
      <div data-slot="area-screen" data-rect="0,0,800,600" style="overflow-y: auto">
        <div data-rect="0,0,800,600" style="overflow: hidden">
          <section data-slot="page" data-rect="0,0,400,600"></section>
        </div>
      </div>`);
    const split = around();
    page(`
      <div data-slot="area-screen" data-rect="0,0,800,600" style="overflow-y: auto">
        <div data-slot="terminal" data-rect="0,0,800,600"></div>
      </div>`);
    expect({ auto, sideways, hidden, split, other: around() }).toEqual({
      auto: ["area-screen: scrolls around a page that scrolls by itself"],
      sideways: ["area-screen: scrolls around a page that scrolls by itself"],
      hidden: [],
      split: ["area-screen: scrolls around a page that scrolls by itself"],
      other: [],
    });
  });

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

  // The older form, `clip: rect(0 0 0 0)`, is checked in Chrome only: happy-dom does not compute `clip`.
  test("spacing and narrow (#641): what is hidden for screen readers only (a clipped 1 px box) is no finding", () => {
    page(`
      <table data-slot="resources-table" data-rect="0,0,300,200">
        <thead style="position: absolute; clip-path: inset(50%)" data-rect="0,0,1,1">
          <tr><th data-rect="0,0,1,1" data-sw="58" data-cw="1">Requests</th></tr>
        </thead>
      </table>
      <div style="position: absolute; clip-path: inset(50%)" data-rect="0,0,1,1">
        <span data-slot="caption" data-rect="0,0,1,1" data-sw="90" data-cw="1">A caption</span>
      </div>
      <div data-slot="card" data-rect="0,300,300,400">
        <span data-slot="label" style="clip-path: inset(50%)" data-rect="0,300,1,301">flush, but hidden</span>
      </div>
      <pre data-slot="seen" data-rect="0,500,300,520" data-sw="400" data-cw="300">a line that spills</pre>`);
    expect(spacing()).toEqual(["text-spill: seen (100 px past its box)"]);
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
});
