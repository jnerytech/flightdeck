import { afterEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BoardColumn, type BoardColumn as Column } from "@flightdeck/protocol";
import { manageCard } from "../src/board/manage.ts";
import { FlightdeckError } from "../src/errors.ts";
import { PrWatch } from "../src/watch/service.ts";
import { newBoard } from "./board-helpers.ts";
import { item } from "./boardsync-contract.ts";
import { syncSetup } from "./boardsync-setup.ts";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function withCard() {
  const ctx = newBoard();
  cleanups.push(() => ctx.board.stop());
  const project = await ctx.board.addProject({ path: ctx.repo, promptTemplate: "" });
  const card = ctx.board.createCard(project.id, { title: "t", description: "no checklist" });
  const setPr = (url: string | null, checks: string | null = null) =>
    ctx.store.db
      .query("UPDATE cards SET pr_url = ?, pr_state = 'open', checks_state = ? WHERE id = ?")
      .run(url, checks, card.id);
  return { ...ctx, project, card, setPr };
}

function refusal(call: () => unknown): FlightdeckError {
  try {
    call();
  } catch (error) {
    expect(error).toBeInstanceOf(FlightdeckError);
    return error as FlightdeckError;
  }
  throw new Error("it did not refuse");
}

describe("board-contracts: a person's move to a column that confirms", () => {
  test("a card with no PR is refused Review, with its own code and what it lacks", () => {
    return withCard().then(({ board, card }) => {
      const error = refusal(() => board.moveByHand(card.id, "review", undefined, false));
      expect(error.code).toBe("contract_unmet");
      expect(error.reason).toBe("card_contract_unmet");
      expect(error.params).toEqual({ column: "review", needs: "pr" });
      expect(board.getCard(card.id).column).toBe("backlog");
    });
  });

  test("failing or pending checks refuse it too, each with its own need", async () => {
    const { board, card, setPr } = await withCard();
    setPr("https://github.com/a/b/pull/1", "failing");
    expect(refusal(() => board.moveByHand(card.id, "review", undefined, false)).params).toEqual({
      column: "review",
      needs: "checksFailing",
    });
    setPr("https://github.com/a/b/pull/1", "pending");
    expect(refusal(() => board.moveByHand(card.id, "review", undefined, false)).params?.needs).toBe(
      "checksPending",
    );
  });

  test("a card with a PR and no failing checks moves, with no notice", async () => {
    const { board, card, setPr } = await withCard();
    setPr("https://github.com/a/b/pull/1", "passing");
    const moved = board.moveByHand(card.id, "review", undefined, false);
    expect(moved.column).toBe("review");
    expect(moved.notice).toBeNull();
  });

  test("force moves it and records on the card what it lacked", async () => {
    const { board, card } = await withCard();
    const moved = board.moveByHand(card.id, "review", 3, true);
    expect(moved.column).toBe("review");
    expect(moved.notice).toBe("Moved to review anyway: it lacked pr.");
    expect(moved.noticeReason).toBe("card_moved_anyway");
    expect(moved.noticeParams).toEqual({ column: "review", needs: "pr" });
  });

  test("force on a card that lacks nothing records nothing", async () => {
    const { board, card, setPr } = await withCard();
    setPr("https://github.com/a/b/pull/1", "passing");
    expect(board.moveByHand(card.id, "review", undefined, true).notice).toBeNull();
  });

  test("a column that only hints never refuses, and records nothing", async () => {
    const { board, card } = await withCard();
    const moved = board.moveByHand(card.id, "in_progress", undefined, false);
    expect(moved.column).toBe("in_progress");
    expect(moved.notice).toBeNull();
  });

  test("the notice goes when the person moves the card on", async () => {
    const { board, card } = await withCard();
    board.moveByHand(card.id, "review", undefined, true);
    const later = board.moveByHand(card.id, "waiting", undefined, false);
    expect(later.notice).toBeNull();
  });

  test("a card already in the column is only reordered, with no question", async () => {
    const { board, card } = await withCard();
    board.moveByHand(card.id, "review", undefined, true);
    expect(board.moveByHand(card.id, "review", 9, false).position).toBe(9);
  });
});

