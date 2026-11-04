/**
 * Phase 38: how a provider's Status options and Flightdeck's board columns correspond, per board.
 * Pure: no provider and no store in here.
 */
import { BoardColumn } from "@flightdeck/protocol";
import { FlightdeckError } from "../errors.ts";

/** Status option name to board column. */
export type ColumnMap = Record<string, BoardColumn>;

export interface StatusOption {
  id: string;
  name: string;
}

const COLUMNS = new Set<string>(BoardColumn.options);

/** What a board starts with, for the options it has; the person edits it afterwards. */
export const DEFAULT_COLUMN_MAP: ColumnMap = {
  Todo: "backlog",
  Backlog: "backlog",
  "No status": "backlog",
  "In Progress": "in_progress",
  "In Review": "review",
  Done: "done",
};

const DEFAULT_BY_NAME = new Map(
  Object.entries(DEFAULT_COLUMN_MAP).map(([name, column]) => [name.toLowerCase(), column]),
);

/** The default map for the options a board really has (names matched without case). */
export function defaultMapFor(options: readonly StatusOption[]): ColumnMap {
  const map: ColumnMap = {};
  for (const option of options) {
    const column = DEFAULT_BY_NAME.get(option.name.toLowerCase());
    if (column) map[option.name] = column;
  }
  return map;
}

/** The column a status puts a card in; null when the status is not mapped. `null` is "no status". */
export function columnOf(map: ColumnMap, status: string | null): BoardColumn | null {
  return map[status ?? "No status"] ?? null;
}

/** The option to push for a column: the first one listed that is mapped to it; null when none is. */
export function optionFor(
  map: ColumnMap,
  options: readonly StatusOption[],
  column: BoardColumn,
): StatusOption | null {
  return options.find((option) => map[option.name] === column) ?? null;
}

/** Refuses a map with a bad column or an option the board does not have (`board_sync_map_invalid`). */
export function checkMap(map: ColumnMap, options: readonly StatusOption[]): void {
  const names = new Set(options.map((option) => option.name));
  for (const [option, column] of Object.entries(map)) {
    // "No status" stands for an item with no status at all: it needs no option.
    if (!COLUMNS.has(column) || (option !== "No status" && !names.has(option))) {
      throw new FlightdeckError(
        "bad_request",
        `the map has an unknown column or option: ${option}`,
        "board_sync_map_invalid",
        { option },
      );
    }
  }
}
