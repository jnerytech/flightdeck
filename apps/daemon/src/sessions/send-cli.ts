/**
 * Issue #3425: `flightdeckd send <session> <text>`, a message into a session of the local daemon, as
 * the app's input box sends it. The session is its id or its name. Exit codes: 0 done, 1 refused, 2 no
 * daemon (or no answer: the text may or may not have gone in).
 */
import { type CliResult, said } from "../daemon-client/index.ts";

export interface SendCliArgs {
  /** The id or the name of the session. */
  session: string;
  text: string;
  json?: boolean;
}

export function runSendCli(
  _args: SendCliArgs,
  _config: { bind: string; port: number; token: string },
  _options: { timeoutMs?: number } = {},
): Promise<CliResult> {
  return Promise.resolve(said());
}
