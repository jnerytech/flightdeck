/**
 * Layout guards (issue #192): one browser module for the e2e journeys and `demo:shots`. The page
 * function measures what is on screen and names each culprit by its `data-slot` path; the Node
 * helpers keep a baseline of findings, so the heuristic rules start quiet and only go down.
 */

export type Rule =
  | "sideways"
  | "clipped"
  | "collapsed"
  | "truncated"
  | "attention"
  | "growth"
  | "region-small"
  | "region-missing"
  | "gap"
  | "scroll-split"
  | "block-gap"
  | "card-gap"
  | "card-padding"
  | "text-spill"
  | "chip-gap";

export interface Finding {
  rule: Rule;
  /** The culprit's nearest `data-slot` names, then its tag and class when it has none. */
  path: string;
  detail: string;
}

/** A region that must be on screen with at least this much room (a contract, not a heuristic). */
export interface RegionRule {
  slot: string;
  minHeight?: number;
  minWidth?: number;
  /** Absent from the page is a finding too. */
  required?: boolean;
}

/** Two floating boxes that share columns: every `above` box ends at least `min` px over every `below` one (#581). */
export interface GapRule {
  above: string;
  below: string;
  min: number;
}

/** The spacing guard (#588): what is measured, and the least room each must keep, in px. */
export interface SpacingRules {
  /** Containers whose direct children are a page's blocks. */
  blocks: string;
  blockMin: number;
  /** Cards: sibling cards keep `cardMin` apart, and their text `padMin` from their edges. */
  card: string;
  cardMin: number;
  padMin: number;
  /** Chips in a row keep `chipMin` apart. */
  chip: string;
  chipMin: number;
}

export interface GuardOptions {
  regions?: RegionRule[];
  /** Bars that must not grow: a selector and the most they may be tall, in px. */
  bars?: Array<{ selector: string; maxHeight: number }>;
  gaps?: GapRule[];
  spacing?: SpacingRules;
  /** Regions (by `data-slot`) that scroll as one area: at most one element in each may scroll vertically. */
  single?: string[];
}

/**
 * Runs inside the page (`page.evaluate(layoutFindings, options)`): it must stay self-contained.
 * Rules: the page scrolls sideways; an element is cut by an ancestor that clips on an axis no
 * ancestor scrolls; an element with content is under 8 px tall; text is cut to under 48 px with an
 * ellipsis; an alert is off screen; a bar grew; a key region is small or missing; a region that
 * scrolls as one holds more than one scroller; a floating box is too close to the one below it.
 */
