/**
 * Issue #3515: what the `project` verbs of the CLI take, checked before anything is sent. The parser in
 * `args.ts` adds the usage text to the problem this names.
 */

import { isAbsolute } from "node:path";
import { HARNESS_PREVIEW_PARTS, HARNESS_TEMPLATE_ID } from "@flightdeck/protocol";
import type { HarnessPart, ProjectCliArgs } from "../../projects/index.ts";
import { type ArgReader, subAction } from "./arg-reader.ts";
import type { CliArgs } from "./cli-args.ts";

/** The parsed arguments this check reads: `CliArgs` fits it. */
export interface ProjectArgs {
  command: string;
  action?: string;
  projectPaths?: string[];
  projectParts?: string[];
  projectTemplate?: string;
  host?: string;
}

const ACTIONS = ["trust-state", "stack", "trust-inspect", "harness-preview"] as const;

/** `project <verb> <folder>...`: every word up to the next flag is a folder; the check below counts them. */
export function readProject(args: CliArgs, reader: ArgReader): void {
  args.command = "project";
  args.action = subAction(reader, ACTIONS, "invalid project action");
  const paths: string[] = [];
  while (reader.peek() !== undefined && !(reader.peek() ?? "").startsWith("--")) {
    reader.advance();
    paths.push(reader.current() ?? "");
  }
  args.projectPaths = paths;
}

/** The flags of `project harness-preview`, for the parser's table of flags. */
export const PROJECT_FLAGS: Record<
  string,
  (args: CliArgs, reader: unknown, value: () => string) => void
> = {
  "--parts": (args, _reader, value) => {
    args.projectParts = value().split(",");
  },
  "--template": (args, _reader, value) => {
    args.projectTemplate = value();
  },
};

/**
 * What is wrong with the `project` words and flags: `--parts` and `--template` outside `harness-preview`, no
 * folder or too many, a part the host has no template for, a template id that is not one, and a relative
 * folder for another host (it is read there, not here).
 */
export function projectProblem(args: ProjectArgs): string | undefined {
  const project = args.command === "project";
  const preview = args.action === "harness-preview";
  for (const [flag, typed] of [
    ["--parts", args.projectParts !== undefined],
    ["--template", args.projectTemplate !== undefined],
  ] as const)
    if (typed && !(project && preview))
      return `${flag}: this flag only applies to flightdeckd project harness-preview`;
  if (!project) return undefined;
  const paths = args.projectPaths ?? [];
  if (paths.length === 0) return `project ${args.action}: missing the folder`;
  if (args.action !== "trust-state" && paths.length > 1)
    return `project ${args.action}: give one folder, got ${paths.length}`;
  if (preview) {
    const parts = args.projectParts ?? [];
    if (parts.length === 0) return "project harness-preview: missing --parts <part,part>";
    const valid = parts.every(
      (part, index) =>
        (HARNESS_PREVIEW_PARTS as readonly string[]).includes(part) &&
        parts.indexOf(part) === index,
    );
    if (!valid) return `--parts: invalid part, each of ${HARNESS_PREVIEW_PARTS.join(", ")} once`;
    if (args.projectTemplate !== undefined && !HARNESS_TEMPLATE_ID.test(args.projectTemplate))
      return "--template: a template id is lower case letters, digits and dashes (up to 40)";
  }
  if (args.host !== undefined && paths.some((path) => !isAbsolute(path)))
    return "project: on another host the folder must be an absolute path (it is read there, not here)";
  return undefined;
}

/** What the person typed for `project`, as `runProjectCli` takes it: the parser checked the folders and the parts. */
export function projectCliArgs(args: CliArgs): ProjectCliArgs {
  const printed = args.json ? { json: true as const } : {};
  const paths = args.projectPaths ?? [];
  const path = paths[0] ?? "";
  if (args.action === "trust-state") return { action: "trust-state", paths, ...printed };
  if (args.action === "stack") return { action: "stack", path, ...printed };
  if (args.action === "trust-inspect") return { action: "trust-inspect", path, ...printed };
  return {
    action: "harness-preview",
    path,
    parts: (args.projectParts ?? []) as HarnessPart[],
    ...(args.projectTemplate === undefined ? {} : { template: args.projectTemplate }),
    ...printed,
  };
}
