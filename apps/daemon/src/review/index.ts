/**
 * The review domain's public entry (#1589). It exports, for now, only the CLI runners of the inline
 * comments and of a target's changes; the rest of the domain moves behind this entry with the remaining deep imports.
 */

export { type ChangesCliArgs, runChangesCli } from "./changes-cli.ts";
export { type ReviewCliArgs, runReviewCli } from "./review-cli.ts";