export function layoutFindings(options: GuardOptions = {}): Finding[] {
  const found: Finding[] = [];
  const seen = new Set<string>();
  const add = (rule: Rule, path: string, detail: string) => {
    const key = `${rule}|${path}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ rule, path, detail });
  };
  const slotOf = (el: Element) => el.getAttribute("data-slot");
  /** An element with no data-slot: its tag and first class. */
  const plainName = (el: Element) => {
    const first = String(el.getAttribute("class") ?? "")
      .split(/\s+/)
      .find(Boolean);
    return first ? `${el.tagName.toLowerCase()}.${first}` : el.tagName.toLowerCase();
  };
  /** `name[n]` when there is more than one: in page order for a slot, among its siblings otherwise. */
  const numbered = (name: string, at: Element, peers: Element[]) =>
    peers.length > 1 ? `${name}[${peers.indexOf(at) + 1}]` : name;
  /**
   * The data-slot names from the outside in (at most the last four), and the element's own name.
   * `withNumbers` (the spacing rules, #588) numbers a name the page holds more than once, so two
   * findings under the same names stay two: `grid > card[2]`, `session-tile[1] > span[2]`.
   */
  const pathOf = (el: Element, withNumbers = false): string => {
    const names: string[] = [];
    for (let at: Element | null = el; at && at !== document.body; at = at.parentElement) {
      const slot = slotOf(at);
      if (slot) {
        const peers = withNumbers
          ? [...document.querySelectorAll("[data-slot]")].filter((x) => slotOf(x) === slot)
          : [];
        names.unshift(numbered(slot, at, peers));
      } else if (at === el) {
        const name = plainName(at);
        const peers = withNumbers
          ? [...(at.parentElement?.children ?? [])].filter(
              (x) => !slotOf(x) && plainName(x) === name,
            )
          : [];
        names.unshift(numbered(name, at, peers));
      }
    }
    return names.slice(-4).join(" > ") || el.tagName.toLowerCase();
  };
  const shown = (el: Element) => {
    const style = getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden";
  };
  /** Not on screen at all: it, or something around it, is `display: none`. */
  const hidden = (el: Element) => {
    for (let at: Element | null = el; at; at = at.parentElement) if (!shown(at)) return true;
    return false;
  };
  const rectOf = (el: Element) => el.getBoundingClientRect();
  const clips = (value: string) => value === "hidden" || value === "clip";
  const scrolls = (value: string) => value === "auto" || value === "scroll";
  const outsideX = (box: DOMRect, room: DOMRect) =>
    box.right > room.right + 2 || box.left < room.left - 2;
  const outsideY = (box: DOMRect, room: DOMRect) =>
    box.bottom > room.bottom + 2 || box.top < room.top - 2;

  // The rules are nested functions on purpose: this body runs in the page and stays self-contained.

  // 1. The page scrolls sideways: the widest element is the culprit.
  const checkSideways = () => {
    const root = document.documentElement;
    if (root.scrollWidth <= root.clientWidth) return;
    let widest: Element | null = null;
    let right = 0;
    for (const el of document.querySelectorAll("body *")) {
      const box = rectOf(el);
      if (box.width > 0 && box.right > right && !hidden(el)) {
        widest = el;
        right = box.right;
      }
    }
    add(
      "sideways",
      widest ? pathOf(widest) : "page",
      `scrollWidth ${root.scrollWidth} > ${root.clientWidth}; ends at ${Math.round(right)}`,
    );
  };

  const cutBy = (
    parent: CSSStyleDeclaration,
    box: DOMRect,
    room: DOMRect,
    xOpen: boolean,
    yOpen: boolean,
  ) => {
    if (xOpen && clips(parent.overflowX) && outsideX(box, room)) return "sideways";
    if (yOpen && clips(parent.overflowY) && outsideY(box, room)) return "vertically";
    return null;
  };

  // 2. Cut by an ancestor that clips on an axis no ancestor between them scrolls.
  const checkClipped = (el: Element, box: DOMRect) => {
    let xOpen = true;
    let yOpen = true;
    for (let up = el.parentElement; up && up !== document.body; up = up.parentElement) {
      const parent = getComputedStyle(up);
      if (parent.position === "fixed") return;
      const room = rectOf(up);
      if (xOpen && scrolls(parent.overflowX)) xOpen = false;
      if (yOpen && scrolls(parent.overflowY)) yOpen = false;
      const how = cutBy(parent, box, room, xOpen, yOpen);
      if (how) {
        add("clipped", pathOf(el), `cut ${how} by ${pathOf(up)}`);
        return;
      }
    }
  };

  // 3. Content squeezed under 8 px tall (a screen-reader-only box is 1 px on purpose).
  const checkCollapsed = (el: Element, box: DOMRect, tiny: boolean) => {
    const hasContent = el.children.length > 0 || (el.textContent ?? "").trim() !== "";
    const squeezed = box.height < 8 && hasContent && box.width > 8;
    if ((!tiny || box.height < 8) && squeezed && !el.hasAttribute("aria-hidden")) {
      add("collapsed", pathOf(el), `${Math.round(box.height)} px tall`);
    }
  };

  // 4. Text cut with an ellipsis down to under 48 px.
  const checkTruncated = (el: Element, style: CSSStyleDeclaration) => {
    if (
      style.textOverflow === "ellipsis" &&
      el.scrollWidth > el.clientWidth + 1 &&
      el.clientWidth < 48
    ) {
      add("truncated", pathOf(el), `${el.clientWidth} px of ${el.scrollWidth}`);
    }
  };

  // 5. What asks for attention is on screen without scrolling.
  const checkAttention = () => {
    for (const el of document.querySelectorAll('[role="alert"], [data-attention]')) {
      if (hidden(el)) continue;
      const box = rectOf(el);
      if (
        box.bottom > window.innerHeight ||
        box.top < 0 ||
        box.right > window.innerWidth ||
        box.left < 0
      ) {
        add(
          "attention",
          pathOf(el),
          `box ${Math.round(box.left)},${Math.round(box.top)} to ${Math.round(box.right)},${Math.round(box.bottom)}`,
        );
      }
    }
  };

  // 6. Bars that must not grow.
  const checkBars = () => {
    for (const bar of options.bars ?? []) {
      for (const el of document.querySelectorAll(bar.selector)) {
        const height = rectOf(el).height;
        if (!hidden(el) && height > bar.maxHeight) {
          add("growth", pathOf(el), `${Math.round(height)} px tall, at most ${bar.maxHeight}`);
        }
      }
    }
  };

  // 7. Key regions: a contract, so a small one is a finding and a required one must exist.
  const checkRegions = () => {
    for (const region of options.regions ?? []) {
      const el = document.querySelector(`[data-slot="${region.slot}"]`);
      if (!el || hidden(el)) {
        if (region.required) add("region-missing", region.slot, "not on the page");
        continue;
      }
      const box = rectOf(el);
      if (box.height < (region.minHeight ?? 0) || box.width < (region.minWidth ?? 0)) {
        add("region-small", pathOf(el), `${Math.round(box.width)} x ${Math.round(box.height)} px`);
      }
    }
  };

  // 8. A floating box ends at least `min` px over the one below it in the same columns (#581): a
  // box that overlaps it is a finding too.
  const checkGaps = () => {
    for (const rule of options.gaps ?? []) {
      const belows = [...document.querySelectorAll(rule.below)].filter((el) => !hidden(el));
      for (const el of document.querySelectorAll(rule.above)) {
        if (hidden(el)) continue;
        const box = rectOf(el);
        for (const below of belows) {
          const under = rectOf(below);
          if (box.right <= under.left || box.left >= under.right) continue;
          const gap = under.top - box.bottom;
          // Half a pixel is rounding (a rem at a fractional zoom), not a gap that went away (#655).
          if (gap < rule.min - 0.5) {
            add(
              "gap",
              pathOf(el),
              `${Math.round(gap)} px above ${pathOf(below)}, at least ${rule.min}`,
            );
          }
        }
      }
    }
  };

  // 9. Regions that scroll as one (#567): two scrollers side by side in a narrow column read as
  // broken, so at most one element in each such region scrolls vertically.
  const checkSingleScroll = () => {
    for (const slot of options.single ?? []) {
      const region = document.querySelector(`[data-slot="${slot}"]`);
      if (!region || hidden(region)) continue;
      const scrollers = [region, ...region.querySelectorAll("*")].filter(
        (el) => !hidden(el) && scrolls(getComputedStyle(el).overflowY),
      );
      if (scrollers.length > 1) {
        const names = scrollers.map((el) => pathOf(el)).join(", ");
        add("scroll-split", pathOf(region), `${scrollers.length} scroll areas (${names})`);
      }
    }
  };

  // 10. Spacing (#588), heuristic: blocks, cards and chips keep room between them, and text keeps
  // room in its card and inside its own box. A finding names the element and the px it has.
  const spacing = options.spacing;
  const nameOf = (el: Element) => pathOf(el, true).split(" > ").pop() ?? "";
  const ownText = (el: Element) =>
    [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? "").trim() !== "");
  /** The room between two boxes that share columns (stacked) or rows (side by side), or how far they overlap. */
  const apart = (a: DOMRect, b: DOMRect) => {
    const cols = a.left < b.right && b.left < a.right;
    const rows = a.top < b.bottom && b.top < a.bottom;
    if (cols && rows) {
      const over = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      return {
        px: -Math.min(over, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)),
        how: "over",
      };
    }
    if (cols) return { px: Math.max(b.top - a.bottom, a.top - b.bottom), how: "under" };
    if (rows) return { px: Math.max(b.left - a.right, a.left - b.right), how: "beside" };
    return null;
  };
  const checkPairs = (els: Element[], min: number, rule: Rule) => {
    const boxes = els
      .filter((el) => !hidden(el))
      .map((el) => [el, rectOf(el)] as const)
      .filter(([, box]) => box.width > 0 && box.height > 0);
    boxes.forEach(([b, rb], j) => {
      for (const [a, ra] of boxes.slice(0, j)) {
        const room = apart(ra, rb);
        if (room && room.px < min) {
          add(
            rule,
            pathOf(b, true),
            `${Math.round(room.px)} px ${room.how} ${nameOf(a)}, at least ${min}`,
          );
        }
      }
    });
  };
  /** Siblings that match `selector`, grouped by their parent. */
  const siblingGroups = (selector: string) => {
    const groups = new Map<Element, Element[]>();
    for (const el of document.querySelectorAll(selector)) {
      const parent = el.parentElement;
      if (parent) groups.set(parent, [...(groups.get(parent) ?? []), el]);
    }
    return [...groups.values()];
  };
  const checkCardPadding = (card: Element, min: number) => {
    if (hidden(card)) return;
    const edge = rectOf(card);
    for (const el of card.querySelectorAll("*")) {
      if (hidden(el) || !ownText(el)) continue;
      const box = rectOf(el);
      if (box.width <= 0 || box.height <= 0) continue;
      // The text starts inside the element's own border and padding: a padded header flush with the card is fine.
      const style = getComputedStyle(el);
      const inner = (side: string) =>
        (Number.parseFloat(style.getPropertyValue(`padding-${side}`)) || 0) +
        (Number.parseFloat(style.getPropertyValue(`border-${side}-width`)) || 0);
      const left: [string, number] = ["left", box.left - edge.left + inner("left")];
      const others: Array<[string, number]> = [
        ["right", edge.right - box.right + inner("right")],
        ["top", box.top - edge.top + inner("top")],
        ["bottom", edge.bottom - box.bottom + inner("bottom")],
      ];
      const [side, px] = others.reduce((low, next) => (next[1] < low[1] ? next : low), left);
      if (px < min) {
        add(
          "card-padding",
          pathOf(el, true),
          `${Math.round(px)} px from the card's ${side} edge, at least ${min}`,
        );
      }
    }
  };
  const checkSpill = (el: Element, style: CSSStyleDeclaration) => {
    // Only text left to spill: a box that clips (an ellipsis) or scrolls is the other rules' business.
    if ((style.overflowX || "visible") !== "visible" || !ownText(el)) return;
    const past = el.scrollWidth - el.clientWidth;
    if (past > 1) add("text-spill", pathOf(el, true), `${past} px past its box`);
  };
  const checkSpacing = () => {
    if (!spacing) return;
    for (const body of document.querySelectorAll(spacing.blocks)) {
      if (!hidden(body)) checkPairs([...body.children], spacing.blockMin, "block-gap");
    }
    for (const cards of siblingGroups(spacing.card)) checkPairs(cards, spacing.cardMin, "card-gap");
    for (const card of document.querySelectorAll(spacing.card))
      checkCardPadding(card, spacing.padMin);
    for (const chips of siblingGroups(spacing.chip)) checkPairs(chips, spacing.chipMin, "chip-gap");
  };

  checkSideways();
  for (const el of document.querySelectorAll("body *")) {
    if (hidden(el)) continue;
    const style = getComputedStyle(el);
    const box = rectOf(el);
    const tiny = box.width <= 2 || box.height <= 2;
    if (style.position !== "fixed" && box.width > 0 && box.height > 0) checkClipped(el, box);
    checkCollapsed(el, box, tiny);
    checkTruncated(el, style);
    if (spacing) checkSpill(el, style);
  }
  checkAttention();
  checkBars();
  checkRegions();
  checkGaps();
  checkSingleScroll();
  checkSpacing();
  return found;
}

