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
  | "region-missing";

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

export interface GuardOptions {
  regions?: RegionRule[];
  /** Bars that must not grow: a selector and the most they may be tall, in px. */
  bars?: Array<{ selector: string; maxHeight: number }>;
}

/**
 * Runs inside the page (`page.evaluate(layoutFindings, options)`): it must stay self-contained.
 * Rules: the page scrolls sideways; an element is cut by an ancestor that clips on an axis no
 * ancestor scrolls; an element with content is under 8 px tall; text is cut to under 48 px with an
 * ellipsis; an alert is off screen; a bar grew; a key region is small or missing.
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
  /** The data-slot names from the outside in (at most the last four), and the element's own name. */
  const pathOf = (el: Element): string => {
    const names: string[] = [];
    for (let at: Element | null = el; at && at !== document.body; at = at.parentElement) {
      const slot = slotOf(at);
      if (slot) names.unshift(slot);
      else if (at === el) {
        const first = String(at.getAttribute("class") ?? "")
          .split(/\s+/)
          .find(Boolean);
        names.unshift(first ? `${at.tagName.toLowerCase()}.${first}` : at.tagName.toLowerCase());
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

  // 1. The page scrolls sideways: the widest element is the culprit.
  const root = document.documentElement;
  if (root.scrollWidth > root.clientWidth) {
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
  }

  for (const el of document.querySelectorAll("body *")) {
    if (hidden(el)) continue;
    const style = getComputedStyle(el);
    const box = rectOf(el);
    const tiny = box.width <= 2 || box.height <= 2;
    const floats = style.position === "fixed";
    // 2. Cut by an ancestor that clips on an axis no ancestor between them scrolls.
    if (!floats && box.width > 0 && box.height > 0) {
      let xOpen = true;
      let yOpen = true;
      for (let up = el.parentElement; up && up !== document.body; up = up.parentElement) {
        const parent = getComputedStyle(up);
        if (parent.position === "fixed") break;
        const room = rectOf(up);
        if (xOpen && scrolls(parent.overflowX)) xOpen = false;
        if (yOpen && scrolls(parent.overflowY)) yOpen = false;
        if (
          xOpen &&
          clips(parent.overflowX) &&
          (box.right > room.right + 2 || box.left < room.left - 2)
        ) {
          add("clipped", pathOf(el), `cut sideways by ${pathOf(up)}`);
          break;
        }
        if (
          yOpen &&
          clips(parent.overflowY) &&
          (box.bottom > room.bottom + 2 || box.top < room.top - 2)
        ) {
          add("clipped", pathOf(el), `cut vertically by ${pathOf(up)}`);
          break;
        }
      }
    }
    // 3. Content squeezed under 8 px tall (a screen-reader-only box is 1 px on purpose).
    const hasContent = el.children.length > 0 || (el.textContent ?? "").trim() !== "";
    if (!tiny || box.height < 8) {
      if (box.height < 8 && hasContent && box.width > 8 && !el.hasAttribute("aria-hidden")) {
        add("collapsed", pathOf(el), `${Math.round(box.height)} px tall`);
      }
    }
    // 4. Text cut with an ellipsis down to under 48 px.
    if (
      style.textOverflow === "ellipsis" &&
      el.scrollWidth > el.clientWidth + 1 &&
      el.clientWidth < 48
    ) {
      add("truncated", pathOf(el), `${el.clientWidth} px of ${el.scrollWidth}`);
    }
  }

  // 5. What asks for attention is on screen without scrolling.
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

  // 6. Bars that must not grow.
  for (const bar of options.bars ?? []) {
    for (const el of document.querySelectorAll(bar.selector)) {
      const height = rectOf(el).height;
      if (!hidden(el) && height > bar.maxHeight) {
        add("growth", pathOf(el), `${Math.round(height)} px tall, at most ${bar.maxHeight}`);
      }
    }
  }

  // 7. Key regions: a contract, so a small one is a finding and a required one must exist.
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

/** Bars that never grow: the tab bar is one row. */
export const BARS = [{ selector: ".tab-bar", maxHeight: 48 }];

/** What fails with no baseline: the contract. The heuristic rules wait for a baseline file. */
const CONTRACT: ReadonlySet<Rule> = new Set(["region-small", "region-missing"]);

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
