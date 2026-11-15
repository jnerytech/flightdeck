/**
 * A review comment as the person sees it: a stored row mapped to a `ReviewComment`, and where the
 * lines it quotes now start in the file (nearest occurrence), so a comment follows its lines or is
 * marked outdated. Plain values in, plain values out: the SQL and the file reads stay in `../comments.ts`.
 */

export interface ReviewComment {
  id: string;
  target: string;
  path: string;
  /** `new`: the file as it is now; `old`: the version it is compared with (HEAD or the base). */
  side: "new" | "old";
  lineStart: number;
  lineEnd: number;
  quote: string;
  body: string;
  state: "draft" | "sent";
  createdAt: string;
  sentAt: string | null;
  /** The quoted lines are no longer in the file. */
  outdated: boolean;
  /** Issue #1439: a second opinion's finding, until the person edits it. */
  author?: "reviewer";
  severity?: "blocker" | "high" | "medium" | "low";
}

export interface Row {
  id: string;
  target: string;
  path: string;
  side: "new" | "old";
  line_start: number;
  line_end: number;
  quote: string;
  body: string;
  state: "draft" | "sent";
  created_at: string;
  sent_at: string | null;
  author?: string | null;
  severity?: string | null;
}

export const toComment = (row: Row, outdated: boolean): ReviewComment => ({
  id: row.id,
  target: row.target,
  path: row.path,
  side: row.side,
  lineStart: row.line_start,
  lineEnd: row.line_end,
  quote: row.quote,
  body: row.body,
  state: row.state,
  createdAt: row.created_at,
  sentAt: row.sent_at,
  outdated,
  ...(row.author === "reviewer" ? { author: "reviewer" as const } : {}),
  ...(row.severity ? { severity: row.severity as NonNullable<ReviewComment["severity"]> } : {}),
});

/** Where the quote's lines start, at the occurrence nearest to `near`; `null` without one. */
export function anchor(lines: string[], quote: string[], near: number): number | null {
  let best: number | null = null;
  for (let i = 0; i + quote.length <= lines.length; i++) {
    if (!quote.every((line, k) => lines[i + k] === line)) continue;
    const start = i + 1;
    if (best === null || Math.abs(start - near) < Math.abs(best - near)) best = start;
  }
  return best;
}
