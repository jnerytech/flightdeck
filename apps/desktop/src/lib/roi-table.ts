import type { RoiPeriod, RoiSummaryResult } from "@flightdeck/protocol";
import { type Figures, figures, mergePeriods, type RoiMoney } from "./roi.ts";

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
export function rowsFrom({ summaries, inScope, moneyOf, nameOf }: RowsInput): RoiRow[] {
  const byKey = new Map<string, { name: string; periods: RoiPeriod[] }>();
  for (const { result } of summaries) {
    for (const project of result.projects) {
      if (!inScope(project.projectKey)) continue;
      const found = byKey.get(project.projectKey) ?? { name: project.name, periods: [] };
      found.periods.push(project.current);
      byKey.set(project.projectKey, found);
    }
  }
  return [...byKey].map(([key, { name, periods }]) => ({
    key,
    name: nameOf(key, name),
    figures: figures(mergePeriods(periods), moneyOf(key)),
  }));
}

const numberOf = (row: RoiRow, column: Exclude<RoiColumn, "project">): number | null => {
  const f = row.figures;
  switch (column) {
    case "cost":
      return f.costUsd;
    case "cards":
      return f.cards;
    case "prs":
      return f.prsMerged;
    case "costPerCard":
      return f.costPerCard;
    case "costPerPr":
      return f.costPerPr;
    case "hours":
      return f.hours;
    case "value":
      return f.valueUsd;
    case "roi":
      return f.roi;
  }
};

/** A new list in the order asked; a figure that cannot be computed goes last either way. */
export function sortRows(rows: RoiRow[], column: RoiColumn, direction: "asc" | "desc"): RoiRow[] {
  const sign = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (column === "project") return sign * a.name.localeCompare(b.name);
    const x = numberOf(a, column);
    const y = numberOf(b, column);
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    return sign * (x - y);
  });
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

/** The sums of the rows; the ratios are worked out from the sums, not averaged. */
export function totalsOf(rows: RoiRow[]): Totals {
  const sum = (pick: (f: Figures) => number) => rows.reduce((n, r) => n + pick(r.figures), 0);
  const costUsd = sum((f) => f.costUsd);
  const cards = sum((f) => f.cards);
  const prsMerged = sum((f) => f.prsMerged);
  const valued = rows.filter((r) => r.figures.valueUsd !== null);
  const valueUsd = valued.length > 0 ? sum((f) => f.valueUsd ?? 0) : null;
  return {
    costUsd,
    cards,
    prsMerged,
    costPerCard: cards > 0 ? costUsd / cards : null,
    costPerPr: prsMerged > 0 ? costUsd / prsMerged : null,
    hours: sum((f) => f.hours),
    valueUsd,
    roi: costUsd > 0 && valueUsd !== null ? (valueUsd - costUsd) / costUsd : null,
  };
}

const cell = (text: string) => (/[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text);
const money = (n: number | null) => (n === null ? "" : n.toFixed(2));

/** The file: a header, one line per row, the derivation as text in the last column. */
export function csvOf(
  rows: RoiRow[],
  header: string[],
  derivation: (row: RoiRow) => string,
): string {
  const lines = rows.map(({ name, figures: f, ...rest }) =>
    [
      name,
      money(f.costUsd),
      String(f.cards),
      String(f.prsMerged),
      money(f.costPerCard),
      money(f.costPerPr),
      String(f.hours),
      money(f.valueUsd),
      money(f.roi),
      derivation({ name, figures: f, ...rest }),
    ]
      .map(cell)
      .join(","),
  );
  return `${[header.map(cell).join(","), ...lines].join("\r\n")}\r\n`;
}
