/**
 * The publish domain's public entry (#1589): what takes a change from a person's repository to a
 * pull request. A commit of a few files on a new branch through a temporary index, the push and the
 * PR opened through the provider, and the check that no secret goes public in its title or body.
 * Another domain imports from here, never a file inside.
 */
export { commitBase, commitOnNewBranch, safeGit } from "./branch-commit.ts";
export { assertNoSecretInPr, withoutCredentials } from "./domain/pr-secrets.ts";
export { publishPr } from "./publish-pr.ts";
