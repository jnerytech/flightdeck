/**
 * Issue #3515: what the `project` verbs of the CLI take, checked before anything is sent. The parser in
 * `args.ts` adds the usage text to the problem this names.
 */

import { posix, win32 } from "node:path";
import {
  HARNESS_PREVIEW_PARTS,
  HARNESS_TEMPLATE_ID,
  PersonaSubagentsMode,
  PrProviderKind,
} from "@flightdeck/protocol";
import type { HarnessPart, ProjectCliArgs, ProjectFields } from "../../projects/index.ts";
import { type ArgReader, subAction } from "./arg-reader.ts";
import type { CliArgs } from "./cli-args.ts";
import { type Handler, setFlag } from "./flag-handlers.ts";
import { USAGE } from "./usage.ts";
import { oneOf } from "./vault-args.ts";

/** The parsed arguments this check reads: `CliArgs` fits it. */
export interface ProjectArgs {
  command: string;
  action?: string;
  projectPaths?: string[];
  projectWords?: string[];
  projectRef?: string;
  projectExport?: { id: string; title: string };
  projectFields?: ProjectFields;
  personaName?: string;
  projectParts?: string[];
  projectTemplate?: string;
  projectDigests?: string;
  projectReformat?: true;
  confirm?: true;
  host?: string;
}

const ACTIONS = [
  "trust-state",
  "stack",
  "trust-inspect",
  "harness-preview",
  "detect-provider",
  "add",
  "update",
  "harness-draft",
  "harness-export",
  "harness-apply",
  "harness-commit",
] as const;

/** The verbs that name a project rather than a folder. */
const BY_REFERENCE = ["detect-provider", "update"];

/**
 * `project <verb> <words>...`: every word up to the next flag is an operand; what each is depends on the verb
 * (a folder, a project, or `harness-export`'s folder, id and title) and the check below counts them.
 */
export function readProject(args: CliArgs, reader: ArgReader): void {
  args.command = "project";
  args.action = subAction(reader, ACTIONS, "invalid project action");
  const words: string[] = [];
  while (reader.peek() !== undefined && !(reader.peek() ?? "").startsWith("--")) {
    reader.advance();
    words.push(reader.current() ?? "");
  }
  args.projectWords = words;
  if (BY_REFERENCE.includes(args.action)) {
    if (words[0] !== undefined) args.projectRef = words[0];
    return;
  }
  if (args.action === "harness-export") {
    args.projectPaths = words.slice(0, 1);
    args.projectExport = { id: words[1] ?? "", title: words[2] ?? "" };
    return;
  }
  args.projectPaths = words;
}

const fieldsOf = (args: CliArgs): ProjectFields => {
  args.projectFields ??= {};
  return args.projectFields;
};

/** The flags of `project harness-preview`, for the parser's table of flags. */
export const PROJECT_FLAGS: Record<string, Handler> = {
  "--digests": (args, _reader, value) => {
    args.projectDigests = value();
  },
  "--reformat": setFlag((args) => {
    args.projectReformat = true;
  }),
  "--parts": (args, _reader, value) => {
    args.projectParts = value().split(",");
  },
  "--template": (args, _reader, value) => {
    args.projectTemplate = value();
  },
  "--base-branch": (args, _reader, value) => {
    fieldsOf(args).baseBranch = value();
  },
  "--pr-provider": (args, _reader, value) => {
    fieldsOf(args).prProvider = oneOf("--pr-provider", value(), PrProviderKind.options);
  },
  "--setup-script": (args, _reader, value) => {
    const script = value();
    fieldsOf(args).setupScript = script === "none" ? null : script;
  },
  "--prompt-template": (args, _reader, value) => {
    fieldsOf(args).promptTemplate = value();
  },
  "--auto-approve": (args, _reader, value) => {
    fieldsOf(args).autoApprove = {
      enabled: oneOf("--auto-approve", value(), ["on", "off"]) === "on",
    };
  },
  "--default-hours": (args, _reader, value) => {
    const hours = value();
    const number = hours.trim() === "" ? Number.NaN : Number(hours);
    if (hours !== "none" && !(number >= 0 && number <= 1000))
      throw new Error(`--default-hours: a number from 0 to 1000, or none, got ${hours}\n${USAGE}`);
    fieldsOf(args).defaultHours = hours === "none" ? null : number;
  },
  "--persona-subagents": (args, _reader, value) => {
    fieldsOf(args).personaSubagents = oneOf(
      "--persona-subagents",
      value(),
      PersonaSubagentsMode.options,
    );
  },
};

