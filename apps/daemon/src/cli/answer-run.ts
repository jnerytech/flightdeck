import type { CliResult, RemoteTarget } from "../daemon-client/index.ts";
import type { CliArgs } from "./domain/cli-args.ts";

type Config = { bind: string; port: number; token: string };

/**
 * What `approve` and `deny` run once `asking` has the daemon's config (or the paired host's): one answer to
 * one open permission request. The permissions domain loads only when a verb runs. It lives apart from
 * `commands.ts`, which is at the size limit.
 */
export const answerRun =
  (decision: "allow" | "deny", args: CliArgs) =>
  async (config: Config, remote?: RemoteTarget): Promise<CliResult> =>
    (await import("../permissions/index.ts")).runAnswerCli(
      {
        decision,
        request: args.requestId ?? "",
        ...(args.answerMessage === undefined ? {} : { message: args.answerMessage }),
        ...(args.json ? { json: true } : {}),
      },
      config,
      remote ? { remote } : {},
    );
