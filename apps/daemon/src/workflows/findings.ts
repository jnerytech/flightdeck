/**
 * Issue #79: the findings an agent step hands to a `cards` step, read from its reply. Pure: the
 * board decides what to do with them. The reply is untrusted text, so anything off the shape
 * refuses the whole list and nothing is created.
 */

/** A list longer than this is a runaway agent: refused whole, not cut. */
export const FINDINGS_MAX_ITEMS = 50;
/** Cards one run creates at most; the rest are counted, not created. */
export const CARDS_PER_RUN = 10;
export const TITLE_MAX = 160;
export const BODY_MAX = 4000;
/** A stable id of a finding, like `debt:src/a.ts:todo`, that the dedupe keys on. */
export const KEY_PATTERN = /^\w[\w:./#@+-]{0,159}$/;

export interface Finding {
  key: string;
  title: string;
  body: string;
}

export type FindingsResult =
  | { ok: true; findings: Finding[] }
  | { ok: false; reason: "findings_missing" }
  | { ok: false; reason: "findings_invalid"; where: string };

/** The findings in the last fenced `json` block of the agent's reply. */
export function parseFindings(_reply: string): FindingsResult {
  return { ok: false, reason: "findings_invalid", where: "" };
}
