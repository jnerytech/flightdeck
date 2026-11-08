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

/** What the board did with the findings: the new cards' ids, and what it left out. */
export interface CardsRaised {
  created: string[];
  /** Findings a card already covers, or that repeat one earlier in the list. */
  duplicates: number;
  /** New findings left out because the run already created `CARDS_PER_RUN`. */
  overCap: number;
}

export type FindingsResult =
  | { ok: true; findings: Finding[] }
  | { ok: false; reason: "findings_missing" }
  | { ok: false; reason: "findings_invalid"; where: string };

const BLOCK = /```json[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```/g;
/** What a person must not be shown: controls (a newline too) and invisible formatting. */
const NOT_SHOWN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const FIELDS = new Set(["key", "title", "body"]);

const invalid = (where: string): FindingsResult => ({
  ok: false,
  reason: "findings_invalid",
  where,
});

/** The first problem of one item, as its `where` ("item 2, title"), or the item itself. */
function itemProblem(raw: unknown, n: number): string | Finding {
  const at = (field?: string) => (field ? `item ${n}, ${field}` : `item ${n}`);
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return at();
  const fields = raw as Record<string, unknown>;
  const extra = Object.keys(fields).find((name) => !FIELDS.has(name));
  // The name is the agent's: it is not echoed, so no invisible or endless text reaches a reason.
  if (extra !== undefined) return at("extra field");
  const { key, title, body = "" } = fields;
  if (typeof key !== "string" || !KEY_PATTERN.test(key)) return at("key");
  if (typeof title !== "string") return at("title");
  const trimmed = title.trim();
  if (trimmed === "" || trimmed.length > TITLE_MAX || NOT_SHOWN.test(trimmed)) return at("title");
  // A body keeps its lines and tabs; any other control character is refused like in a title.
  if (typeof body !== "string" || body.length > BODY_MAX) return at("body");
  if (NOT_SHOWN.test(body.replace(/[\t\n\r]/g, ""))) return at("body");
  return { key, title: trimmed, body };
}

/** The findings in the last fenced `json` block of the agent's reply. */
export function parseFindings(reply: string): FindingsResult {
  const block = [...reply.matchAll(BLOCK)].at(-1)?.[1];
  if (block === undefined) return { ok: false, reason: "findings_missing" };
  let list: unknown;
  try {
    list = JSON.parse(block);
  } catch {
    return invalid("json");
  }
  if (!Array.isArray(list)) return invalid("list");
  if (list.length > FINDINGS_MAX_ITEMS) return invalid(`more than ${FINDINGS_MAX_ITEMS} items`);
  const findings: Finding[] = [];
  for (const [index, raw] of list.entries()) {
    const read = itemProblem(raw, index + 1);
    if (typeof read === "string") return invalid(read);
    findings.push(read);
  }
  return { ok: true, findings };
}