/** What each flag of `project` is for: the verbs that take it. `--name` is the persona's and the team's too. */
const FLAG_VERBS: Array<[flag: string, typed: (args: ProjectArgs) => boolean, verbs: string[]]> = [
  ["--parts", (a) => a.projectParts !== undefined, ["harness-preview", "harness-apply"]],
  ["--template", (a) => a.projectTemplate !== undefined, ["harness-preview", "harness-apply"]],
  ["--digests", (a) => a.projectDigests !== undefined, ["harness-apply", "harness-commit"]],
  ["--reformat", (a) => a.projectReformat !== undefined, ["harness-apply"]],
  ["--confirm", (a) => a.confirm !== undefined, ["harness-apply", "harness-commit"]],
  ["--name", (a) => a.personaName !== undefined, ["add", "update"]],
  ["--base-branch", (a) => a.projectFields?.baseBranch !== undefined, ["add", "update"]],
  ["--pr-provider", (a) => a.projectFields?.prProvider !== undefined, ["add", "update"]],
  ["--setup-script", (a) => a.projectFields?.setupScript !== undefined, ["add", "update"]],
  ["--prompt-template", (a) => a.projectFields?.promptTemplate !== undefined, ["add", "update"]],
  ["--auto-approve", (a) => a.projectFields?.autoApprove !== undefined, ["add", "update"]],
  ["--default-hours", (a) => a.projectFields?.defaultHours !== undefined, ["update"]],
  ["--persona-subagents", (a) => a.projectFields?.personaSubagents !== undefined, ["update"]],
];

/** The folders the verbs take: how many, and what the first word is called in the refusal. */
const FOLDERS: Record<string, number> = {
  "trust-state": Number.POSITIVE_INFINITY,
  stack: 1,
  "trust-inspect": 1,
  "harness-preview": 1,
  add: 1,
  "harness-draft": 1,
  "harness-export": 1,
  "harness-apply": 1,
  "harness-commit": 1,
};

/** The flags other commands read too: outside `project` they are theirs, so only a `project` verb checks them. */
const SHARED_FLAGS = ["--name", "--confirm"];

/** What is wrong with the operands of a `project` verb: a missing or extra folder, project, id or title. */
function operandProblem(args: ProjectArgs): string | undefined {
  const verb = `project ${args.action}`;
  const words = args.projectWords ?? [];
  if (BY_REFERENCE.includes(args.action ?? "")) {
    if (words.length === 0) return `${verb}: missing the project (a name or id)`;
    if (words.length > 1) return `${verb}: give one project, got ${words.length}`;
    return undefined;
  }
  if (args.action === "harness-export") {
    if (words.length < 3)
      return `${verb}: missing the ${["folder", "template id", "title"][words.length]}`;
    if (words.length > 3) return `${verb}: quote the title, got ${words.length - 2} words for it`;
    if (!HARNESS_TEMPLATE_ID.test(words[1] ?? ""))
      return `${verb}: a template id is lower case letters, digits and dashes (up to 40)`;
    if ((words[2] ?? "").trim() === "") return `${verb}: the title is blank`;
    return undefined;
  }
  const paths = args.projectPaths ?? [];
  if (paths.length === 0) return `${verb}: missing the folder`;
  if (paths.length > (FOLDERS[args.action ?? ""] ?? 1))
    return `${verb}: give one folder, got ${paths.length}`;
  return undefined;
}

/** A flag outside the verbs that take it. */
function strayFlag(args: ProjectArgs, project: boolean): string | undefined {
  for (const [flag, typed, verbs] of FLAG_VERBS)
    if (
      typed(args) &&
      !(project && verbs.includes(args.action ?? "")) &&
      (project || !SHARED_FLAGS.includes(flag))
    )
      return `${flag}: this flag only applies to flightdeckd project ${verbs.join(" or ")}`;
  return undefined;
}

/** What is wrong with the parts and the template of `project harness-preview` and `harness-apply`. */
function previewProblem(args: ProjectArgs): string | undefined {
  const parts = args.projectParts ?? [];
  if (parts.length === 0) return `project ${args.action}: missing --parts <part,part>`;
  const valid = parts.every(
    (part, index) =>
      (HARNESS_PREVIEW_PARTS as readonly string[]).includes(part) && parts.indexOf(part) === index,
  );
  if (!valid) return `--parts: invalid part, each of ${HARNESS_PREVIEW_PARTS.join(", ")} once`;
  if (args.projectTemplate !== undefined && !HARNESS_TEMPLATE_ID.test(args.projectTemplate))
    return "--template: a template id is lower case letters, digits and dashes (up to 40)";
  return undefined;
}

