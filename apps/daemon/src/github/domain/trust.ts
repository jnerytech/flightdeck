/**
 * GitHub authors whose content is yours: you, and people with write access to the repository.
 * Content from anyone else is marked external (#1601).
 */
export const TRUSTED_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

/**
 * A PR comment from outside the team: GitHub says what its author is to the repository, and anything but an owner, a
 * member or a collaborator (a missing value included) is outside. Azure DevOps has no such field, its `authorIdentity`
 * is set, and nothing is marked there.
 */
export function isExternalComment(comment: {
  authorAssociation: string | null;
  authorIdentity: string | null;
}): boolean {
  if (comment.authorIdentity !== null) return false;
  return !TRUSTED_ASSOCIATIONS.has((comment.authorAssociation ?? "").toUpperCase());
}
