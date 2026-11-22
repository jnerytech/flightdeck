/**
 * Issue #3738: `flightdeckd template list|start`, `task results|preview` and `harness templates list|delete`,
 * the task templates of simple mode, what a task made, and the host's harness templates from a shell. The parser
 * in `args.ts` reads the words after the noun here; `--json` and `--host` are checked there with the other
 * commands'.
 */
import { posix, win32 } from "node:path";
import type { HarnessCliArgs } from "../../harness/index.ts";
import type { TemplatesCliArgs } from "../../templates/index.ts";
import { type ArgReader, operand, subAction } from "./arg-reader.ts";
import type { CliArgs } from "./cli-args.ts";
import { USAGE } from "./usage.ts";

/** What a template field's id looks like (`TemplateField.id` in the protocol). */
const FIELD_ID = /^[a-z][a-z0-9_]{0,23}$/;
/** What a template id and a harness template id look like (`Template.id`, `HARNESS_TEMPLATE_ID`). */
const TEMPLATE_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
/** A task's name, as `template.start` takes it. */
const NAME_MAX = 100;

/** `template list` or `template start <template>`. */
function readTemplate(args: CliArgs, reader: ArgReader): void {
  args.command = "template";
  const verb = subAction(reader, ["list", "start"] as const, "invalid template action");
  args.action = verb;
  if (verb === "start") args.templateWords = [operand(reader, "the template")];
}

/** `task results <session>` or `task preview <session> <path>`. */
function readTask(args: CliArgs, reader: ArgReader): void {
  args.command = "task";
  const verb = subAction(reader, ["results", "preview"] as const, "invalid task action");
  args.action = verb;
  const words = [operand(reader, "the session")];
  if (verb === "preview") words.push(operand(reader, "the path"));
  args.taskWords = words;
}

/** `harness templates list` or `harness templates delete <template>`. */
function readHarness(args: CliArgs, reader: ArgReader): void {
  args.command = "harness";
  subAction(reader, ["templates"] as const, "invalid harness action");
  const verb = subAction(reader, ["list", "delete"] as const, "invalid harness templates action");
  args.action = verb === "list" ? "templates-list" : "templates-delete";
  if (verb === "delete") args.harnessWords = [operand(reader, "the harness template")];
}

/** The three commands of this file, for the parser's table of handlers. */
export const TEMPLATE_COMMANDS: Record<string, (args: CliArgs, reader: ArgReader) => void> = {
  template: readTemplate,
  task: readTask,
  harness: readHarness,
};

/** The flag of `template start` that can come more than once: `--field <id>=<value>`, one per field. */
export const TEMPLATE_FLAGS: Record<
  string,
  (args: CliArgs, reader: unknown, value: () => string) => void
> = {
  "--field": (args, _reader, value) => {
    const text = value();
    const at = text.indexOf("=");
    const id = at < 0 ? text : text.slice(0, at);
    if (at < 0 || !FIELD_ID.test(id))
      throw new Error(`--field: <field id>=<value>, got ${text}\n${USAGE}`);
    const seen = args.templateFields ?? [];
    if (seen.some((field) => field.startsWith(`${id}=`)))
      throw new Error(`--field: the field ${id} is given twice\n${USAGE}`);
    args.templateFields = [...seen, text];
  },
};

/** What is wrong with the flags and operands of these three commands, or undefined. */
export function templatesProblem(args: CliArgs): string | undefined {
  const starting = args.command === "template" && args.action === "start";
  if (args.templateFields !== undefined && !starting)
    return "--field: this flag only applies to flightdeckd template start";
  if (args.command === "template") return templateProblem(args, starting);
  if (args.command === "harness") return harnessProblem(args);
  if (args.command === "task") return taskProblem(args);
  return undefined;
}

function taskProblem(args: CliArgs): string | undefined {
  if (args.confirm !== undefined)
    return "--confirm: this flag only applies to flightdeckd harness templates delete";
  const path = args.action === "preview" ? args.taskWords?.[1] : undefined;
  return path !== undefined && !posix.isAbsolute(path) && !win32.isAbsolute(path)
    ? "the path: give an absolute path, as task results prints it"
    : undefined;
}

function templateProblem(args: CliArgs, starting: boolean): string | undefined {
  if (args.confirm !== undefined)
    return "--confirm: this flag only applies to flightdeckd harness templates delete";
  if (!starting) {
    if (args.personaName !== undefined)
      return "--name: this flag only applies to flightdeckd template start";
    if (args.language !== undefined)
      return "--language: this flag only applies to flightdeckd template start";
    return undefined;
  }
  if (!TEMPLATE_ID.test(args.templateWords?.[0] ?? ""))
    return "the template id: lowercase letters, digits and dashes, as template list prints it";
  const name = args.personaName;
  if (name !== undefined && (name.trim() === "" || name.length > NAME_MAX))
    return `--name: 1 to ${NAME_MAX} characters`;
  return undefined;
}

function harnessProblem(args: CliArgs): string | undefined {
  const deleting = args.action === "templates-delete";
  if (!deleting) {
    return args.confirm === undefined
      ? undefined
      : "--confirm: this flag only applies to flightdeckd harness templates delete";
  }
  if (!TEMPLATE_ID.test(args.harnessWords?.[0] ?? ""))
    return "the harness template id: lowercase letters, digits and dashes, as harness templates list prints it";
  return args.confirm === undefined
    ? "harness templates delete removes the template's folder from the host: pass --confirm"
    : undefined;
}

/** What the template and task runner takes from the parsed arguments (checked by the readers above). */
export function templatesCliArgs(args: CliArgs): TemplatesCliArgs {
  const json = args.json ? { json: true as const } : {};
  if (args.command === "task") {
    const [session = "", path = ""] = args.taskWords ?? [];
    return args.action === "preview"
      ? { action: "preview", session, path, ...json }
      : { action: "results", session, ...json };
  }
  if (args.action !== "start") return { action: "list", ...json };
  const values = Object.fromEntries(
    (args.templateFields ?? []).map((field) => {
      const at = field.indexOf("=");
      return [field.slice(0, at), field.slice(at + 1)];
    }),
  );
  return {
    action: "start",
    templateId: args.templateWords?.[0] ?? "",
    language: args.language ?? "en",
    values,
    ...(args.personaName === undefined ? {} : { name: args.personaName }),
    ...json,
  };
}

/** What the harness runner takes from the parsed arguments. */
export function harnessCliArgs(args: CliArgs): HarnessCliArgs {
  const json = args.json ? { json: true as const } : {};
  return args.action === "templates-delete"
    ? { action: "delete", id: args.harnessWords?.[0] ?? "", ...json }
    : { action: "list", ...json };
}
