import { describe, expect, test } from "bun:test";
import { FlightdeckError, refusalOf } from "../../src/kernel/errors.ts";

// Issue #1523 (the board split): refusalOf moved from board.ts to errors.ts, shared by the board
// and board/launch.ts. What the app shows of a refusal is its reason key and its parameters only.
describe("refusalOf: the reason key of a refusal, for the app", () => {
  test("a refusal with parameters gives its reason and its parameters", () => {
    const error = new FlightdeckError("invalid_state", "not now", "card_busy", { n: 2, name: "x" });
    expect(refusalOf(error)).toEqual({ reason: "card_busy", params: { n: 2, name: "x" } });
  });

  test("a refusal without parameters gives its reason alone", () => {
    const error = new FlightdeckError("invalid_state", "not now", "card_busy");
    expect(refusalOf(error)).toEqual({ reason: "card_busy" });
  });

  test("an error with no reason key, or not ours, is no refusal", () => {
    expect(refusalOf(new FlightdeckError("invalid_state", "not now"))).toBeNull();
    expect(refusalOf(new Error("boom"))).toBeNull();
    expect(refusalOf("boom")).toBeNull();
  });
});
