// The Agent setup context, simple-mode tasks: templates, their fields, a started task and its files (issue #1589: moved from agent-setup.ts).
import { z } from "zod";
import { LocalizedText } from "../localized-text.ts";
import { PermissionMode } from "../permissions.ts";

/** What a template asks the person for: one of a folder, a file, a short text or a choice. */
export const TemplateField = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]{0,23}$/),
    kind: z.enum(["folder", "file", "text", "choice"]),
    label: LocalizedText,
    optional: z.boolean().optional(),
    choices: z.array(z.object({ id: z.string().min(1), label: LocalizedText })).optional(),
  })
  .superRefine((field, ctx) => {
    const count = field.choices?.length ?? 0;
    if (field.kind === "choice" ? count < 2 : count > 0) {
      ctx.addIssue({
        code: "custom",
        message: "a choice has two or more options; other fields have none",
        path: ["choices"],
      });
    }
  });
export type TemplateField = z.infer<typeof TemplateField>;

/** How far Claude may go: never beyond editing the chosen folder. */
export const TemplatePreset = z.enum(["read_only", "ask_before_changes", "edit_folder"]);
export type TemplatePreset = z.infer<typeof TemplatePreset>;

/** The `{name}` placeholders a text holds. */
export const placeholdersOf = (text: string): string[] =>
  [...text.matchAll(/\{([a-z][a-z0-9_]*)\}/g)].map((match) => match[1] as string);

/** A template of a simple-mode task: what to ask, the prompt to fill and how far Claude may go. */
export const Template = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/),
    title: LocalizedText,
    description: LocalizedText,
    icon: z.string().min(1),
    /** One to three fields, each asked once. */
    fields: z.array(TemplateField).min(1).max(3),
    prompt: LocalizedText,
    preset: TemplatePreset,
    planFirst: z.boolean(),
    /** Where the results go, relative to the chosen folder; `Flightdeck results` when absent. */
    outputFolder: z.string().optional(),
  })
  .superRefine((template, ctx) => {
    const ids = template.fields.map((field) => field.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: "custom", message: "two fields share an id", path: ["fields"] });
    }
    for (const language of ["en", "pt-BR"] as const) {
      const unknown = placeholdersOf(template.prompt[language]).filter((id) => !ids.includes(id));
      if (unknown.length > 0) {
        ctx.addIssue({
          code: "custom",
          message: `the prompt names fields that do not exist: ${unknown.join(", ")}`,
          path: ["prompt", language],
        });
      }
    }
  });
export type Template = z.infer<typeof Template>;

/** A template file the host could not load, and why (the doctor shows it too). */
export const TemplateProblem = z.object({ file: z.string(), reason: z.string() });
export type TemplateProblem = z.infer<typeof TemplateProblem>;

/** The built-in templates and the host's own, and the files that did not load. */
export const TemplateListResult = z.object({
  templates: z.array(Template),
  problems: z.array(TemplateProblem),
});
export type TemplateListResult = z.infer<typeof TemplateListResult>;

/** A file a task made or changed. */
export const TaskFile = z.object({
  /** Absolute, inside the task's working folder. */
  path: z.string(),
  name: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  modifiedAt: z.string(),
  change: z.enum(["new", "changed"]),
});
export type TaskFile = z.infer<typeof TaskFile>;

/** What a task produced: its files, newest first, and whether the list was cut short. */
export const TaskResultsResult = z.object({ files: z.array(TaskFile), truncated: z.boolean() });
export type TaskResultsResult = z.infer<typeof TaskResultsResult>;

/** The start of a text file a task made, to show before opening it. */
export const TaskPreviewResult = z.object({ text: z.string(), truncated: z.boolean() });
export type TaskPreviewResult = z.infer<typeof TaskPreviewResult>;

/** A task started from a template: its session, where it works and where its results go. */
export const TemplateStartResult = z.object({
  sessionId: z.string(),
  workingFolder: z.string(),
  outputFolder: z.string(),
  permissionMode: PermissionMode,
});
export type TemplateStartResult = z.infer<typeof TemplateStartResult>;
