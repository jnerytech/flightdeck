/**
 * Issue #3624: `flightdeckd file list|read|search|dirs|files`, the files of a target's repository and the folders
 * of a host, read from a terminal. Each verb asks the daemon for something it already keeps and changes nothing.
 * Exit codes: 0 done, 1 refused, 2 no daemon.
 */
import { resolve } from "node:path";
import {
  type CliResult,
  json,
  type RemoteTarget,
  runOnLocalDaemon,
  said,
} from "../daemon-client/index.ts";
import {
  dirsJson,
  dirsLines,
  type FileCliArgs,
  filesJson,
  filesLines,
  listJson,
  listLines,
  readJson,
  readLines,
  searchJson,
  searchLines,
} from "./domain/files-cli-view.ts";

export type { FileCliArgs } from "./domain/files-cli-view.ts";

/** The lines of an answer (a file may have many: no spread of them into one call), or its JSON when asked. */
const shown = <T>(
  asJson: boolean | undefined,
  result: T,
  toJson: (result: T) => unknown,
  lines: (result: T) => string[],
): CliResult => (asJson ? json(toJson(result)) : said(...lines(result)));

export function runFileCli(
  args: FileCliArgs,
  config: { bind: string; port: number; token: string },
  options: { timeoutMs?: number; remote?: RemoteTarget } = {},
): Promise<CliResult> {
  // A folder typed relative is this machine's; on another host it is the host's own path, which the parser checked.
  const folder = (path: string) => (options.remote ? path : resolve(path));
  return runOnLocalDaemon({
    config,
    ...(options.remote ? { remote: options.remote } : {}),
    clientName: "flightdeck-file",
    timeoutMs: options.timeoutMs ?? 15_000,
    perform: async (daemon) => {
      switch (args.action) {
        case "list":
          return shown(
            args.json,
            await daemon.call("file.list", { target: args.target, dir: args.dir }),
            listJson,
            (listing) => listLines(args.target, listing),
          );
        case "read":
          return shown(
            args.json,
            await daemon.call("file.read", { target: args.target, path: args.path }),
            readJson,
            readLines,
          );
        case "search": {
          const { action: _action, json: _asJson, ...query } = args;
          return shown(args.json, await daemon.call("file.search", query), searchJson, (result) =>
            searchLines(args.target, result),
          );
        }
        case "dirs":
          return shown(
            args.json,
            await daemon.call("fs.dirs", {
              ...(args.path === undefined ? {} : { path: folder(args.path) }),
              ...(args.hidden ? { hidden: true } : {}),
            }),
            dirsJson,
            dirsLines,
          );
        default:
          return shown(
            args.json,
            await daemon.call("fs.files", {
              path: folder(args.path),
              ...(args.hidden ? { hidden: true } : {}),
            }),
            filesJson,
            filesLines,
          );
      }
    },
  });
}
