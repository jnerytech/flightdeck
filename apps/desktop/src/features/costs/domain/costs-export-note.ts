import type { T } from "../../../i18n/index.ts";

/** How a Costs export ended: a file saved, the person closing the save dialog, or no file at all. */
export type CostsExport =
  | { kind: "saved"; filename: string; left: string[] }
  | { kind: "cancelled" }
  | { kind: "nothing"; left: string[] };

/** The line a screen shows for an export: its tone and its words; none when the person cancelled. */
export interface ExportNote {
  tone: "info" | "warn" | "error";
  text: string;
}

/** Says what an export did, so a press is never met with silence. */
export function exportNote(result: CostsExport, t: T): ExportNote | null {
  if (result.kind === "cancelled") return null;
  const hosts = result.left.join(", ");
  if (result.kind === "nothing") {
    const text = hosts === "" ? t("costsUi.exportNoHost") : t("costsUi.exportNothing", { hosts });
    return { tone: "error", text };
  }
  if (result.left.length > 0) {
    return { tone: "warn", text: t("costsUi.exportSavedLeft", { file: result.filename, hosts }) };
  }
  return { tone: "info", text: t("costsUi.exportSaved", { file: result.filename }) };
}
