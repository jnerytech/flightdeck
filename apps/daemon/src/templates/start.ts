import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type {
  PermissionMode,
  Template,
  TemplatePreset,
  TemplateStartResult,
} from "@flightdeck/protocol";
import { FlightdeckError } from "../errors.ts";
import { isInside, resolveAllowedCwd } from "../paths.ts";
import type { TaskTracker } from "./tasks.ts";

/** How far each preset lets Claude go: never past editing the chosen folder, never without questions. */
const MODES: Record<TemplatePreset, PermissionMode> = {
  read_only: "plan",
  ask_before_changes: "default",
  edit_folder: "acceptEdits",
};

const RESULTS_FOLDER = "Flightdeck results";

const NONE = { en: "(none)", "pt-BR": "(nenhum)" } as const;
const SAVE_IN = {
  en: (folder: string) => `Save everything you create in ${folder}.`,
  "pt-BR": (folder: string) => `Salve tudo o que criar em ${folder}.`,
} as const;

const refuse = (
  code: "bad_request" | "not_found" | "forbidden_cwd",
  message: string,
  reason: string,
  params: Record<string, string> = {},
) => new FlightdeckError(code, message, reason, params);

export interface StartDeps {
  /** Looks at the folders before the task starts and keeps the look for `task.results`. */
  tasks?: TaskTracker;
  allowedRoots: readonly string[];
  create(payload: {
    cwd: string;
    prompt: string;
    name: string;
    permissionMode: PermissionMode;
  }): { sessionId: string } | Promise<{ sessionId: string }>;
}

/** What a non-empty answer means: a choice becomes its label, a folder or file the folder to work in. */
async function answerOf(
  field: Template["fields"][number],
  given: string,
  language: "en" | "pt-BR",
  deps: StartDeps,
): Promise<{ text: string; folder?: string }> {
  if (field.kind === "choice") {
    const option = field.choices?.find((choice) => choice.id === given);
    if (!option) {
      throw refuse(
        "bad_request",
        `${given} is not an option of ${field.id}`,
        "template_choice_invalid",
        { field: field.id },
      );
    }
    return { text: option.label[language] };
  }
  if (field.kind !== "folder" && field.kind !== "file") return { text: given };
  // A folder the host does not allow is refused with the folder to ask for.
  const place = field.kind === "folder" ? given : dirname(given);
  try {
    return { text: given, folder: await resolveAllowedCwd(place, deps.allowedRoots) };
  } catch (error) {
    // `resolveAllowedCwd` fails only with `forbidden_cwd` (outside the roots, or not there).
    throw refuse("forbidden_cwd", (error as Error).message, "template_folder_outside", {
      folder: given,
    });
  }
}

/** Fills a template with what the person answered and starts the task it describes. */
export async function startTemplate(
  template: Template,
  language: "en" | "pt-BR",
  values: Record<string, string>,
  deps: StartDeps,
  name?: string,
): Promise<TemplateStartResult> {
  const answers = new Map<string, string>();
  const folders: string[] = [];
  for (const field of template.fields) {
    const given = values[field.id]?.trim() ?? "";
    if (given === "" && !field.optional) {
      throw refuse("bad_request", `${field.id} is needed`, "template_field_missing", {
        field: field.id,
      });
    }
    const answer =
      given === "" ? { text: NONE[language] } : await answerOf(field, given, language, deps);
    answers.set(field.id, answer.text);
    if (answer.folder) folders.push(answer.folder);
  }
  const working = folders[0];
  if (!working) {
    throw refuse("bad_request", "the template asks for no folder to work in", "template_no_folder");
  }
  const output = resolve(working, template.outputFolder ?? RESULTS_FOLDER);
  if (!isInside(working, output) || output === working) {
    throw refuse(
      "bad_request",
      "the results folder must be inside the chosen folder",
      "template_output_outside",
      {
        folder: template.outputFolder ?? RESULTS_FOLDER,
      },
    );
  }
  await mkdir(output, { recursive: true });
  // What the folders hold now, so what the task makes later can be told apart.
  const before = await deps.tasks?.prepare([working, output]);
  const filled = template.prompt[language].replace(
    /\{([a-z][a-z0-9_]*)\}/g,
    (_, id: string) => answers.get(id) ?? "",
  );
  const { sessionId } = await deps.create({
    cwd: working,
    prompt: `${filled}\n\n${SAVE_IN[language](output)}`,
    name: name ?? template.title[language],
    permissionMode: template.planFirst ? "plan" : MODES[template.preset],
  });
  await deps.tasks?.keep(sessionId, [working, output], before ?? {});
  return {
    sessionId,
    workingFolder: working,
    outputFolder: output,
    permissionMode: template.planFirst ? "plan" : MODES[template.preset],
  };
}
