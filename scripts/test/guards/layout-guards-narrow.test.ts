import { describe, expect, test } from "bun:test";
import {
  type CountEntry,
  layoutFindings,
  type Ratchet,
  RESPONSIVE,
  RESPONSIVE_RULES,
  ratchetScreen,
} from "../../lib/styles/layout-guards.ts";
import { installLayoutStubs, page, rules, spacing } from "./layout-guards-setup.ts";

installLayoutStubs();

describe("layout-guards narrow: what the page function finds at a narrow width", () => {
  const narrow = () =>
    layoutFindings({ responsive: RESPONSIVE })
      .filter((f) => RESPONSIVE_RULES.includes(f.rule))
      .map((f) => `${f.rule}: ${f.path} (${f.detail})`);

  test("narrow (#641): a page that scrolls sideways, and the outermost box past the right of its parent, by how far", () => {
    document.documentElement.setAttribute("data-sw", "720");
    document.documentElement.setAttribute("data-cw", "640");
    try {
      page(`
        <div data-slot="page-body" data-rect="0,0,640,800">
          <div data-slot="card" data-rect="16,16,624,200">
            <div data-slot="table" data-rect="16,40,700,180">
              <div data-slot="row" data-rect="16,40,720,60">a row</div>
            </div>
          </div>
          <div data-slot="code" style="overflow-x: auto" data-rect="16,220,624,300">
            <pre data-rect="16,220,900,300">a long line that scrolls in its own box</pre>
          </div>
          <div data-slot="menu" style="position: fixed" data-rect="500,0,800,100">a popover</div>
          <ul data-rect="16,320,624,420">
            <li style="display: contents"><div data-slot="tile" data-rect="16,320,320,420">a tile</div></li>
          </ul>
        </div>`);
      expect(narrow()).toEqual([
        "overflow-x: page-body > card > table > row (the page scrolls 80 px sideways; this ends at 720)",
        "overflow-x: page-body > card > table (76 px past the right of card)",
      ]);
    } finally {
      document.documentElement.removeAttribute("data-sw");
      document.documentElement.removeAttribute("data-cw");
    }
  });

  // #1270: a disabled button's reason hangs out of the flow (position: absolute), so the parent
  // check above skips it; it must still end inside the box that draws its edge (a bordered panel).
  test("narrow (#1270): out-of-flow text past the edge of the box around it, by how far; a dot or a popover is not", () => {
    page(`
      <div data-slot="page-body" data-rect="0,0,640,800">
        <section data-slot="details" style="border-right-width: 1px; border-right-style: solid" data-rect="16,16,600,300">
          <div data-rect="32,40,584,80">
            <span style="position: relative" data-rect="480,40,584,80">
              <button data-rect="480,40,584,80">Save</button>
              <span class="action-reason" style="position: absolute" data-rect="480,82,700,96">Type the path to save it.</span>
            </span>
          </div>
          <div data-rect="32,120,584,160">
            <span style="position: relative" data-rect="32,120,120,160">
              <span class="action-reason" style="position: absolute" data-rect="32,162,300,176">Type the hours.</span>
            </span>
            <span class="dot" style="position: absolute" data-rect="590,120,604,134"></span>
          </div>
        </section>
        <div data-slot="menu" style="position: fixed" data-rect="500,0,800,100">a popover</div>
      </div>`);
    expect(narrow()).toEqual([
      "overflow-x: page-body > details > span.action-reason (100 px past the right of details)",
    ]);
  });

  // #1325: the reason adds no height to its row (#38), so one that wraps, or a row with text right
  // under it, draws over that text. Only a disabled button's reason: a tooltip or a menu floats on
  // purpose, and a reason that ends above the next line, or touches it by 2 px, covers nothing.
  test("narrow (#1325): a disabled button's reason drawn over other text, by how much; a reason clear of it or a tooltip is not", () => {
    page(`
      <div data-slot="page-body" data-rect="0,0,640,800">
        <section data-slot="details" data-rect="16,16,600,400">
          <div data-rect="32,40,584,80">
            <span style="position: relative" data-rect="480,40,584,80">
              <button data-rect="480,40,584,80">Save spec file</button>
              <span class="action-reason" style="position: absolute" data-rect="300,82,584,110">Type the spec file's path to save it.</span>
            </span>
          </div>
          <p data-rect="32,100,584,116">No spec file at docs/specs/login.md</p>
          <div data-rect="32,200,584,240">
            <span style="position: relative" data-rect="480,200,584,240">
              <button data-rect="480,200,584,240">Save hours</button>
              <span class="action-reason" style="position: absolute" data-rect="400,242,584,256">Type the hours.</span>
            </span>
          </div>
          <p data-rect="32,254,584,270">Estimated hours of this card</p>
          <span data-slot="tooltip-content" style="position: absolute" data-rect="32,300,300,330">A tooltip</span>
          <p data-rect="32,310,584,326">Under the tooltip</p>
        </section>
      </div>`);
    expect(narrow()).toEqual([
      "reason-over: page-body > details > span.action-reason (over page-body > details > p[1], 284x10 px)",
    ]);
  });

  // #1338's review: a reason in a dialog or a full-window sheet floats over the page with it, so the
  // page's text behind the modal is not under it; the dialog's own text is. A tooltip drawn over a
  // reason is a floating layer too. And text is judged by its own lines: a paragraph's box can reach
  // under a reason where its short last line does not.
  test("narrow (#1325): a reason in a dialog meets only the dialog's text, a tooltip over a reason is not counted, and a text's lines count, not its box", () => {
    const proto = Range.prototype as unknown as {
      selectNodeContents(node: Node): void;
      getClientRects(): unknown;
    };
    const select = proto.selectNodeContents;
    const rects = proto.getClientRects;
    // The harness has no layout: a text's lines come from its element's data-lines ("l,t,r,b;…").
    proto.selectNodeContents = function (this: { node?: Node }, node: Node) {
      this.node = node;
    };
    proto.getClientRects = function (this: { node?: Node }) {
      const spec = this.node?.parentElement?.getAttribute("data-lines");
      return (spec ? spec.split(";") : []).map((line) => {
        const [left = 0, top = 0, right = 0, bottom = 0] = line.split(",").map(Number);
        return { left, top, right, bottom, width: right - left, height: bottom - top };
      });
    };
    try {
      page(`
        <div data-slot="page-body" data-rect="0,0,640,800">
          <p data-rect="0,700,640,760">The page's own text, behind the dialog</p>
          <div data-rect="32,40,584,80">
            <span style="position: relative" data-rect="480,40,584,80">
              <button data-rect="480,40,584,80">Save hours</button>
              <span class="action-reason" style="position: absolute" data-rect="300,82,584,110">Type the hours to save them.</span>
            </span>
          </div>
          <span data-slot="tooltip-content" style="position: absolute" data-rect="300,80,584,112">A tooltip over the reason</span>
          <div data-rect="32,300,584,340">
            <span style="position: relative" data-rect="480,300,584,340">
              <button data-rect="480,300,584,340">Save spec file</button>
              <span class="action-reason" style="position: absolute" data-rect="300,342,584,370">Type the path to save it.</span>
            </span>
          </div>
          <p data-rect="32,330,584,380" data-lines="32,330,584,341;32,341,200,357">A paragraph whose short last line ends before the reason</p>
          <p data-rect="32,360,584,380" data-lines="32,360,584,376">A line right under the reason</p>
        </div>
        <div data-slot="dialog-content" style="position: fixed" data-rect="0,600,640,800">
          <div data-rect="24,700,616,740">
            <span style="position: relative" data-rect="500,700,616,740">
              <button data-rect="500,700,616,740">Save</button>
              <span class="action-reason" style="position: absolute" data-rect="300,742,616,770">Name the action to save it.</span>
            </span>
          </div>
          <p data-rect="24,760,616,776">The dialog's own text</p>
        </div>`);
      expect(narrow()).toEqual([
        "reason-over: page-body > span.action-reason (over page-body > p[3], 284x10 px)",
        "reason-over: dialog-content > span.action-reason (over dialog-content > p, 316x10 px)",
      ]);
    } finally {
      proto.selectNodeContents = select;
      proto.getClientRects = rects;
    }
  });

  test("narrow (#641): a box that scrolls inside another that scrolls is two scrollbars; one with nothing to hide is not", () => {
    page(`
      <div data-slot="scroll-area-viewport" style="overflow-y: auto" data-rect="0,0,640,800" data-ch="800" data-sh="1600">
        <div data-slot="timeline" style="overflow-y: auto" data-rect="0,100,640,500" data-ch="400" data-sh="900">x</div>
        <div data-slot="list" style="overflow-y: auto" data-rect="0,520,640,800" data-ch="280" data-sh="280">y</div>
      </div>
      <div data-slot="side" style="overflow-y: auto" data-rect="640,0,800,800" data-ch="800" data-sh="1200">z</div>`);
    expect(narrow()).toEqual([
      "nested-scroll: scroll-area-viewport > timeline (hides 500 px, inside scroll-area-viewport, which hides 800)",
    ]);
    // The page itself scrolling is the outer scrollbar too.
    document.documentElement.setAttribute("data-sh", "1000");
    document.documentElement.setAttribute("data-ch", "800");
    try {
      page(
        '<div data-slot="timeline" style="overflow-y: auto" data-rect="0,100,640,500" data-ch="400" data-sh="900">x</div>',
      );
      expect(narrow()).toEqual([
        "nested-scroll: timeline (hides 500 px, inside the page, which hides 200)",
      ]);
    } finally {
      document.documentElement.removeAttribute("data-sh");
      document.documentElement.removeAttribute("data-ch");
    }
  });

  // #1271: below 640 px a dialog is a full-screen sheet. A form's buttons rest on the sheet's bottom
  // edge, and at the end of the sheet's scroll no field is left under them. New action kept its
  // fields in a 70vh box of their own, so the buttons stopped mid-sheet over the next field.
  test("narrow (#1271): a sheet's form buttons stop short of its bottom, or sit over a field at the end of its scroll", () => {
    page(`
      <div data-slot="dialog-content" style="position: fixed; overflow-y: auto" data-rect="0,0,1000,700" data-ch="700" data-sh="700">
        <form data-rect="0,56,1000,700">
          <div data-slot="fields" style="overflow-y: auto" data-rect="24,56,976,640" data-ch="584" data-sh="900">
            <input aria-label="Action name" data-rect="24,80,976,116">
            <input aria-label="Parameters" data-rect="24,650,976,690">
          </div>
          <div data-rect="24,560,976,596"><div data-slot="form-actions" data-rect="24,560,976,596"><button data-rect="800,560,976,596">Save</button></div></div>
        </form>
      </div>`);
    expect(narrow()).toEqual([
      "sheet-actions: dialog-content > form-actions (ends 104 px above the sheet's bottom)",
    ]);
    // On the bottom, but the sheet has nothing left to scroll: the last field stays under them. A
    // field inside a scroller of its own (above) is that box's to show, not the buttons'.
    page(`
      <div data-slot="dialog-content" style="position: fixed; overflow-y: auto" data-rect="0,0,1000,700" data-ch="700" data-sh="700">
        <form data-rect="0,56,1000,700">
          <input aria-label="Action name" data-rect="24,80,976,116">
          <input aria-label="Parameters" data-rect="24,650,976,686">
          <div data-rect="0,640,1000,700"><div data-slot="form-actions" data-rect="24,656,976,692"><button data-rect="800,656,976,692">Save</button></div></div>
        </form>
      </div>`);
    expect(narrow()).toEqual([
      "sheet-actions: dialog-content > input[2] (under dialog-content > form-actions)",
    ]);
    // Fixed: the buttons rest on the bottom, and the last field scrolls up clear of them (the sheet
    // hides 300 px, so at the end of its scroll the field at 900 is at 600, above the buttons at 640).
    page(`
      <div data-slot="dialog-content" style="position: fixed; overflow-y: auto" data-rect="0,0,1000,700" data-ch="700" data-sh="1000">
        <form data-rect="0,56,1000,1000">
          <input aria-label="Action name" data-rect="24,80,976,116">
          <input aria-label="Parameters" data-rect="24,900,976,936">
          <div data-rect="0,640,1000,700"><div data-slot="form-actions" data-rect="24,656,976,692"><button data-rect="800,656,976,692">Save</button></div></div>
        </form>
      </div>`);
    expect(narrow()).toEqual([]);
    // A dialog that is not a sheet (a wide window) keeps its buttons where its form ends.
    page(`
      <div data-slot="dialog-content" style="position: fixed" data-rect="200,100,800,500">
        <form data-rect="224,124,776,476">
          <input aria-label="Action name" data-rect="224,140,776,176">
          <div data-rect="224,300,776,336"><div data-slot="form-actions" data-rect="224,300,776,336"></div></div>
        </form>
      </div>`);
    expect(narrow()).toEqual([]);
  });

  test("narrow (#641): a page header that starts under the tab row, and a title cut short, are findings", () => {
    page(`
      <div class="tab-strip" role="tablist" data-rect="0,0,640,40"></div>
      <section data-slot="page" data-rect="0,32,640,800">
        <div data-slot="page-header" data-rect="0,32,640,100">
          <h1 data-slot="page-title" data-rect="24,48,400,76" data-sw="520" data-cw="376">A very long project name</h1>
        </div>
      </section>`);
    expect(narrow()).toEqual([
      "header-clipped: page > page-header (starts 8 px under the tab row)",
      "header-clipped: page > page-header > page-title (cut: 376 px of 520)",
    ]);
    page(`
      <div class="tab-strip" role="tablist" data-rect="0,0,640,40"></div>
      <section data-slot="page" data-rect="0,40,640,800">
        <div data-slot="page-header" data-rect="0,40,640,100">
          <h1 data-slot="page-title" data-rect="24,56,400,84" data-sw="376" data-cw="376">Short</h1>
        </div>
      </section>`);
    expect(narrow()).toEqual([]);
  });

  test("#677: the narrow findings go through a ratchet: none fail with no baseline, each counts against one", () => {
    page(`
      <div data-slot="card" data-rect="0,0,300,100">
        <div data-slot="table" data-rect="0,0,380,80">a table</div>
        <div style="clip-path: inset(50%)" data-rect="0,0,500,20">a caption for screen readers</div>
      </div>`);
    const found = layoutFindings({ responsive: RESPONSIVE }).filter((f) =>
      RESPONSIVE_RULES.includes(f.rule),
    );
    const ratchet = (baseline: Record<string, CountEntry> | null) => ({
      baseline,
      seen: {} as Ratchet["seen"],
      occurrences: {} as Record<string, string>,
      gone: [] as string[],
    });
    expect(ratchetScreen("dark en 640x800 card", found, ratchet(null))).toEqual([]);
    // The clipped caption, wider than its card, is not a finding: only the table is.
    expect(ratchetScreen("dark en 640x800 card", found, ratchet({}))).toEqual([
      "dark en 640x800 card: overflow-x card > table, 1 where the baseline has 0: card > table (80 px past the right of card)",
    ]);
  });

  test("#677: the old clip: rect(0 0 0 0) form hides for screen readers only too", () => {
    page(`
      <div data-slot="card" data-rect="0,0,300,100">
        <span data-slot="caption" data-old-clip data-rect="0,0,1,1" data-sw="90" data-cw="1">a caption</span>
      </div>`);
    // happy-dom does not compute `clip`: this element's computed style answers as Chrome does.
    const real = window.getComputedStyle;
    window.getComputedStyle = ((el: Element) => {
      const style = real(el);
      if (!el.hasAttribute("data-old-clip")) return style;
      return new Proxy(style, {
        get: (target, key) =>
          key === "getPropertyValue"
            ? (name: string) =>
                name === "clip" ? "rect(0px, 0px, 0px, 0px)" : target.getPropertyValue(name)
            : Reflect.get(target, key),
      });
    }) as typeof window.getComputedStyle;
    try {
      expect(spacing()).toEqual([]);
    } finally {
      window.getComputedStyle = real;
    }
  });

  test("#677: a header is checked against the app tab rows over it (split panes), not an in-page tablist", () => {
    page(`
      <div role="tablist" data-rect="0,40,640,80">settings tabs</div>
      <div class="tab-strip" role="tablist" data-rect="0,0,320,40"></div>
      <div class="tab-strip" role="tablist" data-rect="320,0,640,48"></div>
      <section data-slot="page" data-rect="320,40,640,800">
        <div data-slot="page-header" data-rect="320,40,640,100"></div>
      </section>`);
    expect(narrow()).toEqual([
      "header-clipped: page > page-header (starts 8 px under the tab row)",
    ]);
  });

  test("an element with no slot is named by its tag and first class", () => {
    page(
      '<main data-slot="main"><div class="flex min-h-0" data-rect="0,0,100,0"><b>x</b></div></main>',
    );
    expect(rules()).toEqual(["collapsed: main > div.flex"]);
  });
});
