import type { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";
import type { Board } from "../board/board.ts";
import { git } from "../board/command.ts";
import { type Central, messageExternal } from "../central/central.ts";
import { FlightdeckError } from "../errors.ts";
import type { SessionManager } from "../sessions/session-manager.ts";
import { ulid } from "../ulid.ts";
import type { Changes, ResolvedTarget } from "./changes.ts";
import { fileInRoot, linesOf } from "./paths.ts";

export interface ReviewCommentsOptions {
  db: Database;
  changes: Changes;
  manager: SessionManager;
  board?: Board;
  /** Terminal sessions and their channels (phase 5). */
  central?: Pick<Central, "external" | "receptor">;
  now?: () => number;
}

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
}

export interface NewReviewComment {
  target: string;
  path: string;
  side: "new" | "old";
  lineStart: number;
  lineEnd: number;
  body: string;
}

/** Where `review.send` delivered the review; `copy` when the app has to hand it over. */
export interface ReviewSent {
  via: "session" | "card" | "terminal" | "copy";
  text: string;
  comments: number;
}

interface Row {
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
}

const toComment = (row: Row, outdated: boolean): ReviewComment => ({
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
});

/** `linha 4` or `linhas 10–12`. */
const linesLabel = (start: number, end: number) =>
  start === end ? `linha ${start}` : `linhas ${start}–${end}`;

const indent = (prefix: string, text: string) =>
  linesOf(text)
    .map((line) => `${prefix}${line}`)
    .join("\n");

/** One numbered item of a review: the file and lines, the quote, then the comment. */
export interface ReviewItem {
  path: string;
  lineStart: number;
  lineEnd: number;
  quote: string;
  body: string;
}

/** The review as one message, each comment with its file, lines and quote. */
export function reviewMessage(items: ReviewItem[]): string {
  return [
    "Revisão das mudanças:",
    ...items.map((item, i) =>
      [
        `${i + 1}. \`${item.path}\` ${linesLabel(item.lineStart, item.lineEnd)}:`,
        indent("   > ", item.quote),
        indent("   ", item.body),
      ].join("\n"),
    ),
  ].join("\n");
}

/** Where the quote's lines start, at the occurrence nearest to `near`; `null` without one. */
function anchor(lines: string[], quote: string[], near: number): number | null {
  let best: number | null = null;
  for (let i = 0; i + quote.length <= lines.length; i++) {
    if (!quote.every((line, k) => lines[i + k] === line)) continue;
    const start = i + 1;
    if (best === null || Math.abs(start - near) < Math.abs(best - near)) best = start;
  }
  return best;
}

/** Inline comments on the diff of a session or card, drafts until sent to the agent. */
export class ReviewComments {
  private readonly db: Database;
  private readonly now: () => number;

  constructor(readonly opts: ReviewCommentsOptions) {
    this.db = opts.db;
    this.now = opts.now ?? Date.now;
  }

  /** The file's lines on one side of the diff; `null` when it is not there. */
  private async content(resolved: ResolvedTarget, path: string, side: "new" | "old") {
    const full = fileInRoot(resolved.root, path);
    if (side === "new") return existsSync(full) ? linesOf(readFileSync(full, "utf8")) : null;
    const rev = `${resolved.base ?? "HEAD"}:${path.replaceAll("\\", "/")}`;
    const shown = await git(resolved.root, "show", rev);
    return shown.code === 0 ? linesOf(shown.stdout) : null;
  }

  /** The target's comments, oldest first, each one moved to where its quote is now. */
  async list(target: string): Promise<ReviewComment[]> {
    const rows = this.db
      .query<Row, [string]>(
        "SELECT * FROM review_comments WHERE target = ? ORDER BY created_at, rowid",
      )
      .all(target);
    // A card done or a repository gone: the comments stay, as history, outdated.
    const resolved = await this.opts.changes.resolve(target).catch(() => null);
    const comments: ReviewComment[] = [];
    for (const row of rows) {
      const lines = resolved ? await this.content(resolved, row.path, row.side) : null;
      const quote = linesOf(row.quote);
      const start = lines ? anchor(lines, quote, row.line_start) : null;
      if (start !== null && start !== row.line_start) {
        row.line_start = start;
        row.line_end = start + quote.length - 1;
        this.db
          .query("UPDATE review_comments SET line_start = ?, line_end = ? WHERE id = ?")
          .run(row.line_start, row.line_end, row.id);
      }
      comments.push(toComment(row, start === null));
    }
    return comments;
  }

