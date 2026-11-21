/**
 * Issue #3619: `flightdeckd review list|add|update|remove|send`, the inline comments on the diff of a session,
 * card or terminal, from a terminal. `list` changes nothing; `add`, `update` and `remove` keep drafts in the
 * daemon, and `send` puts the drafts into the session as one message. A write that gets no answer exits 2.
 * Exit codes: 0 done, 1 refused, 2 no daemon.
 */
import {
  type CliResult,
  failure,
  json,
  type RemoteTarget,
  runOnLocalDaemon,
  said,
} from "../daemon-client/index.ts";
import { commentHead, commentJson, commentLines, sentLines } from "./domain/review-cli-view.ts";

const DEFAULT_TIMEOUT_MS = 15_000;

export type ReviewCliArgs =
  | {
      action: "list";
      /** `session:<id>`, `card:<id>`, `terminal:<id>` or `project:<id>`. */
      target: string;
      json?: boolean;
    }
  | {
      action: "add";
      target: string;
      path: string;
      side: "new" | "old";
      lineStart: number;
      lineEnd: number;
      body: string;
      json?: boolean;
    }
  | { action: "update"; comment: string; body: string; json?: boolean }
  | { action: "remove"; comment: string; json?: boolean }
  | { action: "send"; target: string; language?: "en" | "pt-BR"; confirm?: true; json?: boolean };

/** What a write that got no answer may have done, and what to look at before repeating it. */
const UNSURE: Record<"add" | "update" | "remove" | "send", string> = {
  add: "; the comment may or may not have been added: run review list on the target before you add it again",
  update: "; the text may or may not have changed: run review list on the target to see it",
  remove: "; the comment may or may not be gone: run review list on the target to see it",
  send: "; the review may or may not have gone to the target: look at the session before you send it again",
};

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
    ...(args.action === "list" ? {} : { unsure: UNSURE[args.action] }),
    perform: async (daemon, note) => {
      switch (args.action) {
        case "list": {
          const { comments } = await daemon.call("review.list", { target: args.target });
          return args.json
            ? json({ comments: comments.map(commentJson) })
            : said(...commentLines(args.target, comments));
        }
        case "add": {
          note.wrote = true;
          const { action: _action, json: asJson, ...fields } = args;
          const comment = await daemon.call("review.add", fields);
          return asJson ? json(commentJson(comment)) : said(`added ${commentHead(comment)}`);
        }
        case "update": {
          note.wrote = true;
          const comment = await daemon.call("review.update", { id: args.comment, body: args.body });
          if (comment === null) return failure(1, `comment ${args.comment} no longer exists`);
          return args.json ? json(commentJson(comment)) : said(`updated ${commentHead(comment)}`);
        }
        case "remove": {
          note.wrote = true;
          await daemon.call("review.remove", { id: args.comment });
          return args.json ? json({ id: args.comment }) : said(`removed ${args.comment}`);
        }
        case "send": {
          note.wrote = true;
          const sent = await daemon.call("review.send", {
            target: args.target,
            ...(args.language ? { language: args.language } : {}),
          });
          return args.json ? json(sent) : said(...sentLines(sent));
        }
      }
    },
  });
}
