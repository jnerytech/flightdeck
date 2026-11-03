import type { RoiSummaryResult } from "@flightdeck/protocol";
import type { Figures, RoiMoney } from "./roi.ts";

export type RoiColumn =
  | "project"
  | "cost"
  | "cards"
  | "prs"
  | "costPerCard"
  | "costPerPr"
  | "hours"
  | "value"
  | "roi";

export interface RoiRow {
  key: string;
  name: string;
  figures: Figures;
}

export interface RowsInput {
  summaries: Array<{ hostId: string; result: RoiSummaryResult }>;
  inScope: (projectKey: string) => boolean;
  moneyOf: (projectKey: string) => RoiMoney;
  /** The name the screen shows for a project. */
  nameOf: (projectKey: string, fallback: string) => string;
}

/** One row per project of the scope; a project on several hosts is one row. */
export function rowsFrom(_input: RowsInput): RoiRow[] {
  return [];
}

export function sortRows(rows: RoiRow[], _column: RoiColumn, _direction: "asc" | "desc"): RoiRow[] {
  return rows;
}

export interface Totals {
  costUsd: number;
  cards: number;
  prsMerged: number;
  costPerCard: number | null;
  costPerPr: number | null;
  hours: number;
  valueUsd: number | null;
  roi: number | null;
}

export function totalsOf(_rows: RoiRow[]): Totals {
  return {
    costUsd: -1,
    cards: -1,
    prsMerged: -1,
    costPerCard: null,
    costPerPr: null,
    hours: -1,
    valueUsd: null,
    roi: null,
  };
}

/** The file: a header, one line per row, the derivation as text in the last column. */
export function csvOf(
  _rows: RoiRow[],
  _header: string[],
  _derivation: (row: RoiRow) => string,
): string {
  return "";
}
