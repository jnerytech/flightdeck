/**
 * Issue #3425: `flightdeckd approve|deny <request>`, one answer to one open permission request of the
 * local daemon. It sends what the person said and nothing more: the daemon decides, so a high-risk
 * allow is refused there. `--hold` is still accepted but sends nothing: a terminal cannot hold a button or sign (#3439).
 * Exit codes: 0 done, 1 refused, 2 no daemon (or no answer: the request may or may not be answered).
 */
import {
  type CliResult,
  DaemonRefusal,
  failure,
  json,
  type RemoteTarget,
  runOnLocalDaemon,
  said,
} from "../daemon-client/index.ts";
import { answerJson, answerLine, answerPayload, refusalLine } from "./domain/answer-view.ts";

export interface AnswerCliArgs {
  decision: "allow" | "deny";
  /** The id of the request, as `flightdeckd requests` lists it. */
  request: string;
  /** What the answer tells Claude. */
  message?: string;
  json?: boolean;
}

const DEFAULT_TIMEOUT_MS = 15_000;

const UNSURE =
  "; the answer may or may not have been recorded: list the open requests to see if it is still open";

export function runAnswerCli(
  args: AnswerCliArgs,
  config: { bind: string; port: number; token: string },
  options: { timeoutMs?: number; remote?: RemoteTarget } = {},
): Promise<CliResult> {
  return runOnLocalDaemon({
    config,
    ...(options.remote ? { remote: options.remote } : {}),
    clientName: "flightdeck-answer",
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    unsure: UNSURE,
    perform: async (daemon, note) => {
      note.wrote = true;
      try {
        await daemon.call("permission.respond", answerPayload(args));
      } catch (error) {
        const line = error instanceof DaemonRefusal ? refusalLine(error, args) : null;
        if (line) return failure(1, line);
        throw error;
      }
      return args.json ? json(answerJson(args)) : said(answerLine(args));
    },
  });
}
