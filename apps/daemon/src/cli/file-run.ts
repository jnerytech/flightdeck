import type { CliResult, RemoteTarget } from "../daemon-client/index.ts";
import type { CliArgs } from "./domain/cli-args.ts";
import { fileCliArgs } from "./domain/file-args.ts";

/**
 * What `file list|read|search|dirs|files` runs once `asking` has the daemon's config (or the paired host's). The
 * files domain loads only when the verb runs: a hook, or a verb of another noun, starts without it (cli-startup
 * test). It lives apart from `commands.ts`, which is at the size limit.
 */
export const fileRun =
  (args: CliArgs, stdin?: ReadableStream<Uint8Array>) =>
  async (
    config: { bind: string; port: number; token: string },
    remote?: RemoteTarget,
  ): Promise<CliResult> =>
    (await import("../files/index.ts")).runFileCli(fileCliArgs(args), config, {
      ...(remote ? { remote } : {}),
      stdin,
    });
