/**
 * Phase 19: the vault report as CSV. A cell that starts with a formula character is prefixed with
 * a quote so a spreadsheet shows it as text instead of running it.
 */
import type { VaultReportRow } from "@flightdeck/protocol";

export function csvCell(_value: string | number): string {
  return "";
}

export function toCsv(_rows: readonly VaultReportRow[]): string {
  return "";
}
