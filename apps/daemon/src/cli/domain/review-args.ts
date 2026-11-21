/**
 * Issue #3619: `flightdeckd review <verb>`, the inline comments on a diff from a shell. The parser in
 * `args.ts` reads the words after `review` here; `--json` and `--host` are checked there with the others'.
 */
import type { ReviewCliArgs } from "../../review/index.ts";
import { type ArgReader, operand, subAction } from "./arg-reader.ts";
import type { CliArgs } from "./cli-args.ts";

const REVIEW_ACTIONS = ["list"] as const;

/** `review list <target>`. */
export function readReview(args: CliArgs, reader: ArgReader): void {
  args.command = "review";
  args.action = subAction(reader, REVIEW_ACTIONS, "invalid review action");
  args.reviewTarget = operand(reader, "the target");
}

/** What the review runner takes from the parsed arguments. */
export function reviewCliArgs(args: CliArgs): ReviewCliArgs {
  return {
    action: "list",
    target: args.reviewTarget ?? "",
    ...(args.json ? { json: true as const } : {}),
  };
}
