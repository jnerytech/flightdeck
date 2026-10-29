import type { Database } from "bun:sqlite";
import type { SessionEventOf, UsageRow, UsageSummary } from "@flightdeck/protocol";

export interface UsageLedgerOptions {
  db: Database;
  /** The project a session's cwd belongs to (phase 5's `projectKey`). */
  projectKey: (cwd: string) => string;
  /** Milliseconds now. */
  now?: () => number;
  /** `YYYY-MM-DD` of an instant in the host's time zone. */
  day?: (ms: number) => string;
}

const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");

/** `YYYY-MM-DD` in the time zone of the host. */
export function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

interface Row {
  day: string;
  project_key: string;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  turns: number;
}

/** Cost, tokens and turns of the managed sessions, by day and project. */
export class UsageLedger {
  private readonly db: Database;
  private readonly now: () => number;
  private readonly day: (ms: number) => string;

  constructor(private readonly opts: UsageLedgerOptions) {
    this.db = opts.db;
    this.now = opts.now ?? Date.now;
    this.day = opts.day ?? localDay;
  }

  /**
   * One more turn, called before it is stored. Its `costUsd` is the session's running total,
   * so only the difference to the session's last stored `turn.result` counts (phase 6's rule).
   */
  record(sessionId: string, cwd: string, turn: SessionEventOf<"turn.result">): void {
    const last = this.db
      .query<{ payload: string }, [string]>(
        "SELECT payload FROM events WHERE session_id = ? AND type = 'turn.result' ORDER BY seq DESC LIMIT 1",
      )
      .get(sessionId);
    const previous = last ? ((JSON.parse(last.payload).costUsd as number | undefined) ?? 0) : 0;
    const cost = Math.max(0, (turn.costUsd ?? previous) - previous);
    this.db
      .query(
        `INSERT INTO usage_daily (day, project_key, cost_usd, input_tokens, output_tokens, turns)
         VALUES (?, ?, ?, ?, ?, 1)
         ON CONFLICT (day, project_key) DO UPDATE SET
           cost_usd = cost_usd + excluded.cost_usd,
           input_tokens = input_tokens + excluded.input_tokens,
           output_tokens = output_tokens + excluded.output_tokens,
           turns = turns + 1`,
      )
      .run(
        this.day(this.now()),
        this.opts.projectKey(cwd),
        cost,
        turn.usage?.inputTokens ?? 0,
        turn.usage?.outputTokens ?? 0,
      );
  }

  /** The last `days` days (today included), newest first, then by project. */
  summary(days = 7): UsageSummary {
    const now = this.now();
    const wanted = [...new Set(Array.from({ length: days }, (_, i) => this.day(now - i * DAY_MS)))];
    const rows = this.db
      .query<Row, string[]>(
        `SELECT * FROM usage_daily WHERE day IN (${wanted.map(() => "?").join(", ")})
         ORDER BY day DESC, project_key`,
      )
      .all(...wanted)
      .map(
        (row): UsageRow => ({
          day: row.day,
          projectKey: row.project_key,
          costUsd: row.cost_usd,
          inputTokens: row.input_tokens,
          outputTokens: row.output_tokens,
          turns: row.turns,
        }),
      );
    return { days, rows };
  }
}
