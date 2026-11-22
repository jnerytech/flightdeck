/**
 * Issue #3738: the lines `flightdeckd template list`, `template start` and `task results|preview` print. Pure:
 * the text a template or a file carries is made safe for a terminal by the caller's `said`, never here.
 */
import type {
  TaskPreviewResult,
  TaskResultsResult,
  TemplateListResult,
  TemplateStartResult,
} from "@flightdeck/protocol";

/** A template, a line per field, then the template files that did not load. */
export function templateLines(result: TemplateListResult): string[] {
  const lines: string[] = [];
  for (const template of result.templates) {
    lines.push(`${template.id}  ${template.title.en}  ${template.preset}`);
    for (const field of template.fields) {
      const choices = field.choices?.map((choice) => choice.id).join(", ");
      lines.push(
        `  field ${field.id}  ${field.kind}${choices ? `  ${choices}` : ""}${field.optional ? "  (optional)" : ""}`,
      );
    }
  }
  for (const problem of result.problems) lines.push(`problem  ${problem.file}  ${problem.reason}`);
  return lines.length > 0 ? lines : ["no task template on this host"];
}

export const startedLine = (started: TemplateStartResult): string =>
  `started  ${started.sessionId}  ${started.permissionMode}  working ${started.workingFolder}  results ${started.outputFolder}`;

/** A line per file the task made or changed. */
export function resultLines(result: TaskResultsResult): string[] {
  if (result.files.length === 0) return ["no files yet"];
  return result.files.map(
    (file) => `${file.change}  ${file.sizeBytes} B  ${file.modifiedAt}  ${file.path}`,
  );
}

/** The preview's text as lines: a file's own line breaks, `\r\n` included, are the only ones kept. */
export const previewLines = (preview: TaskPreviewResult): string[] =>
  preview.text.replace(/\r?\n$/, "").split(/\r\n|\r|\n/);

export const CUT_SHORT_RESULTS = "the list of files is cut short: the task made more than it shows";
export const CUT_SHORT_PREVIEW = "the preview is cut short: the file is longer than it shows";
export const UNSURE_START =
  ": the task may or may not have started; run flightdeckd sessions to see before you start it again";
