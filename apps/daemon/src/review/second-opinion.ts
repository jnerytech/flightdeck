/**
 * Issue #1439 (docs/decisions/2026-11-09-second-opinion-review.md): the second-opinion review's pure
 * parts. The prompt is the card's text and its diff, credential files as a path only, all of it
 * redacted; the answer must match a schema; a finding is anchored only on an added line of a file of
 * the reviewed diff; a sent reviewer comment is framed by the daemon, never by the model.
 */
import type { DiffFile } from "@flightdeck/protocol";

export type Severity = "blocker" | "high" | "medium" | "low";

export interface Finding {
  path: string;
  line: number;
  severity: Severity;
  body: string;
}

export interface ReviewAnswer {
  summary: string;
  findings: Finding[];
}

/** What the card gives the review: its own text. */
export interface ReviewCard {
  title: string;
  description: string;
  criteria?: string;
  spec?: string;
}

/** The answer's JSON schema, for the SDK's `outputFormat`. */
export const REVIEW_SCHEMA: Record<string, unknown> = {};

/** The prompt: the card's text and the diff, credential files as a path, then `redact` over all. */
export function reviewPrompt(
  _card: ReviewCard,
  _files: DiffFile[],
  _truncated: boolean,
  _redact: (text: string) => string,
): string {
  return "";
}

/** The answer when it matches the schema, else null. */
export function parseReview(_text: string): ReviewAnswer | null {
  return null;
}

/** The new-side line numbers a file's hunks add or change. */
export function addedLines(_file: DiffFile): Set<number> {
  return new Set();
}

/** Splits findings: anchored on an added line of a file of the diff, or loose (for the summary). */
export function anchorFindings(
  findings: Finding[],
  _files: DiffFile[],
): { anchored: Finding[]; loose: Finding[] } {
  return { anchored: [], loose: findings };
}

/** A reviewer comment as the daemon sends it: a fixed frame, the body quoted. */
export function frameReviewerComment(_body: string): string {
  return "";
}
