/**
 * Issue #3425: `flightdeckd approve|deny <request>`, one answer to one open permission request of the
 * local daemon. Exit codes: 0 done, 1 refused, 2 no daemon.
 */
import { type CliResult, said } from "../daemon-client/index.ts";

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

export function runAnswerCli(
  _args: AnswerCliArgs,
  _config: { bind: string; port: number; token: string },
  _options: { timeoutMs?: number } = {},
): Promise<CliResult> {
  return Promise.resolve(said());
}
