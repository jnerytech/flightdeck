/**
 * Issue #3622: what `message history|watch|rules` take, checked before anything is sent. The parser in
 * `args.ts` reads the verb and adds the usage text to the problem this names. `message list|send|idle|read|team`
 * are the verbs of a managed session's tools (they need its identity) and take none of these flags.
 */
import { MessageStatus } from "@flightdeck/protocol";
import type { MessageAdminCliArgs } from "../../messaging/index.ts";
import type { CliArgs } from "./cli-args.ts";
import type { Handler } from "./flag-handlers.ts";
import { oneOf } from "./vault-args.ts";

/** The verbs of `message` that ask the daemon as a person, not as a session. */
export const MESSAGE_ADMIN_VERBS = ["history", "watch", "rules"] as const;

/** The flags only `message history` takes, for the parser's table of flags. */
export const MESSAGE_FLAGS: Record<string, Handler> = {
  "--team": (args, _reader, value) => {
    args.messageTeam = value();
  },
  "--with-host": (args, _reader, value) => {
    args.withHost = value();
  },
  "--status": (args, _reader, value) => {
    args.messageStatus = oneOf("--status", value(), MessageStatus.options);
  },
};

const isAdmin = (args: CliArgs) =>
  args.command === "message" &&
  (MESSAGE_ADMIN_VERBS as readonly string[]).includes(args.action ?? "");

/** A flag outside the verbs that take it. */
export function messageProblem(args: CliArgs): string | undefined {
  const onMessage = args.command === "message";
  const typed: Array<[string, boolean]> = [
    ["--team", args.messageTeam !== undefined],
    ["--with-host", args.withHost !== undefined],
    ["--status", args.messageStatus !== undefined],
    // `--days` and `--limit` are other commands' flags too: only `message` is checked here.
    ["--days", onMessage && args.days !== undefined],
    ["--limit", onMessage && args.limit !== undefined],
    // `--session` is a filter of `history`; `watch` and `rules` take none (the other verbs read it as an operand).
    ["--session", isAdmin(args) && args.action !== "history" && args.session !== undefined],
  ];
  for (const [flag, given] of typed)
    if (given && !(onMessage && args.action === "history"))
      return `${flag}: this flag only applies to flightdeckd message history`;
  if (onMessage && !isAdmin(args))
    for (const [flag, given] of [
      ["--json", args.json === true],
      ["--host", args.host !== undefined],
    ] as const)
      if (given)
        return `${flag}: this flag only applies to flightdeckd message history, watch and rules`;
  return undefined;
}

/** What the runner takes for `message history|watch|rules`; undefined for the verbs of a session's tools. */
export function messageAdminCliArgs(args: CliArgs): MessageAdminCliArgs | undefined {
  if (!isAdmin(args)) return undefined;
  return {
    action: args.action as MessageAdminCliArgs["action"],
    ...(args.messageTeam === undefined ? {} : { team: args.messageTeam }),
    ...(args.session === undefined ? {} : { session: args.session }),
    ...(args.withHost === undefined ? {} : { withHost: args.withHost }),
    ...(args.messageStatus === undefined ? {} : { status: args.messageStatus }),
    ...(args.days === undefined ? {} : { days: args.days }),
    ...(args.limit === undefined ? {} : { limit: args.limit }),
    ...(args.json ? { json: true } : {}),
  };
}