export interface Baseline {
  [key: string]: true;
}

/** The key of a finding in the baseline: the rule, the screen and the culprit's path. No text, no pixels. */
export function findingKey(screen: string, finding: Finding): string {
  return `${finding.rule}|${screen}|${finding.path}`;
}

/** What is new against the baseline, and what the baseline holds that is gone. */
export function compareToBaseline(
  screen: string,
  findings: Finding[],
  baseline: Baseline,
): { fresh: Finding[]; fixed: string[] } {
  const now = new Set(findings.map((finding) => findingKey(screen, finding)));
  const here = `|${screen}|`;
  return {
    fresh: findings.filter((finding) => !(findingKey(screen, finding) in baseline)),
    fixed: Object.keys(baseline).filter((key) => key.includes(here) && !now.has(key)),
  };
}

/** The windows the geometry is checked at: the smallest the app allows, the usual one, a big one. */
export const GUARD_SIZES: ReadonlyArray<{ width: number; height: number }> = [
  { width: 720, height: 480 },
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
];

/** The contract: these regions have room on screen at 1280x800 (a collapsed one hid the hosts, a clipped one the approval). */
export const KEY_REGIONS: RegionRule[] = [
  { slot: "sidebar-hosts", minHeight: 24 },
  { slot: "approval-card", minHeight: 60 },
  { slot: "board-columns", minHeight: 120 },
  { slot: "form-actions", minHeight: 28 },
];

