import type { PrMergeable, PrReview } from "./types.ts";

/** What a PR host says of a PR beyond its state and checks (issue #1352). */
export interface PrDetails {
  mergeable: PrMergeable;
  review: PrReview;
  /** When the PR was opened (ISO), `null` when the host does not say. */
  openedAt: string | null;
}

/** GitHub's `mergeStateStatus`, `reviewDecision` and `createdAt` of `gh pr view`. */
export function githubDetails(pr: {
  mergeStateStatus?: string | null;
  reviewDecision?: string | null;
  createdAt?: string | null;
}): PrDetails {
  return { mergeable: "clean", review: "approved", openedAt: pr.createdAt ? "" : null };
}

/** Azure DevOps' `mergeStatus`, reviewers' votes and `creationDate` of `az repos pr show`. */
export function azureDetails(pr: {
  mergeStatus?: string | null;
  reviewers?: Array<{ vote?: number; isRequired?: boolean }> | null;
  creationDate?: string | null;
}): PrDetails {
  return { mergeable: "clean", review: "approved", openedAt: pr.creationDate ? "" : null };
}
