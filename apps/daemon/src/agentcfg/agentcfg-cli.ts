/**
 * Issue #3617: `flightdeckd agentcfg list|read|write`, a project's CLAUDE.md files, agents and skills
 * (the app's Agent setup screen). `list` and `read` only read. `write` replaces a file the way the app
 * does: the caller repeats the hash that `read` printed (or says `--new` for a file that must not exist)
 * and passes `--confirm`; the daemon stays the only place of the rules (paths, frontmatter, read-only
 * user files). `--confirm` and the hash are the caller's word, not the person's. Exit codes: 0 done,
 * 1 refused, 2 no daemon (or no answer: the file may or may not have changed).
 */
import { readFile } from "node:fs/promises";
import type { AgentCfgItem } from "@flightdeck/protocol";
import {
  type CliResult,
  DaemonRefusal,
  failure,
  json,
  type RemoteTarget,
  resolveProject,
  runOnLocalDaemon,
  said,
  shown,
} from "../daemon-client/index.ts";
import { listLines, readLines, withNulls, wroteLine } from "./domain/agentcfg-view.ts";

const DEFAULT_TIMEOUT_MS = 15_000;

const UNSURE = "; the file may or may not have changed: read it again before you write again";

type AgentCfgKind = AgentCfgItem["kind"];
type Origin = "project" | "user";

export type AgentcfgCliArgs = { project: string; kind: AgentCfgKind; json?: boolean } & (
  | { action: "list" }
  | { action: "read"; path: string; origin?: Origin }
  | {
      action: "write";
      path: string;
      /** The file with the new content, or `-` for standard input. */
      file: string;
      /** The hash `read` printed; `null` for a file that must not exist yet. */
      expectedHash: string | null;
      confirm: true;
      origin?: Origin;
    }
);

/** The new content: a file, or standard input for `-`. */
const contentOf = (file: string, stdin: ReadableStream<Uint8Array>): Promise<string> =>
  file === "-" ? new Response(stdin).text() : readFile(file, "utf8");

export async function runAgentcfgCli(
  args: AgentcfgCliArgs,
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
      return failure(1, `agentcfg write: cannot read the content from ${args.file}`);
    }
  }
  return runOnLocalDaemon({
    config,
    ...(options.remote ? { remote: options.remote } : {}),
    clientName: "flightdeck-agentcfg",
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    unsure: UNSURE,
    perform: async (daemon, note) => {
      const { projects } = await daemon.call("project.list", {});
      const found = resolveProject(projects, args.project);
      if ("refusal" in found) return found.refusal;
      const { kind } = args;
      const projectId = found.id;
      try {
        switch (args.action) {
          case "list": {
            const { items } = await daemon.call("agentcfg.list", { projectId, kind });
            return shown(args.json, { items: items.map(withNulls) }, () => listLines(kind, items));
          }
          case "read": {
            const { path, origin } = args;
            const file = await daemon.call("agentcfg.read", {
              projectId,
              kind,
              path,
              ...(origin ? { origin } : {}),
            });
            return shown(args.json, withNulls(file), () => readLines(file, file.content));
          }
          case "write": {
            const { path, origin, expectedHash } = args;
            note.wrote = true;
            const written = await daemon.call("agentcfg.write", {
              projectId,
              kind,
              path,
              content,
              expectedHash,
              confirm: true,
              ...(origin ? { origin } : {}),
            });
            return args.json
              ? json({ kind, path, hash: written.hash })
              : said(wroteLine(kind, path, written.hash));
          }
        }
      } catch (error) {
        // The daemon's own words, with its stable reason for a script: its rules stay in one place.
        if (error instanceof DaemonRefusal) return failure(1, error.message, error.reason);
        throw error;
      }
    },
  });
}