/** The floating boxes of the bottom-right corner keep clear of each other and of the status bar (#581). */
export const GAPS: GapRule[] = [
  { above: "[data-sonner-toast]", below: '[data-slot="status-bar"]', min: 8 },
  { above: "[data-sonner-toast]", below: '[data-slot="update-card"]', min: 8 },
  { above: '[data-slot="update-card"]', below: '[data-slot="status-bar"]', min: 8 },
];

/** The boxes the gap rules measure, as one selector: `waitForStable` waits for them to hold still (#655). */
export const GAP_BOXES = [...new Set(GAPS.flatMap((rule) => [rule.above, rule.below]))].join(", ");

/** The sidebar scrolls as one area between its fixed header and footer (#567). */
export const SINGLE_SCROLL = ["sidebar"];

/** The windows the one-scroll rule is checked at: the usual one and a short one (#567). */
export const SCROLL_SIZES: ReadonlyArray<{ width: number; height: number }> = [
  { width: 1280, height: 800 },
  { width: 1280, height: 600 },
];

/** The spacing guard's rules (#588): heuristic, judged against a baseline that only goes down. */
export const SPACING_RULES: readonly Rule[] = [
  "block-gap",
  "card-gap",
  "card-padding",
  "text-spill",
  "chip-gap",
];

