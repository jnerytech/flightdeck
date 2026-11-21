/**
 * Issue #3619: `flightdeckd review list <target>`, the inline comments on the diff of a session, card,
 * terminal or project, from a terminal. It asks the daemon for what it already keeps and changes nothing.
 * Exit codes: 0 done, 1 refused, 2 no daemon.
 */
import {
  type CliResult,
  json,
  type RemoteTarget,
  runOnLocalDaemon,
  said,
} from "../daemon-client/index.ts";
import { commentJson, commentLines } from "./domain/review-cli-view.ts";

const DEFAULT_TIMEOUT_MS = 15_000;

export interface ReviewCliArgs {
  action: "list";
  /** `session:<id>`, `card:<id>`, `terminal:<id>` or `project:<id>`. */
  target: string;
  json?: boolean;
}

export function runReviewCli(
  args: ReviewCliArgs,
  config: { bind: string; port: number; token: string },
  options: { timeoutMs?: number; remote?: RemoteTarget } = {},
): Promise<CliResult> {
  return runOnLocalDaemon({
    config,
    ...(options.remote ? { remote: options.remote } : {}),
    clientName: "flightdeck-review",
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    perform: async (daemon) => {
      const { comments } = await daemon.call("review.list", { target: args.target });
      return args.json
        ? json({ comments: comments.map(commentJson) })
        : said(...commentLines(args.target, comments));
    },
  });
}
