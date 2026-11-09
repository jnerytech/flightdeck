/**
 * Issue #1439 (docs/decisions/2026-11-09-second-opinion-review.md): a card's second-opinion review.
 * One stored review per diff (written as `running` before the call), an in-flight lock, 3 a card a
 * day, refused under the host's holds; the call is tool-less and capped; its findings anchor as
 * reviewer drafts, the rest go to the summary; what it used is recorded, also when it fails.
 */
import type { Database } from "bun:sqlite";
import type { CardDiff } from "@flightdeck/protocol";
import type { UsageTokens } from "../costs/usage-indexer.ts";
import type { CompleteOptions, CompleteResult } from "../runtime/types.ts";
import type { NewReviewComment } from "./comments.ts";
import type { Finding } from "./second-opinion.ts";

/** What the review needs of a card. */
export interface ReviewedCard {
  id: string;
  projectId: string;
  title: string;
  description: string;
  worktreePath: string | null;
  /** A run or a session of the card is going. */
  running: boolean;
}

export interface CardReviewDeps {
  db: Database;
  card(cardId: string): ReviewedCard;
  diff(cardId: string): Promise<CardDiff>;
  /** The card's spec file's text, when it has one. */
  spec(cardId: string): Promise<string | undefined>;
  /** The hold that refuses a review now (host paused, quota, memory, budget), or null. */
  hold(projectId: string): "paused" | "quota" | "memory" | "budget" | null;
  complete(opts: CompleteOptions): Promise<CompleteResult>;
  comments: { add(input: NewReviewComment): Promise<unknown> };
  redact(text: string): string;
  /** The Code reviewer persona's instructions. */
  persona: string;
  model: string;
  /** Records what a call used, against the card. */
  record(cardId: string, worktree: string, tokens: UsageTokens): void;
  now?: () => number;
}

export interface CardReviewResult {
  state: "done" | "failed";
  summary: string;
  /** How many findings became reviewer drafts. */
  anchored: number;
  /** Findings that anchored nowhere, for the summary. */
  loose: Finding[];
  /** This review was the stored one for the same diff: nothing was asked. */
  cached: boolean;
  /** The diff changed during the review: nothing was anchored. */
  moved: boolean;
}

/** The cap of one review call, in dollars (soft: the SDK checks it after the turn). */
export const REVIEW_BUDGET_USD = 0.5;
/** Reviews a card may ask for in 24 hours. */
export const REVIEWS_PER_DAY = 3;

export class CardReviews {
  constructor(readonly deps: CardReviewDeps) {}

  /** Reviews the card's diff now, or answers the stored review of the same diff. */
  async start(_cardId: string): Promise<CardReviewResult> {
    return { state: "failed", summary: "", anchored: 0, loose: [], cached: false, moved: false };
  }
}
