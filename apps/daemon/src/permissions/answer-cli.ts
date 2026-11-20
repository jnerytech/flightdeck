/**
 * Issue #3425: `flightdeckd approve|deny <request>`, one answer to one open permission request of the
 * local daemon. It sends what the person said and nothing more: the daemon decides, so a high-risk
 * allow without `--hold` is refused there, and `--hold` is the person's own assertion, not a proof.
 * Exit codes: 0 done, 1 refused, 2 no daemon (or no answer: the request may or may not be answered).
 */
import {
  type CliResult,
  DaemonRefusal,
  failure,
  json,
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
  /** `--hold`: the person's own assertion that the Approve was held; a high-risk allow needs it. */
  hold?: boolean;
  json?: boolean;
}

const DEFAULT_TIMEOUT_MS = 15_000;

const UNSURE =
  "; the answer may or may not have been recorded: list the open requests to see if it is still open";

export function runAnswerCli(
  args: AnswerCliArgs,
  config: { bind: string; port: number; token: string },
  options: { timeoutMs?: number } = {},
): Promise<CliResult> {
  return runOnLocalDaemon({
    config,
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
