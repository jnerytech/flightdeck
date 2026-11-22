/**
 * Issue #3738: the lines `flightdeckd harness templates list|delete` print. Names and sizes only: a template's
 * content never leaves the host through this command.
 */
import type { HarnessTemplateInfo } from "@flightdeck/protocol";

export function harnessTemplateLines(templates: readonly HarnessTemplateInfo[]): string[] {
  if (templates.length === 0) return ["no harness template on this host"];
  return templates.map(
    (template) =>
      `${template.id}  ${template.title}  ${template.files.length} ${template.files.length === 1 ? "file" : "files"}  ${template.bytes} bytes`,
  );
}

export const deletedLine = (id: string): string => `deleted harness template ${id}`;

export const UNSURE_DELETE =
  ": the template may or may not have been deleted; run flightdeckd harness templates list to see";
