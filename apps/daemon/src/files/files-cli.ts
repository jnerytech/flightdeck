/**
 * Issue #3624: `flightdeckd file list|read|search|dirs|files`, the files of a target's repository and the folders
 * of a host, read from a terminal. Each verb asks the daemon for something it already keeps and changes nothing.
 * Exit codes: 0 done, 1 refused, 2 no daemon.
 */
import { type CliResult, failure, type RemoteTarget } from "../daemon-client/index.ts";
import type { FileCliArgs } from "./domain/files-cli-view.ts";

export type { FileCliArgs } from "./domain/files-cli-view.ts";

export async function runFileCli(
  _args: FileCliArgs,
  _config: { bind: string; port: number; token: string },
  _options: { timeoutMs?: number; remote?: RemoteTarget } = {},
): Promise<CliResult> {
  return failure(1, "not built yet");
}
