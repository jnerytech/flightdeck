/**
 * Issue #3514: `flightdeckd session interrupted|summary|files`, the read side of one session of the
 * local daemon. A session is its id or its name; `summary` and `files` ask about its Claude session.
 * Exit codes: 0 done, 1 refused, 2 no daemon.
 */
import {
  type CliResult,
  failure,
  json,
  type RemoteTarget,
  resolveSession,
  runOnLocalDaemon,
  said,
} from "../daemon-client/index.ts";
import type { SessionCliArgs } from "./domain/session-cli-args.ts";
import { filesLines, interruptedLines, recapLines } from "./domain/session-read-view.ts";
import { ACT_UNSURE, performAct } from "./session-act-cli.ts";
import { performStart, START_UNSURE } from "./session-start-cli.ts";

const DEFAULT_TIMEOUT_MS = 15_000;
const READS = ["interrupted", "summary", "files"];

export function runSessionCli(
  args: SessionCliArgs,
  config: { bind: string; port: number; token: string },
  options: { timeoutMs?: number; remote?: RemoteTarget } = {},
): Promise<CliResult> {
  const starts = args.action === "create" || args.action === "fork";
  return runOnLocalDaemon({
    config,
    ...(options.remote ? { remote: options.remote } : {}),
    clientName: "flightdeck-session",
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    unsure: starts ? START_UNSURE : ACT_UNSURE,
    perform: async (daemon, note) => {
      if (starts) return performStart(daemon, note, args);
      if (!READS.includes(args.action)) return performAct(daemon, note, args);
      if (args.action === "interrupted") {
        const result = await daemon.call("session.interrupted", {});
        return args.json ? json(result) : said(...interruptedLines(result.sessions));
      }
      const { sessions } = await daemon.call("session.list", {});
      const ref = resolveSession(sessions, args.session ?? "");
      if ("refusal" in ref) return ref.refusal;
      const claudeSessionId = sessions.find((s) => s.id === ref.id)?.claudeSessionId;
      if (!claudeSessionId) return failure(1, `${args.session} has no Claude session yet`);
      if (args.action === "files") {
        const result = await daemon.call("session.files", { claudeSessionId });
        return args.json ? json(result) : said(...filesLines(result.files));
      }
      const recap = await daemon.call("session.summary", { claudeSessionId });
      return args.json ? json(recap) : said(...recapLines(recap));
    },
  });
}
