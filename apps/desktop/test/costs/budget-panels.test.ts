import { describe, expect, test } from "bun:test";
import { budgetPanels } from "../../src/features/costs/index.ts";

/** Issue #3912: which host's Budgets panel opens, which goes first and which heading takes the focus. */
describe("budgetPanels", () => {
  test("a host that was being read goes first, open, and its heading takes the focus", () => {
    expect(budgetPanels(["a", "b", "c"], "b")).toEqual({
      order: ["b", "a", "c"],
      foldable: true,
      open: "b",
      focus: "b",
    });
  });

  test("with no host being read every panel stays open, in order, and the section takes the focus", () => {
    expect(budgetPanels(["a", "b"], undefined)).toEqual({
      order: ["a", "b"],
      foldable: false,
      open: null,
      focus: null,
    });
  });

  test("a host that cannot hold budgets is no host being read", () => {
    expect(budgetPanels(["a", "b"], "zz")).toEqual({
      order: ["a", "b"],
      foldable: false,
      open: null,
      focus: null,
    });
  });

  test("one host has nothing to choose from: its panel stays open and the section takes the focus", () => {
    expect(budgetPanels(["a"], "a")).toEqual({
      order: ["a"],
      foldable: false,
      open: null,
      focus: null,
    });
    expect(budgetPanels([], undefined)).toEqual({
      order: [],
      foldable: false,
      open: null,
      focus: null,
    });
  });
});
