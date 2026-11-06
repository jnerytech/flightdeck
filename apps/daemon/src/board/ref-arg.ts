import { isBranchName } from "@flightdeck/protocol";
import { FlightdeckError } from "../errors.ts";

const invalid = (name: string) =>
  new FlightdeckError("bad_request", `${name} is not a valid branch name`, "branch_invalid", {
    name,
  });

/** A branch or a revision that `refArg` or `assertBranchName` checked: what the git helpers take (issue #369). */
export type Rev = string;

/**
 * A branch or revision that came from a project's settings, checked before it becomes an argument
 * of git: one that starts with `-` would be read as an option (`--output=`, `--exec=`), issue #345.
 * Only that is refused here, so a revision git accepts (`HEAD`, `origin/main`) still goes through.
 */
export function refArg(name: string): string {
  if (name === "" || name.startsWith("-")) throw invalid(name);
  return name;
}

/** A base branch a person sets must be a branch name, by the rules of `git check-ref-format`. */
export function assertBranchName(name: string): string {
  if (!isBranchName(name)) throw invalid(name);
  return name;
}
