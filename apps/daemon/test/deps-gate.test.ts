import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { FlightdeckError } from "../src/errors.ts";
import { newBoard } from "./board-helpers.ts";

setDefaultTimeout(20_000);

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanups.splice(0).reverse()) fn();
});

/** A board with a project and the cards A, B and C in its Backlog. */
async function setup() {
  const ctx = newBoard();
  cleanups.push(() => ctx.board.stop());
  const project = await ctx.board.addProject({ path: ctx.repo, promptTemplate: "" });
  const ids = ["A", "B", "C"].map(
    (title) => ctx.board.createCard(project.id, { title, description: "" }).id,
  ) as [string, string, string];
  return { ...ctx, project, ids };
}

async function refusal(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (error) {
    if (error instanceof FlightdeckError) {
      return { code: error.code, reason: error.reason, params: error.params };
    }
    throw error;
  }
  return null;
}

describe("deps-gate: a blocked card does not start", () => {
  test("it is refused with the blockers' titles, and no run is made", async () => {
    const { board, ids } = await setup();
    const [a, b, c] = ids;
    board.updateCard(c, { blockedBy: [a, b] });
    const out = await refusal(() => board.startCard(c));
    expect(out).toEqual({
      code: "invalid_state",
      reason: "card_blocked",
      params: { blockers: "A, B" },
    });
    expect(board.getCard(c).runs).toEqual([]);
    expect(board.getCard(c).queued).toBe(false);
  });

  test("it starts once its blockers are satisfied, and a card with none is untouched", async () => {
    const { board, ids } = await setup();
    const [a, b, c] = ids;
    board.updateCard(b, { blockedBy: [a] });
    board.moveCard(a, "done");
    await board.startCard(b);
    expect(board.getCard(b).runs).toHaveLength(1);
    await board.startCard(c);
    expect(board.getCard(c).runs).toHaveLength(1);
  });

  test("moving it by hand is not gated: it moves a pin and starts nothing", async () => {
    const { board, ids } = await setup();
    const [a, b] = ids;
    board.updateCard(b, { blockedBy: [a] });
    board.moveCard(b, "in_progress");
    expect(board.getCard(b).column).toBe("in_progress");
    expect(board.getCard(b).runs).toEqual([]);
  });

  test("a fix run is never gated: the PR is already there", async () => {
    const { board, ids } = await setup();
    const [a, b] = ids;
    board.updateCard(b, { blockedBy: [a] });
    await board.startCard(b, { fix: { prompt: "conserte" } });
    expect(board.getCard(b).runs).toHaveLength(1);
  });

  test("an arena of a blocked card is refused, and no variant is made", async () => {
    const { board, project, ids } = await setup();
    const [a, b] = ids;
    board.updateCard(b, { blockedBy: [a] });
    const out = await refusal(() => board.startArena(b, { variants: [{}, {}] }));
    expect(out?.reason).toBe("card_blocked");
    expect(board.getBoard(project.id).columns.flatMap((column) => column.cards)).toHaveLength(3);
  });
});

/** The files of the daemon that call `startCard`, relative to `src`. */
function startCallers(): string[] {
  const src = join(import.meta.dir, "../src");
  const files = readdirSync(src, { recursive: true, encoding: "utf8" }).filter((f) =>
    f.endsWith(".ts"),
  );
  return files
    .filter((file) => /\.startCard\(/.test(readFileSync(join(src, file), "utf8")))
    .map((file) => relative(src, join(src, file)).replaceAll("\\", "/"))
    .sort();
}

describe("deps-gate: every way to start a card goes through the gate", () => {
  test("the callers of startCard are the known ones; a new one must be checked against the gate", () => {
    // `startCard` is the only door: the app (server.ts), the CLI (main.ts), automations, teams and
    // the board's own arena and fix runs. A new caller fails here until it is added on purpose.
    expect(startCallers()).toEqual([
      "automations/automations.ts",
      "board/board.ts",
      "main.ts",
      "server.ts",
      "teams/teams.ts",
    ]);
  });
});
