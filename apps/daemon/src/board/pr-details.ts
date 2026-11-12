import type { PrMergeable, PrReview } from "@flightdeck/protocol";

/** What a PR host says of a PR beyond its state and checks (issue #1352). */
export interface PrDetails {
  mergeable: PrMergeable;
  review: PrReview;
  /** When the PR was opened (ISO), `null` when the host does not say. */
  openedAt: string | null;
}

const GH_MERGEABLE: Record<string, PrMergeable> = {
  CLEAN: "clean",
  HAS_HOOKS: "clean",
  // Mergeable, with a check that is not required failing.
  UNSTABLE: "clean",
  DIRTY: "conflict",
  BLOCKED: "blocked",
  BEHIND: "blocked",
  DRAFT: "blocked",
};

const GH_REVIEW: Record<string, PrReview> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes_requested",
  REVIEW_REQUIRED: "required",
};

/** GitHub's `mergeStateStatus`, `reviewDecision` and `createdAt` of `gh pr view`. */
export function githubDetails(pr: {
  mergeStateStatus?: string | null;
  reviewDecision?: string | null;
  createdAt?: string | null;
}): PrDetails {
  return {
    mergeable: GH_MERGEABLE[pr.mergeStateStatus ?? ""] ?? "unknown",
    review: GH_REVIEW[pr.reviewDecision ?? ""] ?? "none",
    openedAt: pr.createdAt || null,
  };
}

const AZ_MERGEABLE: Record<string, PrMergeable> = {
  succeeded: "clean",
  conflicts: "conflict",
  rejectedByPolicy: "blocked",
};

/** Azure DevOps' `mergeStatus`, reviewers' votes and `creationDate` of `az repos pr show`. */
export function azureDetails(pr: {
  mergeStatus?: string | null;
  reviewers?: Array<{ vote?: number; isRequired?: boolean }> | null;
  creationDate?: string | null;
}): PrDetails {
  const reviewers = pr.reviewers ?? [];
  // Votes: 10 approved, 5 approved with suggestions, 0 none, -5 waiting for the author, -10 rejected.
  const votes = reviewers.map((reviewer) => reviewer.vote ?? 0);
  let review: PrReview = "none";
  if (votes.some((vote) => vote < 0)) review = "changes_requested";
  else if (votes.some((vote) => vote > 0)) review = "approved";
  else if (reviewers.some((reviewer) => reviewer.isRequired)) review = "required";
  return {
    mergeable: AZ_MERGEABLE[pr.mergeStatus ?? ""] ?? "unknown",
    review,
    openedAt: pr.creationDate || null,
  };
}
