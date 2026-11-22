/**
 * Issue #3629: `flightdeckd action list --json|--plain`, `runs`, `save`, `trust` and `remove`, the actions of a
 * project (or of the host) and their runs from a terminal, on the CLI-first contract. `list` and `runs` ask
 * the daemon for what it already keeps. `save` declares a command that runs with secrets (and the daemon
 * trusts what is saved this way), `trust` lets a versioned command run and `remove` deletes one; a daemon
 * that does not answer a write leaves its result unknown. Exit codes: 0 done, 1 refused, 2 no daemon.
 */
import { readFile } from "node:fs/promises";
import { z } from "zod";
import {
  type CliResult,
  DaemonRefusal,
  failure,
  type RemoteTarget,
  resolveProject,
  runOnLocalDaemon,
  shown,
} from "../daemon-client/index.ts";
import { parseJsonWith } from "../kernel/index.ts";
import {
  actionJson,
  changedLine,
  listJson,
  listLines,
  removedLines,
  runsJson,
  runsLines,
} from "./domain/action-cli-view.ts";

const DEFAULT_TIMEOUT_MS = 15_000;

/** What a write that got no answer may have done, and where to look. */
const UNSURE =
  "; the change may or may not have been made: check with `action list --plain` before trying again";

/** The name the daemon gives the refusal of a trust whose hash is no longer the action's. */
const CHANGED = "action_changed_review";

/** `--project` names a project by its name or id; without it the host's own actions and runs are asked for. */
export type ActionVerbCliArgs =
  | { action: "list"; project?: string; plain?: boolean; json?: boolean }
  | { action: "runs"; project?: string; name?: string; limit?: number; json?: boolean }
  | {
      action: "save";
      project?: string;
      definitionFile: string;
      secretIds?: string[];
      json?: boolean;
    }
  | { action: "trust"; project?: string; name: string; hash: string; json?: boolean }
  | { action: "remove"; project?: string; name: string; json?: boolean };

type Config = { bind: string; port: number; token: string };
type Scope = { projectId?: string };
type Daemon = Parameters<Parameters<typeof runOnLocalDaemon>[0]["perform"]>[0];

const Definition = z.record(z.string(), z.unknown());

/** The definition file's object, or the refusal that names what is wrong with it. */
async function readDefinition(
  file: string,
): Promise<{ definition: Record<string, unknown> } | { refusal: CliResult }> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return { refusal: failure(1, `cannot read the definition file ${file}`) };
  }
  try {
    return { definition: parseJsonWith(Definition, text) };
  } catch (error) {
    const why = error instanceof Error ? error.message : "invalid";
    return { refusal: failure(1, `the definition file ${file} must hold one JSON object: ${why}`) };
  }
}

/** A trust the daemon refused because the action changed: the refusal, and the hash the action has now. */
async function changedRefusal(
  refusal: DaemonRefusal,
  daemon: Daemon,
  name: string,
  scope: Scope,
): Promise<CliResult> {
  try {
    const { actions } = await daemon.call("actions.list", scope);
    const current = actions.find((action) => action.name === name);
    const now = current === undefined ? "" : `; its hash now is ${current.hash}`;
    return failure(1, `${refusal.detail}${now}`);
  } catch {
    // The trust was refused, so nothing changed: a lookup that failed must not read as an unsure write.
    return failure(1, refusal.detail);
  }
}

/** The verb the person typed, asked of the daemon within `scope`; a write sets `note.wrote` before it goes out. */
async function actionVerb(
  args: ActionVerbCliArgs,
  daemon: Daemon,
  scope: Scope,
  note: { wrote: boolean },
  file: { definition: Record<string, unknown> } | undefined,
): Promise<CliResult> {
  if (args.action === "runs") {
    const { runs } = await daemon.call("actions.runs", {
      ...scope,
      ...(args.name === undefined ? {} : { name: args.name }),
      ...(args.limit === undefined ? {} : { limit: args.limit }),
    });
    return shown(args.json, runsJson(runs), () => runsLines(runs));
  }
  if (args.action === "save" && file !== undefined) {
    note.wrote = true;
    const saved = await daemon.call("actions.save", {
      ...scope,
      definition: file.definition,
      ...(args.secretIds === undefined ? {} : { secretIds: args.secretIds }),
    });
    return shown(args.json, actionJson(saved), () => [changedLine("saved", saved)]);
  }
  if (args.action === "trust") {
    note.wrote = true;
    try {
      const trusted = await daemon.call("actions.trust", {
        ...scope,
        name: args.name,
        hash: args.hash,
      });
      return shown(args.json, actionJson(trusted), () => [changedLine("trusted", trusted)]);
    } catch (error) {
      if (error instanceof DaemonRefusal && error.reason === CHANGED)
        return changedRefusal(error, daemon, args.name, scope);
      throw error;
    }
  }
  if (args.action === "remove") {
    note.wrote = true;
    const left = await daemon.call("actions.remove", { ...scope, name: args.name });
    return shown(args.json, listJson(left), () => removedLines(args.name, left));
  }
  const list = await daemon.call("actions.list", scope);
  return shown(args.json, listJson(list), () => listLines(list));
}

export async function runActionVerbCli(
  args: ActionVerbCliArgs,
  config: Config,
  options: { timeoutMs?: number; remote?: RemoteTarget } = {},
): Promise<CliResult> {
  // The file is read before the daemon is asked, so a file that does not fit changes nothing.
  const file = args.action === "save" ? await readDefinition(args.definitionFile) : undefined;
  if (file !== undefined && "refusal" in file) return file.refusal;
  return runOnLocalDaemon({
    config,
    ...(options.remote ? { remote: options.remote } : {}),
    clientName: "flightdeck-action",
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    unsure: UNSURE,
    perform: async (daemon, note) => {
      let scope: Scope = {};
      if (args.project !== undefined) {
        const { projects } = await daemon.call("project.list", {});
        const chosen = resolveProject(projects, args.project);
        if ("refusal" in chosen) return chosen.refusal;
        scope = { projectId: chosen.id };
      }
      return actionVerb(args, daemon, scope, note, file);
    },
  });
}
