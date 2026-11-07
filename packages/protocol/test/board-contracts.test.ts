import { describe, expect, test } from "bun:test";
import {
  type ColumnContract,
  Command,
  contractOf,
  DAEMON_REASONS,
  DEFAULT_CONTRACTS,
  ErrorCode,
  missingFor,
  Project,
} from "../src/index.ts";

const card = (
  over: Partial<{ description: string; prUrl: string | null; checksState: never }>,
) => ({
  description: "",
  prUrl: null,
  checksState: null,
  ...over,
});

describe("board-contracts: what a column asks of a card", () => {
  test("by default In progress hints at criteria and Review confirms a PR and its checks", () => {
    expect(DEFAULT_CONTRACTS.in_progress).toEqual({ enforce: "hint", checks: ["criteria"] });
    expect(DEFAULT_CONTRACTS.review).toEqual({ enforce: "confirm", checks: ["pr", "checks"] });
    expect(contractOf("backlog")).toBeNull();
    expect(contractOf("done")).toBeNull();
  });

  test("a project's contract wins over the default, a column it leaves out keeps the default", () => {
    const mine: ColumnContract = { enforce: "confirm", checks: ["criteria"] };
    expect(contractOf("done", { done: mine })).toEqual(mine);
    expect(contractOf("review", { done: mine })).toEqual(DEFAULT_CONTRACTS.review ?? null);
  });

  test("a checklist item is the acceptance criteria", () => {
    expect(missingFor("in_progress", card({ description: "plan" }))).toEqual(["criteria"]);
    expect(missingFor("in_progress", card({ description: "- [ ] one" }))).toEqual([]);
    expect(missingFor("in_progress", card({ description: "* [x] done thing" }))).toEqual([]);
  });

  test("Review lacks a PR first; its checks only count once there is a PR", () => {
    expect(missingFor("review", card({}))).toEqual(["pr"]);
    expect(missingFor("review", card({ prUrl: "https://x/pr/1" }))).toEqual([]);
    const pending = card({ prUrl: "https://x/pr/1", checksState: "pending" as never });
    const failing = card({ prUrl: "https://x/pr/1", checksState: "failing" as never });
    const passing = card({ prUrl: "https://x/pr/1", checksState: "passing" as never });
    expect(missingFor("review", pending)).toEqual(["checksPending"]);
    expect(missingFor("review", failing)).toEqual(["checksFailing"]);
    expect(missingFor("review", passing)).toEqual([]);
    expect(missingFor("review", card({ checksState: "failing" as never }))).toEqual(["pr"]);
  });

  test("a column that asks nothing lacks nothing, and an override can turn a column off", () => {
    expect(missingFor("backlog", card({}))).toEqual([]);
    expect(missingFor("review", card({}), { review: { enforce: "confirm", checks: [] } })).toEqual(
      [],
    );
  });
});

describe("board-contracts: the wire", () => {
  test("a project carries contractByColumn, empty when an older daemon sends none", () => {
    const base = {
      id: "p",
      path: "/r",
      name: "r",
      baseBranch: "main",
      prProvider: "none",
      setupScript: null,
      promptTemplate: "",
    };
    expect(Project.parse(base).contractByColumn).toEqual({});
    const withOne = Project.parse({
      ...base,
      contractByColumn: { review: { enforce: "hint", checks: ["pr"] } },
    });
    expect(withOne.contractByColumn.review).toEqual({ enforce: "hint", checks: ["pr"] });
  });

  test("project.update takes contractByColumn, and null gives a column back to the default", () => {
    const parsed = Command.safeParse({
      type: "project.update",
      id: "1",
      payload: {
        projectId: "p",
        contractByColumn: { review: null, done: { enforce: "confirm", checks: ["pr"] } },
      },
    });
    expect(parsed.success).toBe(true);
    const bad = Command.safeParse({
      type: "project.update",
      id: "1",
      payload: { projectId: "p", contractByColumn: { review: { enforce: "never", checks: [] } } },
    });
    expect(bad.success).toBe(false);
  });

  test("card.move takes force, and the refusal has its own code and reasons", () => {
    const move = Command.safeParse({
      type: "card.move",
      id: "1",
      payload: { cardId: "c", column: "review", force: true },
    });
    expect(move.success).toBe(true);
    expect(ErrorCode.options).toContain("contract_unmet");
    expect(DAEMON_REASONS).toContain("card_contract_unmet");
    expect(DAEMON_REASONS).toContain("card_moved_anyway");
  });
});
