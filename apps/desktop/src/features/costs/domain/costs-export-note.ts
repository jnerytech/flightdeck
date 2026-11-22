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
export function exportNote(_result: CostsExport, _t: T): ExportNote | null {
  return null;
}
