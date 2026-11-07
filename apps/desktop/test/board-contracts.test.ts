import { describe, expect, test } from "bun:test";
import type { Card } from "@flightdeck/protocol";
import { askAbout, contractOf, dragNeeds, missingFor } from "../src/lib/board-contracts.ts";

const card = (over: Partial<Card> = {}) =>
  ({
    id: "c1",
    title: "A card",
    description: "",
    prUrl: null,
    prState: null,
    checksState: null,
    ...over,
  }) as unknown as Card;

const PR = { prUrl: "https://github.com/x/y/pull/1", prState: "open" as const };

// Issue #78: a column can ask for an artifact the card already carries; here is what it asks.
describe("board-contracts: what a column asks of a card", () => {
  test("Review is confirmed and asks for a PR and checks; In progress only hints and asks for criteria", () => {
    expect(contractOf("review")).toEqual({ enforce: "confirm", checks: ["pr", "checks"] });
    expect(contractOf("in_progress")).toEqual({ enforce: "hint", checks: ["criteria"] });
  });

  test("Backlog, Waiting and Done ask nothing", () => {
    for (const column of ["backlog", "waiting", "done"] as const) {
      expect(contractOf(column)).toBeNull();
      expect(missingFor(column, card())).toEqual([]);
    }
  });

  test("Review: a card with no PR lacks the PR link, and only that", () => {
    expect(missingFor("review", card())).toEqual(["pr"]);
    expect(missingFor("review", card({ checksState: "failing" }))).toEqual(["pr"]);
  });

  test("Review: a PR whose checks are running or failing says which, and passing or unreported is enough", () => {
    expect(missingFor("review", card({ ...PR, checksState: "pending" }))).toEqual([
      "checksPending",
    ]);
    expect(missingFor("review", card({ ...PR, checksState: "failing" }))).toEqual([
      "checksFailing",
    ]);
    expect(missingFor("review", card({ ...PR, checksState: "passing" }))).toEqual([]);
    // A repository with no checks never reports any: that is not a failure of the card.
    expect(missingFor("review", card({ ...PR, checksState: null }))).toEqual([]);
  });

  test("In progress: acceptance criteria are a checklist item in the description", () => {
    expect(missingFor("in_progress", card({ description: "" }))).toEqual(["criteria"]);
    expect(missingFor("in_progress", card({ description: "Just some words." }))).toEqual([
      "criteria",
    ]);
    expect(missingFor("in_progress", card({ description: "Goal\n- [ ] it works" }))).toEqual([]);
    expect(missingFor("in_progress", card({ description: "* [x] done already" }))).toEqual([]);
    expect(missingFor("in_progress", card({ description: "  - [X] indented" }))).toEqual([]);
    // A bracket in a sentence is not a checklist.
    expect(missingFor("in_progress", card({ description: "see [ ] here" }))).toEqual(["criteria"]);
  });
});

describe("board-contracts: a project's own contracts", () => {
  const mine = { done: { enforce: "confirm" as const, checks: ["pr" as const] } };

  test("a column the project sets asks what it says; the others keep the default", () => {
    expect(contractOf("done", mine)).toEqual(mine.done);
    expect(contractOf("review", mine)).toEqual({ enforce: "confirm", checks: ["pr", "checks"] });
    expect(missingFor("done", card(), mine)).toEqual(["pr"]);
    expect(missingFor("done", card({ ...PR }), mine)).toEqual([]);
  });

  test("the question and the drag hint follow the project's contract", () => {
    expect(askAbout("done", [card()], mine).map((l) => l.needs)).toEqual([["pr"]]);
    expect(askAbout("done", [card()])).toEqual([]);
    expect(dragNeeds("done", [card()], mine)).toEqual(["pr"]);
    const off = { review: { enforce: "confirm" as const, checks: [] } };
    expect(askAbout("review", [card()], off)).toEqual([]);
  });
});
