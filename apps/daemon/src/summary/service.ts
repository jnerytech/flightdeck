import type { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";
import type { SecretScanner, SessionRecap } from "@flightdeck/protocol";
import { FlightdeckError } from "../errors.ts";
import { buildSummary, sessionCost } from "./summary.ts";

export interface SummaryServiceOptions {
  db: Database;
  scanner: Pick<SecretScanner, "scan">;
}

/** The summary of a session, from its transcript on disk and its usage entries. */
export class SummaryService {
  constructor(private readonly opts: SummaryServiceOptions) {}

  get(
    claudeSessionId: string,
    extra: { question?: string | undefined; state?: string | undefined } = {},
  ): SessionRecap {
    const row = this.opts.db
      .query<{ path: string | null }, [string]>(
        "SELECT file_path AS path FROM history_sessions WHERE claude_session_id = ?",
      )
      .get(claudeSessionId);
    if (!row?.path || !existsSync(row.path)) {
      throw new FlightdeckError(
        "not_found",
        `transcript ${claudeSessionId} not indexed`,
        "transcript_not_indexed",
        { id: claudeSessionId },
      );
    }
    return buildSummary({
      main: readFileSync(row.path, "utf8"),
      costUsd: sessionCost(this.opts.db, claudeSessionId),
      pending: extra.question ? { kind: "question", text: extra.question } : null,
      state: extra.state ?? "idle",
      scanner: this.opts.scanner,
    });
  }
}
