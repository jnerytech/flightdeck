/**
 * Phase 19: the vault report as CSV. A cell that starts with a formula character is prefixed with
 * a quote so a spreadsheet shows it as text instead of running it.
 */
import type { VaultReportRow } from "@flightdeck/protocol";

const FORMULA = /^[=+\-@\t\r]/;

export function csvCell(value: string | number): string {
  const text = typeof value === "number" ? String(value) : value.replace(FORMULA, "'$&");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(rows: readonly VaultReportRow[]): string {
  const lines = rows.map((row) =>
    [row.secretId, row.requester, row.outcome, row.count].map(csvCell).join(","),
  );
  return ["secret,requester,outcome,count", ...lines].join("\r\n");
}