describe("board-contracts: contracts per project", () => {
  test("a project's contract replaces the default of that column, and null gives it back", async () => {
    const { board, project, card } = await withCard();
    expect(project.contractByColumn).toEqual({});
    const set = board.updateProject(project.id, {
      contractByColumn: { done: { enforce: "confirm", checks: ["pr"] } },
    });
    expect(set.contractByColumn).toEqual({ done: { enforce: "confirm", checks: ["pr"] } });
    expect(board.getProject(project.id).contractByColumn.done?.checks).toEqual(["pr"]);
    expect(refusal(() => board.moveByHand(card.id, "done", undefined, false)).params).toEqual({
      column: "done",
      needs: "pr",
    });
    const off = board.updateProject(project.id, {
      contractByColumn: { review: { enforce: "confirm", checks: [] } },
    });
    expect(board.moveByHand(card.id, "review", undefined, false).column).toBe("review");
    expect(off.contractByColumn.review?.checks).toEqual([]);
    const back = board.updateProject(project.id, { contractByColumn: { done: null } });
    expect(back.contractByColumn.done).toBeUndefined();
    expect(back.contractByColumn.review?.checks).toEqual([]);
    expect(board.moveByHand(card.id, "done", undefined, false).column).toBe("done");
  });

  test("a column that does not exist, or a check that does not, is refused", async () => {
    const { board, project } = await withCard();
    const badColumn = refusal(() =>
      board.updateProject(project.id, {
        contractByColumn: { nope: { enforce: "hint", checks: [] } },
      } as never),
    );
    expect(badColumn.reason).toBe("column_unknown");
    const badCheck = refusal(() =>
      board.updateProject(project.id, {
        contractByColumn: { review: { enforce: "hint", checks: ["magic"] } },
      } as never),
    );
    expect(badCheck.code).toBe("bad_request");
  });
});

/** Every column asks everything: the strictest project there is. */
function strictest() {
  return Object.fromEntries(
    BoardColumn.options.map((column: Column) => [
      column,
      { enforce: "confirm", checks: ["criteria", "pr", "checks"] },
    ]),
  ) as Record<Column, { enforce: "confirm"; checks: ["criteria", "pr", "checks"] }>;
}

describe("board-contracts: what moves cards on its own is never refused", () => {
  test("moveCard asks nothing of any column", async () => {
    const { board, project, card } = await withCard();
    board.updateProject(project.id, { contractByColumn: strictest() });
    for (const column of ["review", "in_progress", "waiting", "done", "backlog"] as const) {
      expect(board.moveCard(card.id, column).column).toBe(column);
    }
  });

  test("a session managing its card moves it (manage.ts)", async () => {
    const { board, project, card, repo } = await withCard();
    board.updateProject(project.id, { contractByColumn: strictest() });
    const moved = await manageCard({ board, cwdOf: () => null }, {
      action: "move",
      column: "review",
      cardId: card.id,
      cwd: repo,
      as: {},
    } as never);
    expect(moved.column).toBe("review");
    expect(moved.notice).toBeNull();
  });

  test("the board sync moves a card to the column of its item (boardsync)", async () => {
    const s = await syncSetup();
    s.board.updateProject(s.project.id, { contractByColumn: strictest() });
    s.provider.items = [item(1, { status: "In Review" })];
    await s.sync.syncProject(s.project.id);
    expect(s.cards()[0]?.column).toBe("review");
    s.provider.items = [item(1, { status: "Done" })];
    await s.sync.syncProject(s.project.id);
    expect(s.cards()[0]?.column).toBe("done");
  });

  test("a watch that hands the card back to Review moves it (watch service)", async () => {
    const { board, project, card } = await withCard();
    board.updateProject(project.id, { contractByColumn: strictest() });
    board.moveCard(card.id, "waiting");
    let resumed = false;
    const watcher = {
      enabled: () => true,
      extend: () => undefined,
      status: () => ({ status: resumed ? "watching" : "needs_you" }),
      resume: () => {
        resumed = true;
      },
    };
    const fixer = {
      blockedBesidesRounds: () => null,
      roundBudget: () => ({ used: 0, max: 3 }),
      rounds: () => [],
    };
    const watch = new PrWatch({ board, watcher, fixer, traces: {} } as never);
    watch.extend(card.id, 1);
    expect(board.getCard(card.id).column).toBe("review");
  });

  test("only the app's card.move asks: no other file of the daemon calls moveByHand", () => {
    const users: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (path.endsWith(".ts") && readFileSync(path, "utf8").includes("moveByHand(")) {
          users.push(path.slice(path.indexOf("apps/daemon/src/")));
        }
      }
    };
    walk(join(import.meta.dir, "../src"));
    expect(users.sort()).toEqual(["apps/daemon/src/board/board.ts", "apps/daemon/src/server.ts"]);
  });
});
