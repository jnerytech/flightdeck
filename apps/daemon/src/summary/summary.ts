/**
 * Phase 30: a short summary of a session, built from its transcript with no model call: what was
 * asked, what was done, the files touched, the cost and the open question.
 */
import type { Database } from "bun:sqlite";
import type { SecretScanner, SessionRecap } from "@flightdeck/protocol";
import { promptText } from "../transcript-text.ts";

export interface PendingQuestion {
  kind: "permission" | "question";
  text: string;
}

export interface SummaryInput {
  /** The session's transcript (JSONL). */
  main: string;
  costUsd: number | null;
  pending: PendingQuestion | null;
  state: string;
  scanner: Pick<SecretScanner, "scan">;
}

type Json = Record<string, unknown>;

const obj = (value: unknown): Json =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};

/** The most files a summary lists; the rest is only counted. */
const MAX_FILES = 12;

/** Tools that change a file, and the input field that names it. */
const FILE_TOOLS: Record<string, string> = {
  Edit: "file_path",
  Write: "file_path",
  NotebookEdit: "notebook_path",
};

/** Hard limits, in characters. */
const LIMITS = { asked: 280, done: 480, question: 280 } as const;
const HIDDEN = "[secret hidden]";

/** One line, cut on a character (not a UTF-16 unit) boundary, or a marker when it holds a secret. */
function fit(
  value: string | null,
  limit: number,
  scanner: Pick<SecretScanner, "scan">,
): string | null {
  if (value === null) return null;
  const flat = value.replace(/\s+/g, " ").trim();
  if (scanner.scan(flat).length > 0) return HIDDEN;
  const chars = [...flat];
  return chars.length > limit ? `${chars.slice(0, limit - 1).join("")}…` : flat;
}

export function buildSummary(input: SummaryInput): SessionRecap {
  let asked: string | null = null;
  let done: string | null = null;
  const touched = new Set<string>();
  for (const raw of input.main.split("\n")) {
    let entry: Json;
    try {
      entry = obj(JSON.parse(raw));
    } catch {
      continue;
    }
    if (entry.isSidechain === true) continue;
    const message = obj(entry.message);
    if (entry.type === "user") {
      asked ??= promptText(message.content);
    } else if (entry.type === "assistant" && Array.isArray(message.content)) {
      const text: string[] = [];
      for (const block of message.content.map((item) => obj(item))) {
        if (block.type === "text" && typeof block.text === "string") text.push(block.text);
        const field = block.type === "tool_use" ? FILE_TOOLS[String(block.name)] : undefined;
        const path = field ? obj(block.input)[field] : undefined;
        if (typeof path === "string") touched.add(path);
      }
      if (text.length > 0) done = text.join("\n").trim();
    }
  }
  const files = [...touched];
  return {
    asked: fit(asked, LIMITS.asked, input.scanner),
    done: fit(done, LIMITS.done, input.scanner),
    files: files
      .slice(0, MAX_FILES)
      .map((path) => (input.scanner.scan(path).length > 0 ? HIDDEN : path)),
    filesMore: Math.max(0, files.length - MAX_FILES),
    costUsd: input.costUsd,
    question: fit(input.pending?.text ?? null, LIMITS.question, input.scanner),
    state: input.state,
    source: "transcript",
  };
}

/** The estimated cost of a session, from its usage entries; `null` without rows. */
export function sessionCost(db: Database, claudeSessionId: string): number | null {
  const row = db
    .query<{ cost: number | null }, [string]>(
      "SELECT SUM(cost_usd) AS cost FROM usage_entries WHERE claude_session_id = ?",
    )
    .get(claudeSessionId);
  return row?.cost ?? null;
}
