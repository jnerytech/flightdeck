import { describe, expect, test } from "bun:test";
import { BoardColumn, SessionStatus } from "@flightdeck/protocol";
import fc from "fast-check";
import { holds } from "../../../../scripts/test/property.ts";
import { type BoardEvent, nextColumn, type Placement } from "../../src/board/columns.ts";

const column = fc.constantFrom(...BoardColumn.options);

const placement: fc.Arbitrary<Placement> = fc.record({ column, locked: fc.boolean() });

const moved: fc.Arbitrary<BoardEvent> = column.map((c) => ({ type: "moved", column: c }));
const started: fc.Arbitrary<BoardEvent> = fc.constant({ type: "started" });
/** Every event that follows the card (the ones a person's move or a start do not make). */
const followed: fc.Arbitrary<BoardEvent> = fc.oneof(
  fc
    .constantFrom(...SessionStatus.options)
    .map((status): BoardEvent => ({ type: "session", status })),
  fc.boolean().map((isError): BoardEvent => ({ type: "turn", isError })),
  fc
    .constantFrom("open", "merged", "closed" as const)
    .map((state): BoardEvent => ({ type: "pr", state })),
  fc.constant<BoardEvent>({ type: "failed" }),
  fc
    .constantFrom("running", "waiting", "done" as const)
    .map((state): BoardEvent => ({ type: "workflow", state })),
);
const anyEvent = fc.oneof(moved, started, followed);

describe("board columns: properties of nextColumn", () => {
  test("a move by hand lands on the chosen column, and only backlog and done hold the card there", () => {
    holds(
      fc.property(placement, column, (before, target) => {
        const after = nextColumn(before, { type: "moved", column: target });
        expect(after).toEqual({
          column: target,
          locked: target === "backlog" || target === "done",
        });
      }),
    );
  });

  test("a start always puts the card in progress and frees it, whatever held it before", () => {
    holds(
      fc.property(placement, (before) => {
        expect(nextColumn(before, { type: "started" })).toEqual({
          column: "in_progress",
          locked: false,
        });
      }),
    );
  });

  test("a card held in backlog or done is not moved by what follows the card", () => {
    holds(
      fc.property(column, followed, (held, event) => {
        const before: Placement = { column: held, locked: true };
        expect(nextColumn(before, event)).toEqual(before);
      }),
    );
  });

  test("what follows a free card never locks it", () => {
    holds(
      fc.property(column, followed, (current, event) => {
        expect(nextColumn({ column: current, locked: false }, event).locked).toBe(false);
      }),
    );
  });

  test("the same event twice leaves the card where the first one put it", () => {
    holds(
      fc.property(placement, anyEvent, (before, event) => {
        const once = nextColumn(before, event);
        expect(nextColumn(once, event)).toEqual(once);
      }),
    );
  });
});
