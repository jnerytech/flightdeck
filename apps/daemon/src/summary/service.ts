import type { Database } from "bun:sqlite";
import type { SecretScanner, SessionRecap } from "@flightdeck/protocol";

export interface SummaryServiceOptions {
  db: Database;
  scanner: Pick<SecretScanner, "scan">;
}

/** The summary of a session, from its transcript on disk and its usage entries. */
export class SummaryService {
  constructor(private readonly opts: SummaryServiceOptions) {}

  get(
    _claudeSessionId: string,
    extra: { question?: string | undefined; state?: string | undefined } = {},
  ): SessionRecap {
    return {
      asked: "",
      done: "",
      files: [],
      filesMore: 0,
      costUsd: 0,
      question: extra.question ?? "",
      state: extra.state ?? "",
      source: "transcript",
    };
  }
}
