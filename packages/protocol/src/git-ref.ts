/** What a ref name may not hold, anywhere: controls, space, `~ ^ : ? * [ \`, `..` and `@{`. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: the control characters are the point
const FORBIDDEN = /[\u0000- \u007f~^:?*[\\]|\.\.|@\{/u;

/**
 * Whether `name` is a branch name git accepts, the same answer as `git check-ref-format --branch`
 * for a name that is not the `@` or `@{-n}` shorthand of the current branch. A name never begins with `-`, so no git command
 * reads it as an option (issue #345).
 */
export function isBranchName(name: string): boolean {
  // A leading `@` is legal for git but `az` reads `@file` as a file: refused here (issue #345).
  if (name === "" || name === "HEAD" || name.startsWith("-") || name.startsWith("@")) return false;
  if (FORBIDDEN.test(name)) return false;
  if (name.endsWith(".") || name.endsWith("/")) return false;
  // No component starts with a dot or ends with `.lock`, and none is empty (no `//`, no leading `/`).
  return name
    .split("/")
    .every((part) => part !== "" && !part.startsWith(".") && !part.endsWith(".lock"));
}
