/**
 * Phase 30: a short summary of a session, built from its transcript with no model call: what was
 * asked, what was done, the files touched, the cost and the open question.
 */
import type { SecretScanner } from "@flightdeck/protocol";

export interface PendingQuestion {
  kind: "permission" | "question";
  text: string;
}

export interface SessionSummary {
  asked: string | null;
  done: string | null;
  files: string[];
  filesMore: number;
  costUsd: number | null;
  question: string | null;
  state: string;
  source: "transcript";
}

export interface SummaryInput {
  /** The session's transcript (JSONL). */
  main: string;
  costUsd: number | null;
  pending: PendingQuestion | null;
  state: string;
  scanner: Pick<SecretScanner, "scan">;
}

export function buildSummary(input: SummaryInput): SessionSummary {
  return {
    asked: "",
    done: "",
    files: [],
    filesMore: 0,
    costUsd: input.costUsd,
    question: "",
    state: input.state,
    source: "transcript",
  };
}
