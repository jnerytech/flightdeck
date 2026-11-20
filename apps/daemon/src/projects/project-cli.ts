/**
 * Issue #3515: `flightdeckd project trust-state|stack|trust-inspect|harness-preview`, what a host knows of a
 * project's folder from a terminal or a script. It speaks to the daemon like `flightdeckd plugins` does (the
 * same `DaemonClient`, the token of the config). Exit codes: 0 done, 1 refused, 2 no daemon. Every verb here
 * reads: nothing is trusted, written or run.
 */
import { resolve } from "node:path";
import {
  type CliResult,
  json,
  type RemoteTarget,
  resolveProject,
  runOnLocalDaemon,
  said,
} from "../daemon-client/index.ts";
import {
  detectLines,
  draftLines,
  exportLines,
  inspectLines,
  type ProjectCliArgs,
  previewLines,
  projectLines,
  stackLines,
  trustLines,
} from "./domain/project-cli-view.ts";

/** What a write that got no answer may have done: the person checks the projects before repeating it. */
const UNSURE =
  "; the change may or may not have happened: run flightdeckd card list or the app's projects before repeating it";

/** A preview reads the folder's files and a template's, which takes longer than a lookup. */
const DEFAULT_TIMEOUT_MS = 30_000;

export function runProjectCli(
  args: ProjectCliArgs,
  config: { bind: string; port: number; token: string },
  options: { timeoutMs?: number; remote?: RemoteTarget } = {},
): Promise<CliResult> {
  // A relative folder means the shell's, so it is made absolute here; another host's folders are given absolute.
  const folder = (path: string) => (options.remote ? path : resolve(path));
  return runOnLocalDaemon({
    config,
    ...(options.remote ? { remote: options.remote } : {}),
    clientName: "flightdeck-project",
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    unsure: UNSURE,
    perform: async (daemon, note) => {
      if (args.action === "add") {
        note.wrote = true;
        const answer = await daemon.call("project.add", {
          path: folder(args.path),
          ...args.fields,
        });
        return args.json ? json(answer) : said(...projectLines("added", answer, args.fields));
      }
      if (args.action === "update" || args.action === "detect-provider") {
        const { projects } = await daemon.call("project.list", {});
        const found = resolveProject(projects, args.project);
        if ("refusal" in found) return found.refusal;
        note.wrote = true;
        if (args.action === "detect-provider") {
          const answer = await daemon.call("project.detectProvider", { projectId: found.id });
          return args.json ? json(answer) : said(...detectLines(found.name, answer));
        }
        // The daemon fills a missing model or low-risk rule of the patch with its default, so the
        // project's own values go along with the switch.
        const current = projects.find((p) => p.id === found.id)?.autoApprove;
        const fields = args.fields.autoApprove
          ? { ...args.fields, autoApprove: { ...current, ...args.fields.autoApprove } }
          : args.fields;
        const answer = await daemon.call("project.update", { projectId: found.id, ...fields });
        return args.json ? json(answer) : said(...projectLines("updated", answer, args.fields));
      }
      if (args.action === "harness-draft") {
        const answer = await daemon.call("project.harness.draft", {
          path: folder(args.path),
          part: "claudeMd",
        });
        return args.json ? json(answer) : said(...draftLines(answer));
      }
      if (args.action === "harness-export") {
        note.wrote = true;
        const answer = await daemon.call("project.harness.export", {
          path: folder(args.path),
          id: args.id,
          title: args.title,
        });
        return args.json ? json(answer) : said(...exportLines(answer));
      }
      if (args.action === "trust-state") {
        const answer = await daemon.call("project.trust.state", { paths: args.paths.map(folder) });
        return args.json ? json(answer) : said(...trustLines(answer));
      }
      if (args.action === "stack") {
        const answer = await daemon.call("project.harness.stack", { path: folder(args.path) });
        return args.json ? json(answer) : said(...stackLines(answer));
      }
      if (args.action === "trust-inspect") {
        const answer = await daemon.call("project.trust.inspect", { path: folder(args.path) });
        return args.json ? json(answer) : said(...inspectLines(answer));
      }
      const { parts, template } = args;
      const answer = await daemon.call("project.harness.preview", {
        path: folder(args.path),
        parts,
        ...(template === undefined ? {} : { template }),
      });
      return args.json ? json(answer) : said(...previewLines(answer));
    },
  });
}
