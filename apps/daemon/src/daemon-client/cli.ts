/**
 * The run of a `flightdeckd` command that asks the local daemon one thing (issues #1507, #3424): the
 * address check, the connection with the token of the config, a time limit, and the exit code and the
 * line for whatever goes wrong. Each command gives only what it asks (`perform`) and says what a write
 * that got no answer may have done. Exit codes: 0 done, 1 refused, 2 no daemon.
 */

import { CLOSE_UNAUTHORIZED } from "@flightdeck/protocol";
import { addressRefusal, type CliResult, failure, TimedOut } from "./cli-view.ts";
import {
  ConnectionClosed,
  DaemonClient,
  DaemonRefusal,
  DaemonUnreachable,
  daemonUrl,
} from "./client.ts";

/** A host reached by name (issue #3429): its address was judged already, and its token stays in a closure. */
export interface RemoteTarget {
  name: string;
  url: string;
  token: () => string;
}

export interface LocalCommand {
  config: { bind: string; port: number; token: string };
  /** When set, the daemon is this host's and its token is used instead of the config's. */
  remote?: RemoteTarget;
  /** The name the daemon lists this connection under. */
  clientName: string;
  /** How long the daemon has to answer before the command gives up (exit 2). */
  timeoutMs: number;
  /** What the command asks; `note.wrote` is set before it sends a write. */
  perform: (daemon: DaemonClient, note: { wrote: boolean }) => Promise<CliResult>;
  /** What a write that got no answer may have done, as text that follows the message; "" for a read. */
  unsure?: string;
}

/** What went wrong, as an exit code and a line: a write that may have gone out says so. */
function explain(
  error: unknown,
  context: { url: string; timeoutMs: number; unsure: string },
  hide: (text: string) => string,
): CliResult {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof TimedOut) {
    const seconds = Math.ceil(context.timeoutMs / 1000);
    return failure(
      2,
      `the daemon at ${context.url} did not answer in ${seconds} s${context.unsure}`,
    );
  }
  const cut = message === "connection closed";
  if (cut && context.unsure) return failure(2, `the daemon closed the connection${context.unsure}`);
  if (cut || error instanceof DaemonUnreachable)
    return failure(2, `could not reach the daemon at ${context.url}: is it running?`);
  return failure(1, hide(message));
}

/** The daemon refused the token: a close with 4401 (the real daemon) or an `unauthorized` ack. */
const tokenRefused = (error: unknown) =>
  (error instanceof ConnectionClosed && error.code === CLOSE_UNAUTHORIZED) ||
  (error instanceof DaemonRefusal && error.code === "unauthorized");

/** What went wrong with a host reached by name: its name and a stable reason, never its address or token. */
function explainRemote(
  error: unknown,
  context: { name: string; timeoutMs: number; unsure: string },
  hide: (text: string) => string,
): CliResult {
  const { name } = context;
  if (tokenRefused(error))
    return failure(
      1,
      `the token for ${name} was refused: pair this host again in the app`,
      "token_refused",
    );
  if (error instanceof TimedOut) {
    const seconds = Math.ceil(context.timeoutMs / 1000);
    return failure(2, `${name} did not answer in ${seconds} s${context.unsure}`, "unreachable");
  }
  const message = error instanceof Error ? error.message : String(error);
  const cut = message === "connection closed";
  if (cut && context.unsure)
    return failure(2, `${name} closed the connection${context.unsure}`, "unreachable");
  if (cut || error instanceof DaemonUnreachable)
    return failure(2, `could not reach ${name}: is its daemon running?`, "unreachable");
  return failure(1, hide(message));
}

/** The daemon of this host, with the token of its config: never from the arguments or the environment. */
export async function runOnLocalDaemon(command: LocalCommand): Promise<CliResult> {
  const { config, timeoutMs, remote } = command;
  const url = remote?.url ?? daemonUrl(config);
  // A host reached by name had its address judged when its token was read.
  const refused = remote ? null : addressRefusal(config, url);
  if (refused) return refused;
  const token = remote ? remote.token() : config.token;
  // Whatever the daemon or the network say, the token is not in it.
  const hide = (text: string) => (token ? text.split(token).join("[token]") : text);
  const giveUp = new AbortController();
  /** Whether a write was sent: only then does a cut or a silence leave its result unknown. */
  const note = { wrote: false };
  let daemon: DaemonClient | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = async () => {
    daemon = await DaemonClient.connect(url, token, command.clientName, giveUp.signal);
    if (giveUp.signal.aborted) throw new TimedOut();
    return command.perform(daemon, note);
  };
  const clock = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      giveUp.abort();
      reject(new TimedOut());
    }, timeoutMs);
  });
  try {
    const done = await Promise.race([work(), clock]);
    return { ...done, out: done.out.map(hide), err: done.err.map(hide) };
  } catch (error) {
    const unsure = note.wrote ? (command.unsure ?? "") : "";
    return remote
      ? explainRemote(error, { name: remote.name, timeoutMs, unsure }, hide)
      : explain(error, { url, timeoutMs, unsure }, hide);
  } finally {
    clearTimeout(timer);
    giveUp.abort();
    daemon?.close();
  }
}
