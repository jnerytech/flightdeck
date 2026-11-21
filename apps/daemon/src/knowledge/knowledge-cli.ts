/**
 * Issue #3623: `flightdeckd knowledge`, a project's document library from a shell (the app's Agent setup
 * screen). `list` reads the documents with their status and the hash a status change needs, `index` prints
 * the text a session is given of them and `feed` says whether the project gets it. The project is a name or
 * an id the host knows, or an absolute folder the daemon then checks against its allowed roots. Exit codes:
 * 0 done, 1 refused, 2 no daemon.
 */
import { readFile } from "node:fs/promises";
import { KNOWLEDGE_BODY_MAX, type KnowledgeKind, type KnowledgeStatus } from "@flightdeck/protocol";
import {
  type CliResult,
  failure,
  type RemoteTarget,
  resolveProject,
  runOnLocalDaemon,
  shown,
} from "../daemon-client/index.ts";
import {
  entryJson,
  entryLines,
  feedJson,
  feedLines,
  indexJson,
  indexLines,
  listJson,
  listLines,
  unsure,
} from "./domain/knowledge-cli-view.ts";

const DEFAULT_TIMEOUT_MS = 15_000;

/** A project's name or id, or the folder of one (a path starts with `/`, `\`, or a drive letter). */
export interface KnowledgeCliArgs {
  action: "list" | "index" | "feed" | "set-status" | "create" | "set-feed";
  project: string;
  json?: boolean;
  /** `set-status`: the document, the status to give it and the hash `list` showed for it. */
  file?: string;
  status?: KnowledgeStatus;
  hash?: string;
  /** `create`: the kind, the heading and, when given, a file with the text under it. */
  kind?: KnowledgeKind;
  title?: string;
  bodyFile?: string;
  /** `set-feed`: whether sessions of the project are given the index. */
  enabled?: boolean;
}

const ABSOLUTE = /^(?:[\\/]|[A-Za-z]:[\\/])/u;

/** The text of a `create --body-file`, or the refusal: read before any daemon is asked, so a bad file changes nothing. */
async function bodyOf(file: string): Promise<{ body: string } | { refusal: CliResult }> {
  let body: string;
  try {
    body = await readFile(file, "utf8");
  } catch {
    return { refusal: failure(1, `cannot read the body file ${file}`) };
  }
  if (body.length > KNOWLEDGE_BODY_MAX)
    return {
      refusal: failure(1, `the body file holds more than ${KNOWLEDGE_BODY_MAX} characters`),
    };
  return { body };
}

export async function runKnowledgeCli(
  args: KnowledgeCliArgs,
  config: { bind: string; port: number; token: string },
  options: { timeoutMs?: number; remote?: RemoteTarget } = {},
): Promise<CliResult> {
  let body: string | undefined;
  if (args.action === "create" && args.bodyFile !== undefined) {
    const read = await bodyOf(args.bodyFile);
    if ("refusal" in read) return read.refusal;
    body = read.body;
  }
  return runOnLocalDaemon({
    config,
    ...(options.remote ? { remote: options.remote } : {}),
    clientName: "flightdeck-knowledge",
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    unsure: unsure(args.action),
    perform: async (daemon, note) => {
      const { projects } = await daemon.call("project.list", {});
      const chosen = resolveProject(projects, args.project);
      let path: string;
      if (!("refusal" in chosen)) {
        const found = projects.find((p) => p.id === chosen.id);
        if (!found) return failure(1, `no project named "${args.project}"`);
        path = found.path;
      } else if (ABSOLUTE.test(args.project)) path = args.project;
      else return chosen.refusal;
      if (args.action === "list") {
        const list = await daemon.call("knowledge.list", { path });
        return shown(args.json, listJson(list), () => listLines(list));
      }
      if (args.action === "index") {
        const index = await daemon.call("knowledge.index", { path });
        return shown(args.json, indexJson(index), () => indexLines(index));
      }
      if (args.action === "set-status") {
        note.wrote = true;
        const entry = await daemon.call("knowledge.setStatus", {
          path,
          file: args.file ?? "",
          status: args.status as KnowledgeStatus,
          expectedHash: args.hash ?? "",
        });
        return shown(args.json, entryJson(entry), () => entryLines(entry));
      }
      if (args.action === "create") {
        note.wrote = true;
        const entry = await daemon.call("knowledge.create", {
          path,
          kind: args.kind as KnowledgeKind,
          title: args.title ?? "",
          ...(body === undefined ? {} : { body }),
        });
        return shown(args.json, entryJson(entry), () => entryLines(entry));
      }
      if (args.action === "set-feed") {
        note.wrote = true;
        const state = await daemon.call("knowledge.setFeed", {
          path,
          enabled: args.enabled === true,
        });
        return shown(args.json, feedJson(state), () => feedLines(state));
      }
      const feed = await daemon.call("knowledge.feed", { path });
      return shown(args.json, feedJson(feed), () => feedLines(feed));
    },
  });
}
