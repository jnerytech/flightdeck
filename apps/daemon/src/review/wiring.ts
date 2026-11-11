import type { Database } from "bun:sqlite";
import { DEFAULT_MODELS } from "@flightdeck/protocol";
import { ulid } from "../ulid.ts";
import { type CardReviewDeps, CardReviews, reviewHold } from "./card-review.ts";
import { ReviewComments, type ReviewCommentsOptions } from "./comments.ts";

/** A gate that holds new work: null when it lets it through. */
interface Gate {
  blocked(): object | null;
}

/** What the review of the cards and sessions is built from: the ports its classes read. */
export interface ReviewDeps {
  db: Database;
  changes: ReviewCommentsOptions["changes"];
  manager: ReviewCommentsOptions["manager"];
  board: NonNullable<ReviewCommentsOptions["board"]>;
  central: ReviewCommentsOptions["central"];
  /** The runtime's one-shot call; without one there is no card review. */
  complete: CardReviewDeps["complete"] | undefined;
  spec: CardReviewDeps["spec"];
  redact: CardReviewDeps["redact"];
  persona: CardReviewDeps["persona"];
  gates: { hostPause: Gate; quota: Gate; memory: Gate };
  usage: {
    record(entry: {
      at: string;
      model: string;
      tokens: Parameters<CardReviewDeps["record"]>[2];
      projectPath: string;
      messageId: string;
      origin: "card";
    }): void;
  };
}

/**
 * Issue #1439 (issue #1593): the review's comments, and the card review when the runtime can
 * answer a one-shot call.
 */
export function createReview(deps: ReviewDeps) {
  const { db, changes, manager, board, central, complete, gates, usage } = deps;
  const reviewComments = new ReviewComments({ db, changes, manager, board, central });
  const cardReviews = complete
    ? new CardReviews({
        db,
        card: (id) => {
          const card = board.getCard(id);
          return {
            id: card.id,
            projectId: card.projectId,
            title: card.title,
            description: card.description,
            worktreePath: card.worktreePath,
            running:
              card.queued ||
              ["starting", "running", "awaiting_permission"].includes(card.sessionStatus ?? ""),
          };
        },
        diff: (id) => board.diff(id),
        spec: deps.spec,
        hold: (projectId) =>
          reviewHold({
            paused: gates.hostPause.blocked() !== null,
            quota: gates.quota.blocked() !== null,
            memory: gates.memory.blocked() !== null,
            budget: board.budgetHeld(projectId),
          }),
        complete,
        comments: reviewComments,
        redact: deps.redact,
        persona: deps.persona,
        model: DEFAULT_MODELS.host.careful,
        record: (cardId, worktree, tokens) =>
          usage.record({
            at: new Date().toISOString(),
            model: tokens.model,
            tokens,
            projectPath: worktree,
            messageId: `card-review-${cardId}-${ulid()}`,
            origin: "card",
          }),
      })
    : undefined;
  return { reviewComments, cardReviews };
}
