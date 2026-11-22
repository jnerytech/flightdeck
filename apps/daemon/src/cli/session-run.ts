import type { CliResult, RemoteTarget } from "../daemon-client/index.ts";
import type { ResolveDeps } from "../remote-hosts/index.ts";
import type { SessionCliArgs } from "../sessions/index.ts";
import type { CliArgs } from "./domain/cli-args.ts";
import { liveStream } from "./watch-stop.ts";

type Config = { bind: string; port: number; token: string };
type Deps = Parameters<typeof liveStream>[1] & { log: { error(line: string): void } };

/**
 * `session`: what `commands.ts` gives `asking`. Every verb asks one daemon, the local one or the host `--host` names, except
 * `teleport` (#3704), which asks two: that one reads its target host by name (`--to`) the way `--host` is read.
 */
export const sessionRun =
  (args: CliArgs, deps: Deps, remoteDeps: () => Promise<ResolveDeps>) =>
  async (config: Config, remote?: RemoteTarget): Promise<CliResult> => {
    if (args.action === "teleport") {
      const { resolveHost } = await import("../remote-hosts/index.ts");
      const to = await resolveHost(args.teleport?.to ?? "", await remoteDeps());
      if (!to.ok) return to.result;
      const { runTeleportCli } = await import("../teleport/index.ts");
      const live = liveStream(args, deps);
      return runTeleportCli(
        {
          session: args.sessionRef ?? "",
          repo: args.teleport?.repo ?? "",
          confirm: args.confirm === true,
          ...(args.json ? { json: true } : {}),
        },
        config,
        {
          target: to.target,
          ...(remote ? { remote } : {}),
          signal: live.signal,
          write: (line) => deps.log.error(line),
        },
      );
    }
    const { runSessionCli } = await import("../sessions/index.ts");
    return runSessionCli(
      {
        action: args.action as SessionCliArgs["action"],
        ...(args.sessionRef === undefined ? {} : { session: args.sessionRef }),
        ...(args.sessionValue === undefined ? {} : { value: args.sessionValue }),
        ...(args.sessionMeta === undefined ? {} : { meta: args.sessionMeta }),
        ...(args.claudeSessionId === undefined ? {} : { claudeSessionId: args.claudeSessionId }),
        ...(args.sessionStart === undefined ? {} : { start: args.sessionStart }),
        ...(args.json ? { json: true } : {}),
      },
      config,
      remote ? { remote } : {},
    );
  };
