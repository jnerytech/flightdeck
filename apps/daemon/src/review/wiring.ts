import type { Database } from "bun:sqlite";
import { DEFAULT_MODELS, SecretScanner } from "@flightdeck/protocol";
import { readSpecText } from "../board/index.ts";
import { credential } from "../permissions/index.ts";
import { packPersonas } from "../personas/index.ts";
import { type DomainModule, serverGroup } from "../server/index.ts";
import { ulid } from "../ulid.ts";
import { type CardReviewDeps, CardReviews, reviewHold } from "./card-review.ts";
import { Changes, type ChangesOptions } from "./changes.ts";
import { ReviewComments, type ReviewCommentsOptions } from "./comments.ts";
import { ReviewFiles } from "./files.ts";
import { type SessionCommitDeps, SessionCommits } from "./session-commit.ts";
import { SessionFiles } from "./session-files.ts";
import { SessionPrs } from "./session-pr.ts";

/** A gate that holds new work: null when it lets it through. */
interface Gate {
  blocked(): object | null;
}

/**
 * What the review of the cards and sessions is built from: the change set's ports and the ones its
 * classes read.
 */
export interface ReviewDeps extends ChangesDeps {
  manager: ReviewCommentsOptions["manager"];
  board: NonNullable<ReviewCommentsOptions["board"]>;
  central: ReviewCommentsOptions["central"];
  /** The runtime's one-shot call; without one there is no card review. */
  complete: CardReviewDeps["complete"] | undefined;
  /** The vault's held values: the review's redaction hides them too. */
  heldValues: () => string[];
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
 * Issue #1439 (issue #1593): the review's module: the change set's services, the comments, and the
 * card review when the runtime can answer a one-shot call, in the server's review group.
 */
export function createReview(deps: ReviewDeps): {
  modules: readonly [DomainModule<"review">];
  review: ReturnType<typeof reviewGroup>;
} {
  const review = reviewGroup(deps);
  const module: DomainModule<"review"> = {
    server: { review: serverGroup<"review", "cardReview">()(review) },
  };
  return { modules: [module] as const, review };
}

function reviewGroup(deps: ReviewDeps) {
  const { db, manager, board, central, complete, gates, usage } = deps;
  const { changes, sessionCommits, sessionPrs, files, sessionFiles } = createChanges(deps);
  const reviewComments = new ReviewComments({ db, changes, manager, board, central });
  // The host's scanner with the vault's held values: neither reaches the reviewer.
  const scanner = new SecretScanner(deps.heldValues);
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
        // The spec file of the card, with readSpec's checks (its real place inside the worktree, no
        // link on the way, no hard link), never a credential file, at most 20 KB.
        spec: async (id) => {
          const { specPath, worktreePath } = board.getCard(id);
          if (!specPath || !worktreePath || credential(specPath)) return undefined;
          return (await readSpecText(worktreePath, specPath, 20_000)) ?? undefined;
        },
        hold: (projectId) =>
          reviewHold({
            paused: gates.hostPause.blocked() !== null,
            quota: gates.quota.blocked() !== null,
            memory: gates.memory.blocked() !== null,
            budget: board.budgetHeld(projectId),
          }),
        complete,
        comments: reviewComments,
        redact: (text) => scanner.redact(text, false),
        persona: (language) => packPersonas(language).find((p) => p.id === "revisor")?.body ?? "",
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
  return {
    changes,
    sessionCommits,
    sessionPrs,
    comments: reviewComments,
    ...(cardReviews ? { cardReview: cardReviews } : {}),
    files,
    sessionFiles,
  };
}

/**
 * What the diffs of the sessions and cards, a plain session's commit and PR, the files viewer and
 * who wrote each file are built from.
 */
export interface ChangesDeps {
  db: Database;
  board: NonNullable<ChangesOptions["board"]>;
  log: (message: string) => void;
  /** A terminal's folder is a target of the Files viewer (#506). */
  terminals: ChangesOptions["terminals"];
  /** A project's checkout is one too, inside these (#797). */
  allowedRoots: readonly string[];
  /** The host's scanner: a session's branch and its PR go public. */
  scanner: SessionCommitDeps["scanner"];
  /** The files viewer copies a reverted file under it (`review-trash/`), for its undo. */
  dataDir: string;
}

/**
 * Issue #1593: the diff of every session and card, for the review (phase 11), and a plain
 * session's changes committed on a new branch in its own checkout, pushed and opened as a PR
 * (#1133). A card's worktree is the board's: it commits and opens its own PR. The files viewer
 * reads, reverts and edits on the same diffs, inside the allowed roots.
 */
export function createChanges(deps: ChangesDeps) {
  const { db, board, log, terminals, allowedRoots, scanner, dataDir } = deps;
  const changes = new Changes({ db, board, log, terminals, allowedRoots });
  const isCardWorktree = (root: string) => board.projectForCwd(root)?.card != null;
  const sessionCommits = new SessionCommits({ changes, scanner, isCardWorktree });
  const sessionPrs = new SessionPrs({
    changes,
    commits: sessionCommits,
    scanner,
    isCardWorktree,
    projectProvider: (root) => board.projectForCwd(root)?.project.prProvider ?? null,
  });
  const files = new ReviewFiles({ changes, dataDir, allowedRoots });
  const sessionFiles = new SessionFiles({ db });
  return { changes, sessionCommits, sessionPrs, files, sessionFiles };
}