/** What the spacing guard measures on every print (#588). */
export const SPACING: SpacingRules = {
  blocks: '[data-slot="page-body"]',
  blockMin: 8,
  card: '[data-slot="card"]',
  cardMin: 8,
  padMin: 8,
  chip: '[data-slot="badge"]',
  chipMin: 4,
};

/** Bars that never grow: the tab bar is one row. */
export const BARS = [{ selector: ".tab-bar", maxHeight: 48 }];

/** What fails with no baseline: the contract. The heuristic rules wait for a baseline file. */
const CONTRACT: ReadonlySet<Rule> = new Set([
  "region-small",
  "region-missing",
  "scroll-split",
  "gap",
]);

/**
 * What a screen's findings mean for the build. A key region that is small or missing always fails;
 * the heuristic rules fail only when they are new against the baseline, and with no baseline file
 * yet (`null`) they fail nothing and are only reported (the first run writes them down).
 */
export function judge(
  screen: string,
  findings: Finding[],
  baseline: Baseline | null,
): { failures: string[]; fixed: string[] } {
  const say = (f: Finding) => `${screen}: ${f.rule} ${f.path} (${f.detail})`;
  const contract = findings.filter((f) => CONTRACT.has(f.rule)).map(say);
  if (!baseline) return { failures: contract, fixed: [] };
  const { fresh, fixed } = compareToBaseline(
    screen,
    findings.filter((f) => !CONTRACT.has(f.rule)),
    baseline,
  );
  return { failures: [...contract, ...fresh.map(say)], fixed };
}

