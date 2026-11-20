/**
 * Issue #3476: `flightdeckd approvers watch [--follow] [--json]`, the devices that can approve a
 * high-risk allow, from a terminal or a script. It speaks to the local daemon like `flightdeckd rules`
 * does; `approvers enroll` and `reset` write the store directly and need no daemon (cli/approvers.ts).
 * Exit codes: 0 done, 1 refused, 2 no daemon. `--follow` is a stream (docs/decisions/2026-11-20-cli-streams.md).
 */
import {
  type CliResult,
  json,
  runOnLocalDaemon,
  said,
  streamFrames,
} from "../daemon-client/index.ts";
import {
  type ApproversCliArgs,
  changeJson,
  changeLine,
  deviceLines,
} from "./domain/approvers-cli-view.ts";

const DEFAULT_TIMEOUT_MS = 15_000;

export async function runApproversCli(
  args: ApproversCliArgs,
  config: { bind: string; port: number; token: string },
  options: {
    timeoutMs?: number;
    /** `--follow` stops when this aborts (Ctrl-C). */
    signal?: AbortSignal;
    /** `--follow` writes each line here as it comes. */
    write?: (line: string) => void;
  } = {},
): Promise<CliResult> {
  return runOnLocalDaemon({
    config,
    clientName: "flightdeck-approvers",
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    // A watch changes nothing, so no answer has nothing to be unsure about.
    unsure: "",
    perform: async (daemon, _note, flow) => {
      if (args.follow)
        return streamFrames({
          daemon,
          flow,
          signal: options.signal ?? new AbortController().signal,
          write: options.write ?? (() => undefined),
          open: () => daemon.call("approval.watch", {}),
          type: ["approval.enrolled", "approval.revoked"],
          line: (change) => (args.json ? changeJson(change) : changeLine(change)),
        });
      const list = await daemon.call("approval.list", {});
      return args.json ? json(list) : said(...deviceLines(list));
    },
  });
}
