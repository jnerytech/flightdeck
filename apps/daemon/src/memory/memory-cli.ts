/**
 * Issue #3618: `flightdeckd memory list|read|budget|suggest|write|delete`, a project's Claude Code auto memory
 * (the app's Memory screen) from a terminal. The first four ask the daemon for what it already keeps and change
 * nothing; `write` and `delete` change a note, so a call that got no answer exits 2 and says it may have happened.
 * Exit codes: 0 done, 1 refused, 2 no daemon.
 */
import { readFile } from "node:fs/promises";
import {
  type CliResult,
  DaemonRefusal,
  failure,
  json,
  type RemoteTarget,
  resolveProject,
  runOnLocalDaemon,
  said,
} from "../daemon-client/index.ts";
import {
  budgetLines,
  deletedLine,
  fileJson,
  listingJson,
  listLines,
  readLines,
  suggestionJson,
  suggestLines,
  wroteLine,
} from "./domain/memory-cli-view.ts";

const DEFAULT_TIMEOUT_MS = 15_000;

/** The new content: a file, or standard input for `-`. */
const contentOf = (file: string, stdin: ReadableStream<Uint8Array>): Promise<string> =>
  file === "-" ? new Response(stdin).text() : readFile(file, "utf8");

const UNSURE =
  "; the memory file may or may not have changed: read it again before you write again";

export type MemoryCliArgs = { project: string; json?: boolean } & (
  | { action: "list" | "budget" | "suggest" }
  | { action: "read"; name: string }
  | {
      action: "write";
      name: string;
      /** The file with the new content, or `-` for standard input. */
      file: string;
      /** The hash `read` printed; `null` for a file that must not exist yet. */
      expectedHash: string | null;
      confirm: true;
    }
  | { action: "delete"; name: string; expectedHash: string; confirm: true }
);

export async function runMemoryCli(
  args: MemoryCliArgs,
  config: { bind: string; port: number; token: string },
  options: {
    timeoutMs?: number;
    remote?: RemoteTarget | undefined;
    stdin?: ReadableStream<Uint8Array> | undefined;
  } = {},
): Promise<CliResult> {
  let content = "";
  if (args.action === "write") {
    try {
      content = await contentOf(args.file, options.stdin ?? Bun.stdin.stream());
    } catch {
      return failure(1, `memory write: cannot read the content from ${args.file}`);
    }
  }
  return runOnLocalDaemon({
    config,
    ...(options.remote ? { remote: options.remote } : {}),
    clientName: "flightdeck-memory",
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    unsure: UNSURE,
    perform: async (daemon, note) => {
      const { projects } = await daemon.call("project.list", {});
      const found = resolveProject(projects, args.project);
      if ("refusal" in found) return found.refusal;
      const projectId = found.id;
      try {
        switch (args.action) {
          case "list": {
            const listing = await daemon.call("memory.list", { projectId });
            return args.json ? json(listingJson(listing)) : said(...listLines(listing));
          }
          case "read": {
            const file = await daemon.call("memory.read", { projectId, name: args.name });
            return args.json
              ? json({ ...fileJson(file), content: file.content })
              : said(...readLines(file, file.content));
          }
          case "budget": {
            const budget = await daemon.call("memory.budget", { projectId });
            return args.json ? json(budget) : said(...budgetLines(budget));
          }
          case "write": {
            const { name, expectedHash } = args;
            note.wrote = true;
            const { hash } = await daemon.call("memory.write", {
              projectId,
              name,
              content,
              expectedHash,
              confirm: true,
            });
            return args.json ? json({ name, hash }) : said(wroteLine(name, hash));
          }
          case "delete": {
            const { name, expectedHash } = args;
            note.wrote = true;
            await daemon.call("memory.delete", { projectId, name, expectedHash, confirm: true });
            return args.json ? json({ name }) : said(deletedLine(name));
          }
          case "suggest": {
            const { suggestions } = await daemon.call("memory.suggest", { projectId });
            return args.json
              ? json({ suggestions: suggestions.map(suggestionJson) })
              : said(...suggestLines(suggestions));
          }
        }
      } catch (error) {
        if (error instanceof DaemonRefusal) return failure(1, error.message, error.reason);
        throw error;
      }
    },
  });
}
