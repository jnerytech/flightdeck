/**
 * Issue #3515: `flightdeckd project trust-state|stack|trust-inspect|harness-preview|detect-provider|add|update|
 * harness-draft|harness-export|harness-apply|harness-commit`, what a host knows of a project's folder and what a person changes in a project,
 * from a terminal or a script. It speaks to the daemon like `flightdeckd plugins` does (the same `DaemonClient`,
 * the token of the config). Exit codes: 0 done, 1 refused, 2 no daemon. `add`, `update`, `harness-export`,
 * `harness-apply` and `harness-commit` write.
 */
import { resolve } from "node:path";
import {
  type CliResult,
  type DaemonClient,
  DaemonRefusal,
  failure,
  type RemoteTarget,
  resolveProject,
  runOnLocalDaemon,
  shown,
} from "../daemon-client/index.ts";
import {
  appliedDigests,
  appliedLines,
  cloneLines,
  committedLines,
  detectLines,
  draftLines,
  exportLines,
  inspectLines,
  type ProjectCliArgs,
  previewDigests,
  previewLines,
  projectLines,
  type SavedDigests,
  scanLines,
  stackLines,
  trustLines,
} from "./domain/project-cli-view.ts";

/** What a write that got no answer may have done: the person checks the projects before repeating it. */
const UNSURE =
  "; the change may or may not have happened: look at the app's projects before repeating it";

/** A preview reads the folder's files and a template's, which takes longer than a lookup. */
const DEFAULT_TIMEOUT_MS = 30_000;

/** The file the person saved an earlier answer in, read as text, or the line that says it cannot be. */
async function readSaved(file: string): Promise<string | CliResult> {
  try {
    return await Bun.file(file).text();
  } catch {
    return failure(1, `${file}: cannot read it`);
  }
}

/**
 * A host with a device enrolled wants that device's signature, which a terminal cannot give (#3453), and a
 * layout change wants `--reformat` here, not the protocol's field: both are said in the CLI's own words.
 */
const REFUSALS: Record<string, string> = {
  approval_proof_required:
    "this host has a device enrolled, which confirms what is written to a project's files, so do it in the app",
  harness_reformat:
    "writing the settings back would change their layout: run it again with --reformat if the person accepts that",
};

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
      switch (args.action) {
        case "add": {
          note.wrote = true;
          const answer = await daemon.call("project.add", {
            path: folder(args.path),
            ...args.fields,
          });
          return shown(args.json, answer, (added) => projectLines("added", added, args.fields));
        }
        case "scan":
          return shown(
            args.json,
            await daemon.call(
              "projects.scan",
              args.depth === undefined ? {} : { depth: args.depth },
            ),
            scanLines,
          );
        case "clone": {
          note.wrote = true;
          const answer = await daemon.call("projects.clone", {
            url: args.url,
            root: folder(args.root),
            ...(args.name === undefined ? {} : { name: args.name }),
          });
          return shown(args.json, answer, cloneLines);
        }
        case "update":
        case "detect-provider":
          return changeProject(args, daemon, note);
        case "harness-draft":
          return shown(
            args.json,
            await daemon.call("project.harness.draft", {
              path: folder(args.path),
              part: "claudeMd",
            }),
            draftLines,
          );
        case "harness-export": {
          note.wrote = true;
          const answer = await daemon.call("project.harness.export", {
            path: folder(args.path),
            id: args.id,
            title: args.title,
          });
          return shown(args.json, answer, exportLines);
        }
        case "harness-apply":
        case "harness-commit":
          return writeHarness(args, daemon, note, folder);
        case "trust-state":
          return shown(
            args.json,
            await daemon.call("project.trust.state", { paths: args.paths.map(folder) }),
            trustLines,
          );
        case "stack":
          return shown(
            args.json,
            await daemon.call("project.harness.stack", { path: folder(args.path) }),
            stackLines,
          );
        case "trust-inspect":
          return shown(
            args.json,
            await daemon.call("project.trust.inspect", { path: folder(args.path) }),
            inspectLines,
          );
        default: {
          const { parts, template } = args;
          const answer = await daemon.call("project.harness.preview", {
            path: folder(args.path),
            parts,
            ...(template === undefined ? {} : { template }),
          });
          return shown(args.json, answer, previewLines);
        }
      }
    },
  });
}

/**
 * `harness-apply` and `harness-commit` (#3515): the digests come from the answer the person saved, and a typed
 * `--confirm` stands for their word. The reasons the CLI cannot meet (a device proof) or tells in its own words
 * (a reformat) are refused here; any other refusal goes up as the daemon said it.
 */
async function writeHarness(
  args: Extract<ProjectCliArgs, { action: "harness-apply" | "harness-commit" }>,
  daemon: DaemonClient,
  note: { wrote: boolean },
  folder: (path: string) => string,
): Promise<CliResult> {
  const read = await readSaved(args.digestsFile);
  if (typeof read !== "string") return read;
  const saved: SavedDigests =
    args.action === "harness-apply"
      ? previewDigests(args.digestsFile, read)
      : appliedDigests(args.digestsFile, read);
  if ("problem" in saved) return failure(1, saved.problem);
  note.wrote = true;
  try {
    if (args.action === "harness-commit") {
      const committed = await daemon.call("project.harness.commit", {
        path: folder(args.path),
        digests: saved.digests,
        confirm: true,
      });
      return shown(args.json, committed, committedLines);
    }
    const applied = await daemon.call("project.harness.apply", {
      path: folder(args.path),
      parts: args.parts,
      digests: saved.digests,
      confirm: true,
      ...(args.reformat ? { reformat: true } : {}),
      ...(args.template === undefined ? {} : { template: args.template }),
    });
    return shown(args.json, applied, appliedLines);
  } catch (error) {
    const reason = error instanceof DaemonRefusal ? error.reason : undefined;
    if (reason === undefined || !Object.hasOwn(REFUSALS, reason)) throw error;
    return failure(1, `${args.path} ${REFUSALS[reason]}`);
  }
}

/** A project the person names (its name or its id): `update` changes it, `detect-provider` asks which host it is on. */
async function changeProject(
  args: Extract<ProjectCliArgs, { action: "update" | "detect-provider" }>,
  daemon: DaemonClient,
  note: { wrote: boolean },
): Promise<CliResult> {
  const { projects } = await daemon.call("project.list", {});
  const found = resolveProject(projects, args.project);
  if ("refusal" in found) return found.refusal;
  note.wrote = true;
  if (args.action === "detect-provider") {
    const answer = await daemon.call("project.detectProvider", { projectId: found.id });
    return shown(args.json, answer, (detected) => detectLines(found.name, detected));
  }
  // The daemon fills a missing model or low-risk rule of the patch with its default, so the
  // project's own values go along with the switch.
  const current = projects.find((p) => p.id === found.id)?.autoApprove;
  const fields = args.fields.autoApprove
    ? { ...args.fields, autoApprove: { ...current, ...args.fields.autoApprove } }
    : args.fields;
  const answer = await daemon.call("project.update", { projectId: found.id, ...fields });
  return shown(args.json, answer, (updated) => projectLines("updated", updated, args.fields));
}
