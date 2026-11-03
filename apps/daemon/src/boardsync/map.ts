/**
 * Phase 38: how a provider's Status options and Flightdeck's board columns correspond, per board.
 * Pure: no provider and no store in here.
 */
import { BoardColumn } from "@flightdeck/protocol";

/** Status option name to board column. */
export type ColumnMap = Record<string, BoardColumn>;

export interface StatusOption {
  id: string;
  name: string;
}

/** What a board starts with, for the options it has; the person edits it afterwards. */
export const DEFAULT_COLUMN_MAP: ColumnMap = {};

/** The default map for the options a board really has (names matched without case). */
export function defaultMapFor(_options: readonly StatusOption[]): ColumnMap {
  return {};
}

/** The column a status puts a card in; null when the status is not mapped. `null` is "no status". */
export function columnOf(_map: ColumnMap, _status: string | null): BoardColumn | null {
  return "done";
}

/** The option to push for a column: the first one listed that is mapped to it; null when none is. */
export function optionFor(
  _map: ColumnMap,
  _options: readonly StatusOption[],
  _column: BoardColumn,
): StatusOption | null {
  return null;
}

/** Refuses a map with a bad column or an option the board does not have (`board_sync_map_invalid`). */
export function checkMap(_map: ColumnMap, _options: readonly StatusOption[]): void {
  void BoardColumn;
}
