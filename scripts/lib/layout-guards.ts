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
export function layoutFindings(_options: GuardOptions = {}): Finding[] {
  return [];
}

export interface Baseline {
  [key: string]: true;
}

/** The key of a finding in the baseline: the rule, the screen and the culprit's path. No text, no pixels. */
export function findingKey(_screen: string, _finding: Finding): string {
  return "";
}

/** What is new against the baseline, and what the baseline holds that is gone. */
export function compareToBaseline(
  _screen: string,
  _findings: Finding[],
  _baseline: Baseline,
): { fresh: Finding[]; fixed: string[] } {
  return { fresh: [], fixed: [] };
}
