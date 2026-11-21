/**
 * Issue #3627: `flightdeckd automation`, a project's automations from a terminal. `list` and `runs` ask
 * the daemon for something it already keeps and change nothing. `save` leaves the automation off, `enable`
 * turns it on (so it fires on its own) and `disable` and `remove` stop or delete it; a daemon that does not
 * answer one leaves its result unknown. Exit codes: 0 done, 1 refused, 2 no daemon.
 */
import { readFile } from "node:fs/promises";
import { AutomationAction, AutomationTrigger } from "@flightdeck/protocol";
import { z } from "zod";
import {
  type CliResult,
  failure,
  type RemoteTarget,
  resolveProject,
  runOnLocalDaemon,
  shown,
} from "../daemon-client/index.ts";
import { parseJsonWith } from "../kernel/index.ts";
import {
  automationJson,
  changedLine,
  listJson,
  listLines,
  runsJson,
  runsLines,
} from "./domain/automation-cli-view.ts";

const DEFAULT_TIMEOUT_MS = 15_000;

/** What a write that got no answer may have done, and where to look. */
const UNSURE =
  "; the change may or may not have been made: check with `automation list` before trying again";

/** The file `save` reads: what fires the automation and what it does. */
const Definition = z.object({ trigger: AutomationTrigger, action: AutomationAction });

/**
 * A project (its name or its id) for `list` and `save`, an automation id for the rest. `save` takes the
 * trigger and the action from a JSON file; the other fields are the flags it was given.
 */
export type AutomationCliArgs =
  | { action: "list"; target: string; json?: boolean }
  | { action: "runs"; target: string; limit?: number; json?: boolean }
  | {
      action: "save";
      target: string;
      name: string;
      definitionFile: string;
      id?: string;
      maxRunsPerDay?: number;
      allowExternalAuthors?: boolean;
      json?: boolean;
    }
  | { action: "enable" | "disable" | "remove"; target: string; json?: boolean };

type Config = { bind: string; port: number; token: string };
type Options = { timeoutMs?: number; remote?: RemoteTarget };
type Definition = z.infer<typeof Definition>;
type Perform = Parameters<typeof runOnLocalDaemon>[0]["perform"];

/** The definition file's trigger and action, or the refusal that names what is wrong with it. */
async function readDefinition(file: string): Promise<Definition | CliResult> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return failure(1, `cannot read the definition file ${file}`);
  }
  try {
    return parseJsonWith(Definition, text);
  } catch (error) {
    return failure(1, `the definition file: ${error instanceof Error ? error.message : "invalid"}`);
  }
}

const onDaemon = (config: Config, options: Options, perform: Perform): Promise<CliResult> =>
  runOnLocalDaemon({
    config,
    ...(options.remote ? { remote: options.remote } : {}),
    clientName: "flightdeck-automation",
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    unsure: UNSURE,
    perform,
  });

/** `save`: the file is read before the daemon is asked, so a file that does not fit changes nothing. */
async function save(
  args: Extract<AutomationCliArgs, { action: "save" }>,
  config: Config,
  options: Options,
): Promise<CliResult> {
  const definition = await readDefinition(args.definitionFile);
  if ("code" in definition) return definition;
  return onDaemon(config, options, async (daemon, note) => {
    const { projects } = await daemon.call("project.list", {});
    const chosen = resolveProject(projects, args.target);
    if ("refusal" in chosen) return chosen.refusal;
    note.wrote = true;
    const automation = await daemon.call("automation.save", {
      projectId: chosen.id,
      name: args.name,
      ...definition,
      ...(args.id === undefined ? {} : { id: args.id }),
      ...(args.maxRunsPerDay === undefined ? {} : { maxRunsPerDay: args.maxRunsPerDay }),
      ...(args.allowExternalAuthors === undefined
        ? {}
        : { allowExternalAuthors: args.allowExternalAuthors }),
    });
    return shown(args.json, automationJson(automation), () => [changedLine("saved", automation)]);
  });
}

export function runAutomationCli(
  args: AutomationCliArgs,
  config: Config,
  options: Options = {},
): Promise<CliResult> {
  if (args.action === "save") return save(args, config, options);
  return onDaemon(config, options, async (daemon, note) => {
    if (args.action === "runs") {
      const { runs } = await daemon.call("automation.runs", {
        id: args.target,
        ...(args.limit === undefined ? {} : { limit: args.limit }),
      });
      return shown(args.json, runsJson(runs), () => runsLines(args.target, runs));
    }
    if (args.action === "enable" || args.action === "disable") {
      const enabled = args.action === "enable";
      note.wrote = true;
      const automation = await daemon.call("automation.toggle", {
        id: args.target,
        enabled,
        ...(enabled ? { confirm: true } : {}),
      });
      return shown(args.json, automationJson(automation), () => [
        changedLine(enabled ? "enabled" : "disabled", automation),
      ]);
    }
    if (args.action === "remove") {
      note.wrote = true;
      const { automations } = await daemon.call("automation.remove", {
        id: args.target,
        confirm: true,
      });
      return shown(args.json, listJson(automations), () => [`removed ${args.target}`]);
    }
    const { projects } = await daemon.call("project.list", {});
    const chosen = resolveProject(projects, args.target);
    if ("refusal" in chosen) return chosen.refusal;
    const { automations } = await daemon.call("automation.list", { projectId: chosen.id });
    return shown(args.json, listJson(automations), () => listLines(chosen.name, automations));
  });
}
