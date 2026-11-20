/**
 * Issue #3425: `flightdeckd send <session> <text>`, a message into a session of the local daemon, as
 * the app's input box sends it. The session is its id or its name. Exit codes: 0 done, 1 refused, 2 no
 * daemon (or no answer: the text may or may not have gone in).
 */
import {
  type CliResult,
  json,
  resolveSession,
  runOnLocalDaemon,
  said,
} from "../daemon-client/index.ts";
import { sendJson, sendLine } from "./domain/send-view.ts";

export interface SendCliArgs {
  /** The id or the name of the session. */
  session: string;
  text: string;
  json?: boolean;
}

const DEFAULT_TIMEOUT_MS = 15_000;

const UNSURE =
  "; the text may or may not have gone into the session: look at the session before you send it again";

export function runSendCli(
  args: SendCliArgs,
  config: { bind: string; port: number; token: string },
  options: { timeoutMs?: number } = {},
): Promise<CliResult> {
  return runOnLocalDaemon({
    config,
    clientName: "flightdeck-send",
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    unsure: UNSURE,
    perform: async (daemon, note) => {
      const { sessions } = await daemon.call("session.list", {});
      const ref = resolveSession(sessions, args.session);
      if ("refusal" in ref) return ref.refusal;
      note.wrote = true;
      const { queued } = await daemon.call("session.send", { sessionId: ref.id, text: args.text });
      return args.json ? json(sendJson(ref.id, queued)) : said(sendLine(ref.id, queued));
    },
  });
}
