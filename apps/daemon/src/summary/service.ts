import type { Database } from "bun:sqlite";
import { readFile } from "node:fs/promises";
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

  async get(
    claudeSessionId: string,
    extra: { question?: string | undefined; state?: string | undefined } = {},
  ): Promise<SessionRecap> {
    const row = this.opts.db
      .query<{ path: string | null }, [string]>(
        "SELECT file_path AS path FROM history_sessions WHERE claude_session_id = ?",
      )
      .get(claudeSessionId);
    const main = row?.path ? await readFile(row.path, "utf8").catch(() => null) : null;
    if (main === null) {
      throw new FlightdeckError(
        "not_found",
        `transcript ${claudeSessionId} not indexed`,
        "transcript_not_indexed",
        { id: claudeSessionId },
      );
    }
    return buildSummary({
      main,
      costUsd: sessionCost(this.opts.db, claudeSessionId),
      pending: extra.question ? { kind: "question", text: extra.question } : null,
      state: extra.state ?? "idle",
      scanner: this.opts.scanner,
    });
  }
}
