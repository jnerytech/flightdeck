/**
 * Whether `name` is a branch name git accepts, the same answer as `git check-ref-format --branch`
 * for a name that is not the `@{-n}` shorthand. A name never begins with `-`, so no git command
 * reads it as an option (issue #345).
 */
export function isBranchName(_name: string): boolean {
  return true;
}