/**
 * What `project harness-apply` and `harness-commit` need besides the folder: the saved answer whose digests they
 * send back, and the typed `--confirm`. The typed flag stands for the person's word, which a terminal cannot prove:
 * a host with a device enrolled still asks for that device's signature (#3453).
 */
function writeProblem(args: ProjectArgs): string | undefined {
  if (args.action !== "harness-apply" && args.action !== "harness-commit") return undefined;
  const verb = `project ${args.action}`;
  const saved = args.action === "harness-apply" ? "harness-preview" : "harness-apply";
  if (args.projectDigests === undefined)
    return `${verb}: missing --digests <file>, the answer of fd project ${saved} --json saved to a file`;
  if (args.confirm !== true) return `${verb}: needs --confirm, since it writes the project's files`;
  return undefined;
}

/**
 * What is wrong with the `project` words and flags: a flag outside the verbs that take it, no folder or too many,
 * a part the host has no template for, a template id that is not one, an update that changes nothing, a blank
 * name, and a relative folder for another host (it is read there, not here).
 */
export function projectProblem(args: ProjectArgs): string | undefined {
  const project = args.command === "project";
  const stray = strayFlag(args, project);
  if (stray !== undefined) return stray;
  if (!project) return undefined;
  const operands = operandProblem(args);
  if (operands) return operands;
  const preview = ["harness-preview", "harness-apply"].includes(args.action ?? "")
    ? previewProblem(args)
    : undefined;
  if (preview !== undefined) return preview;
  const written = writeProblem(args);
  if (written !== undefined) return written;
  if (args.personaName !== undefined && args.personaName.trim() === "")
    return "--name: the project's name is blank";
  if (args.action === "update" && Object.keys(projectFields(args)).length === 0)
    return "project update: nothing to change; give at least one of --name, --base-branch, --pr-provider, --setup-script, --prompt-template, --auto-approve, --default-hours, --persona-subagents";
  if (
    args.host !== undefined &&
    !BY_REFERENCE.includes(args.action ?? "") &&
    (args.projectPaths ?? []).some((path) => !posix.isAbsolute(path) && !win32.isAbsolute(path))
  )
    return "project: on another host the folder must be an absolute path (it is read there, not here)";
  return undefined;
}

/** The fields `project add|update` would send: the flags, with `--name` as the persona's flag stored it. */
const projectFields = (
  args: Pick<ProjectArgs, "projectFields" | "personaName">,
): ProjectFields => ({
  ...(args.personaName === undefined ? {} : { name: args.personaName }),
  ...(args.projectFields ?? {}),
});
/** What the person typed for `project`, as `runProjectCli` takes it: the parser checked the folders and the parts. */
export function projectCliArgs(args: CliArgs): ProjectCliArgs {
  const printed = args.json ? { json: true as const } : {};
  const paths = args.projectPaths ?? [];
  const path = paths[0] ?? "";
  if (args.action === "trust-state") return { action: "trust-state", paths, ...printed };
  if (args.action === "stack") return { action: "stack", path, ...printed };
  if (args.action === "trust-inspect") return { action: "trust-inspect", path, ...printed };
  if (args.action === "add")
    return { action: "add", path, fields: projectFields(args), ...printed };
  if (args.action === "update")
    return {
      action: "update",
      project: args.projectRef ?? "",
      fields: projectFields(args),
      ...printed,
    };
  if (args.action === "detect-provider")
    return { action: "detect-provider", project: args.projectRef ?? "", ...printed };
  if (args.action === "harness-draft") return { action: "harness-draft", path, ...printed };
  if (args.action === "harness-export")
    return {
      action: "harness-export",
      path,
      id: args.projectExport?.id ?? "",
      title: args.projectExport?.title ?? "",
      ...printed,
    };
  if (args.action === "harness-apply")
    return {
      action: "harness-apply",
      path,
      parts: (args.projectParts ?? []) as HarnessPart[],
      digestsFile: args.projectDigests ?? "",
      ...(args.projectTemplate === undefined ? {} : { template: args.projectTemplate }),
      ...(args.projectReformat === undefined ? {} : { reformat: true as const }),
      confirm: true,
      ...printed,
    };
  if (args.action === "harness-commit")
    return {
      action: "harness-commit",
      path,
      digestsFile: args.projectDigests ?? "",
      confirm: true,
      ...printed,
    };
  return {
    action: "harness-preview",
    path,
    parts: (args.projectParts ?? []) as HarnessPart[],
    ...(args.projectTemplate === undefined ? {} : { template: args.projectTemplate }),
    ...printed,
  };
}
