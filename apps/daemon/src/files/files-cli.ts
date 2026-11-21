/**
 * Issue #3624: `flightdeckd file list|read|search|dirs|files|write`, the files of a target's repository and the
 * folders of a host, from a terminal. All but `write` ask the daemon for something it already keeps and change
 * nothing; `write` replaces a file only if it still has the hash the person read (the daemon says otherwise).
 * Exit codes: 0 done, 1 refused, 2 no daemon.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  type CliResult,
  failure,
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
  wroteJson,
  wroteLines,
} from "./domain/files-cli-view.ts";

export type { FileCliArgs } from "./domain/files-cli-view.ts";

/** The lines of an answer, or its JSON when asked. */
const shown = <T>(
  asJson: boolean | undefined,
  result: T,
  toJson: (result: T) => unknown,
  lines: (result: T) => string[],
): CliResult => (asJson ? json(toJson(result)) : said(...lines(result)));

/** What a closed connection after the write was sent leaves unknown. */
const UNSURE = "; the file may or may not have changed: read it again before you write again";

/** The new text: a file, or standard input for `-`. */
const textOf = (file: string, stdin: ReadableStream<Uint8Array>): Promise<string> =>
  file === "-" ? new Response(stdin).text() : readFile(file, "utf8");

export async function runFileCli(
  args: FileCliArgs,
  config: { bind: string; port: number; token: string },
  options: {
    timeoutMs?: number;
    remote?: RemoteTarget;
    stdin?: ReadableStream<Uint8Array> | undefined;
  } = {},
): Promise<CliResult> {
  // A write reads its text first: a file that cannot be read is exit 1 with no daemon asked, and `-` holds no connection open.
  let text = "";
  if (args.action === "write") {
    try {
      text = await textOf(args.file, options.stdin ?? Bun.stdin.stream());
    } catch {
      return failure(1, `file write: cannot read the text from ${args.file}`);
    }
  }
  // A folder typed relative is this machine's; on another host it is the host's own path, which the parser checked.
  const folder = (path: string) => (options.remote ? path : resolve(path));
  return runOnLocalDaemon({
    config,
    ...(options.remote ? { remote: options.remote } : {}),
    clientName: "flightdeck-file",
    timeoutMs: options.timeoutMs ?? 15_000,
    ...(args.action === "write" ? { unsure: UNSURE } : {}),
    perform: async (daemon, note) => {
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
        case "write":
          note.wrote = true;
          return shown(
            args.json,
            await daemon.call("file.write", {
              target: args.target,
              path: args.path,
              text,
              expectedHash: args.expectedHash,
            }),
            wroteJson,
            wroteLines,
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