/** The baseline file, or `null` when there is none yet. */
export function loadBaseline(read: () => string | null): Baseline | null {
  const text = read();
  if (text === null) return null;
  const parsed = JSON.parse(text) as Record<string, unknown>;
  return Object.fromEntries(Object.keys(parsed).map((key) => [key, true as const]));
}

export interface Settled {
  /** The layout held still for the asked number of frames before the time ran out. */
  stable: boolean;
  frames: number;
}

/**
 * Runs inside the page (`page.evaluate(waitForStable, options)`): resolves when the fonts are
 * loaded and the page's height has not changed for `frames` frames in a row, or after `maxMs`.
 * It replaces the fixed waits that guards used to take a layout that settles late (issue #192).
 * `boxes` (a selector, such as `GAP_BOXES`) also waits for those boxes to hold still: a toast
 * sliding in moves no scroll height, and a gap read mid-slide was 7 px for 12 (issue #655).
 */
export async function waitForStable(
  options: { frames?: number; maxMs?: number; boxes?: string } = {},
): Promise<Settled> {
  const wanted = options.frames ?? 3;
  const until = Date.now() + (options.maxMs ?? 5000);
  await document.fonts?.ready;
  const boxes = () =>
    options.boxes
      ? [...document.querySelectorAll(options.boxes)].map((el) => {
          const box = el.getBoundingClientRect();
          return `${box.left},${box.top},${box.right},${box.bottom}`;
        })
      : [];
  const height = () =>
    [document.documentElement.scrollHeight + document.body.scrollHeight, ...boxes()].join(" ");
  let last = height();
  let still = 0;
  while (Date.now() < until) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const now = height();
    still = now === last ? still + 1 : 0;
    last = now;
    if (still >= wanted) return { stable: true, frames: still };
  }
  return { stable: false, frames: still };
}

/**
 * Runs inside the page (`page.evaluate(pinnedProblem)`): what is wrong with where a session opened
 * (issue #173), or null. The conversation opens at its end with a pending request whole above the
 * composer; when that request is taller than the conversation's window, the view stops at the
 * request's top instead (issue #456), so the question comes first and nothing above it is cut.
 */
export function pinnedProblem(): string | null {
  const box = document.querySelector<HTMLElement>("[data-slot='timeline']");
  if (!box) return "no timeline";
  const card = box.querySelector<HTMLElement>("[data-request-id]")?.getBoundingClientRect();
  const edge = box.getBoundingClientRect();
  // A request taller than the window is shown from its top: the view stops there, short of the end.
  const atRequest =
    card && card.bottom - card.top > edge.bottom - edge.top && Math.abs(card.top - edge.top) <= 1;
  if (atRequest) return null;
  if (box.scrollTop + box.clientHeight < box.scrollHeight - 24) {
    return `the timeline is not at its end (${Math.round(box.scrollTop + box.clientHeight)} of ${box.scrollHeight})`;
  }
  if (card && (card.top < edge.top - 1 || card.bottom > edge.bottom + 1)) {
    return `the request card (${Math.round(card.top)}..${Math.round(card.bottom)}) is cut by the timeline (${Math.round(edge.top)}..${Math.round(edge.bottom)})`;
  }
  return null;
}
