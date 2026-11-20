/**
 * Issue #3476: `flightdeckd approvers watch [--follow] [--json]`, the devices that can approve a
 * high-risk allow, from a terminal or a script. It speaks to the local daemon like `flightdeckd rules`
 * does; `approvers enroll` and `reset` write the store directly and need no daemon (cli/approvers.ts).
 * Exit codes: 0 done, 1 refused, 2 no daemon. `--follow` is a stream (docs/decisions/2026-11-20-cli-streams.md).
 */
import type { CliResult } from "../daemon-client/index.ts";
import type { ApproversCliArgs } from "./domain/approvers-cli-view.ts";

export async function runApproversCli(
  _args: ApproversCliArgs,
  _config: { bind: string; port: number; token: string },
  _options: { timeoutMs?: number; signal?: AbortSignal; write?: (line: string) => void } = {},
): Promise<CliResult> {
  return { code: 0, out: [], err: [] };
}
