/**
 * Issue #3701: `flightdeckd trace get|export`, the trace of a Claude session from a shell. Both ask the
 * daemon for something it builds from the transcript and change nothing. `export` prints the file the daemon
 * made on stdout, so a shell redirects it where it wants; how many fields the daemon replaced because they held
 * a secret goes to stderr, so it is never mixed into the file. Exit codes: 0 done, 1 refused, 2 no daemon.
 */
import {
  type CliResult,
  failure,
  json,
  type RemoteTarget,
  runOnLocalDaemon,
  shown,
} from "../daemon-client/index.ts";
import { parseJsonText } from "../kernel/index.ts";
import { redactedNote, traceLines } from "./domain/trace-cli-view.ts";

export type TraceCliArgs =
  | { action: "get"; session: string; json?: boolean }
  | { action: "export"; session: string; includeContent: boolean; json?: boolean };

export function runTraceCli(
  args: TraceCliArgs,
  config: { bind: string; port: number; token: string },
  options: { timeoutMs?: number; remote?: RemoteTarget } = {},
): Promise<CliResult> {
  return runOnLocalDaemon({
    config,
    ...(options.remote ? { remote: options.remote } : {}),
    clientName: "flightdeck-trace",
    timeoutMs: options.timeoutMs ?? 15_000,
    perform: async (daemon) => {
      const claudeSessionId = args.session;
      if (args.action === "get") {
        const trace = await daemon.call("trace.get", { claudeSessionId });
        return shown(args.json, trace, () => traceLines(trace));
      }
      const file = await daemon.call("trace.export", {
        claudeSessionId,
        ...(args.includeContent ? { includeContent: true } : {}),
      });
      if (args.json) return json(file);
      let content: unknown;
      try {
        content = parseJsonText(file.json);
      } catch {
        // The text may hold a secret: the message never quotes it.
        return failure(1, "the daemon's export is not valid JSON");
      }
      const printed = json(content);
      return file.redacted > 0 ? { ...printed, err: [redactedNote(file.redacted)] } : printed;
    },
  });
}
