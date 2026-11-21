/**
 * The review domain's public entry (#1589). It exports, for now, only the CLI runner of the inline
 * comments; the rest of the domain moves behind this entry with the remaining deep imports.
 */

export { type ReviewCliArgs, runReviewCli } from "./review-cli.ts";