  /** A draft on lines of a file; the quote is read here, from the file itself. */
  async add(input: NewReviewComment): Promise<ReviewComment> {
    if (!input.body.trim()) throw new FlightdeckError("bad_request", "comentário vazio");
    const resolved = await this.opts.changes.resolve(input.target);
    const lines = await this.content(resolved, input.path, input.side);
    if (!lines) {
      throw new FlightdeckError("bad_request", `${input.path} não existe desse lado do diff`);
    }
    const { lineStart, lineEnd } = input;
    if (lineStart < 1 || lineEnd < lineStart || lineEnd > lines.length) {
      throw new FlightdeckError(
        "bad_request",
        `linhas ${lineStart}–${lineEnd} fora de ${input.path}`,
      );
    }
    const row: Row = {
      id: ulid(this.now()),
      target: input.target,
      path: input.path,
      side: input.side,
      line_start: lineStart,
      line_end: lineEnd,
      quote: lines.slice(lineStart - 1, lineEnd).join("\n"),
      body: input.body,
      state: "draft",
      created_at: new Date(this.now()).toISOString(),
      sent_at: null,
    };
    this.db
      .query(
        `INSERT INTO review_comments (id, target, path, side, line_start, line_end, quote, body,
           state, created_at, sent_at)
         VALUES ($id, $target, $path, $side, $line_start, $line_end, $quote, $body, $state,
           $created_at, $sent_at)`,
      )
      .run({ ...row });
    return toComment(row, false);
  }

  /** A draft's text; a sent comment is history and stays as it went. */
  async update(id: string, body: string): Promise<ReviewComment | null> {
    const row = this.row(id);
    if (row.state !== "draft") throw new FlightdeckError("invalid_state", "comentário já enviado");
    if (!body.trim()) throw new FlightdeckError("bad_request", "comentário vazio");
    this.db.query("UPDATE review_comments SET body = ? WHERE id = ?").run(body, id);
    return (await this.list(row.target)).find((c) => c.id === id) ?? null;
  }

  remove(id: string): void {
    this.db.query("DELETE FROM review_comments WHERE id = ?").run(id);
  }

  /**
   * Sends the target's drafts as one review: to the card's session, the managed session, the
   * channel of a terminal session, or back as text to copy. Marked sent only once delivered.
   */
  async send(target: string): Promise<ReviewSent> {
    const drafts = this.db
      .query<Row, [string]>(
        "SELECT * FROM review_comments WHERE target = ? AND state = 'draft' ORDER BY created_at, rowid",
      )
      .all(target);
    if (drafts.length === 0) {
      throw new FlightdeckError("invalid_state", "nenhum comentário em rascunho");
    }
    const resolved = await this.opts.changes.resolve(target);
    const text = reviewMessage(drafts.map((d) => toComment(d, false)));
    const via = this.deliver(resolved, text);
    const at = new Date(this.now()).toISOString();
    const mark = this.db.query(
      "UPDATE review_comments SET state = 'sent', sent_at = ? WHERE id = ?",
    );
    for (const draft of drafts) mark.run(at, draft.id);
    return { via, text, comments: drafts.length };
  }

  private deliver(resolved: ResolvedTarget, text: string): ReviewSent["via"] {
    if (resolved.cardId) {
      (this.opts.board as Board).message(resolved.cardId, text);
      return "card";
    }
    const id = resolved.claudeSessionId as string;
    const managed = this.db
      .query<{ id: string }, [string]>(
        "SELECT id FROM sessions WHERE claude_session_id = ? ORDER BY updated_at DESC LIMIT 1",
      )
      .get(id);
    if (managed) {
      this.opts.manager.send(managed.id, text);
      return "session";
    }
    const central = this.opts.central;
    return central && messageExternal(central, id, text) ? "terminal" : "copy";
  }

  private row(id: string): Row {
    const row = this.db.query<Row, [string]>("SELECT * FROM review_comments WHERE id = ?").get(id);
    if (!row) throw new FlightdeckError("not_found", `comentário ${id} não existe`);
    return row;
  }
}
