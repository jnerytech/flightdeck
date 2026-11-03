import { describe, expect, test } from "bun:test";
import {
  type ColumnMap,
  checkMap,
  columnOf,
  DEFAULT_COLUMN_MAP,
  defaultMapFor,
  optionFor,
} from "../src/boardsync/map.ts";

const reasonOf = (fn: () => void) => {
  try {
    fn();
  } catch (error) {
    return (error as { reason?: string }).reason;
  }
  return undefined;
};

const OPTIONS = [
  { id: "o1", name: "Todo" },
  { id: "o2", name: "In Progress" },
  { id: "o3", name: "In Review" },
  { id: "o4", name: "Done" },
];

describe("board-map: provider statuses and board columns", () => {
  test("the defaults map the usual GitHub names", () => {
    expect(DEFAULT_COLUMN_MAP).toEqual({
      Todo: "backlog",
      Backlog: "backlog",
      "No status": "backlog",
      "In Progress": "in_progress",
      "In Review": "review",
      Done: "done",
    });
  });

  test("the default for a board keeps only the options it has, matching names without case", () => {
    expect(
      defaultMapFor([
        { id: "a", name: "todo" },
        { id: "b", name: "IN PROGRESS" },
        { id: "c", name: "Blocked" },
      ]),
    ).toEqual({ todo: "backlog", "IN PROGRESS": "in_progress" });
  });

  test("pull: a mapped status gives its column, no status is the No status entry, an unmapped one is null", () => {
    const map = defaultMapFor(OPTIONS);
    expect(columnOf(map, "In Review")).toBe("review");
    expect(columnOf({ ...map, "No status": "backlog" }, null)).toBe("backlog");
    expect(columnOf(map, null)).toBeNull();
    expect(columnOf(map, "Blocked")).toBeNull();
  });

  test("push: the option for a column, the first listed when two share it, none when no option maps to it", () => {
    const map: ColumnMap = { Todo: "backlog", Later: "backlog", "In Progress": "in_progress" };
    const options = [...OPTIONS, { id: "o5", name: "Later" }];
    expect(optionFor(map, options, "backlog")).toEqual({ id: "o1", name: "Todo" });
    expect(optionFor(map, options, "in_progress")).toEqual({ id: "o2", name: "In Progress" });
    expect(optionFor(map, options, "waiting")).toBeNull();
    expect(optionFor(map, options, "done")).toBeNull();
  });

  test("a map with an unknown column or an option the board lacks is refused", () => {
    expect(() => checkMap({ Todo: "backlog", Done: "done" }, OPTIONS)).not.toThrow();
    expect(reasonOf(() => checkMap({ Todo: "nowhere" as never }, OPTIONS))).toBe(
      "board_sync_map_invalid",
    );
    expect(reasonOf(() => checkMap({ Gone: "done" }, OPTIONS))).toBe("board_sync_map_invalid");
  });
});
