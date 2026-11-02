import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Board } from "../src/board/board.ts";
import { FlightdeckError } from "../src/errors.ts";
import { git, newBoard } from "./board-helpers.ts";

setDefaultTimeout(20_000);

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanups.splice(0).reverse()) fn();
});

/** A board with one project and cards titled A, B, C… in its Backlog. */
async function setup(titles = ["A", "B", "C"]) {
  const ctx = newBoard();
  cleanups.push(() => ctx.board.stop());
  const project = await ctx.board.addProject({ path: ctx.repo, promptTemplate: "" });
  const ids = titles.map(
    (title) => ctx.board.createCard(project.id, { title, description: "" }).id,
  );
  return { ...ctx, project, ids };
}

/** What `fn` refuses with: the code, the reason and the params. */
async function refusal(fn: () => unknown) {
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

describe("deps-model: the links", () => {
  test("a card made with blockers lists them in order, and each blocker lists the card it holds up", async () => {
    const { board, project, ids } = await setup();
    const [a, b] = ids as [string, string];
    const card = board.createCard(project.id, { title: "D", description: "", blockedBy: [b, a] });
    expect(card.blockedBy).toEqual([b, a]);
    expect(card.waitingOn).toEqual([b, a]);
    expect(board.getCard(a).blocking).toEqual([card.id]);
    expect(board.getCard(b).blocking).toEqual([card.id]);
  });

  test("updating the blockers replaces the set, and the two ends follow", async () => {
    const { board, ids } = await setup();
    const [a, b, c] = ids as [string, string, string];
    board.updateCard(c, { blockedBy: [a, b] });
    board.updateCard(c, { blockedBy: [b] });
    expect(board.getCard(c).blockedBy).toEqual([b]);
    expect(board.getCard(a).blocking).toEqual([]);
    expect(board.getCard(b).blocking).toEqual([c]);
    board.updateCard(c, { blockedBy: [] });
    expect(board.getCard(c).blockedBy).toEqual([]);
    expect(board.getCard(c).waitingOn).toEqual([]);
    expect(board.getCard(b).blocking).toEqual([]);
  });

  test("an update with no blockers in it leaves them alone", async () => {
    const { board, ids } = await setup();
    const [a, b] = ids as [string, string];
    board.updateCard(b, { blockedBy: [a] });
    board.updateCard(b, { title: "B2" });
    expect(board.getCard(b).blockedBy).toEqual([a]);
  });

  test("the condition and the auto-start are kept with the card", async () => {
    const { board, ids } = await setup();
    const [a, b] = ids as [string, string];
    expect(board.getCard(b).unblockWhen).toBe("done");
    board.updateCard(b, {
      blockedBy: [a],
      unblockWhen: "merged",
      autoStart: { workflow: "feature" },
    });
    expect(board.getCard(b).unblockWhen).toBe("merged");
    expect(board.getCard(b).autoStart).toEqual({ workflow: "feature" });
    board.updateCard(b, { autoStart: null });
    expect(board.getCard(b).autoStart).toBeNull();
  });

  test("the links survive a new board over the same database", async () => {
    const { board, manager, store, ids, root } = await setup();
    const [a, b] = ids as [string, string];
    board.updateCard(b, { blockedBy: [a] });
    const again = new Board({ db: store.db, manager, allowedRoots: [root] });
    cleanups.push(() => again.stop());
    expect(again.getCard(b).blockedBy).toEqual([a]);
  });
});

describe("deps-model: what is refused", () => {
  test("a blocker of another project", async () => {
    const { board, ids, root } = await setup();
    const repo = join(root, "other");
    mkdirSync(repo);
    git(repo, "init", "-q", "-b", "main");
    git(repo, "commit", "-q", "--allow-empty", "-m", "inicial");
    const other = await board.addProject({ path: repo, promptTemplate: "" });
    const foreign = board.createCard(other.id, { title: "X", description: "" }).id;
    const out = await refusal(() => board.updateCard(ids[0] as string, { blockedBy: [foreign] }));
    expect(out).toEqual({
      code: "invalid_state",
      reason: "blocker_other_project",
      params: undefined,
    });
    expect(board.getCard(ids[0] as string).blockedBy).toEqual([]);
  });

  test("a blocker that does not exist", async () => {
    const { board, ids } = await setup();
    const out = await refusal(() => board.updateCard(ids[0] as string, { blockedBy: ["nope"] }));
    expect(out?.code).toBe("not_found");
  });

  test("a card blocked by itself, with the cycle named", async () => {
    const { board, ids } = await setup();
    const out = await refusal(() =>
      board.updateCard(ids[0] as string, { blockedBy: [ids[0] as string] }),
    );
    expect(out).toEqual({
      code: "invalid_state",
      reason: "blocker_cycle",
      params: { cycle: "A → A" },
    });
  });

  test("a two-card cycle and a long one, with the cycle named, and nothing stored", async () => {
    const { board, ids } = await setup();
    const [a, b, c] = ids as [string, string, string];
    board.updateCard(a, { blockedBy: [b] });
    const two = await refusal(() => board.updateCard(b, { blockedBy: [a] }));
    expect(two?.params).toEqual({ cycle: "B → A → B" });
    board.updateCard(b, { blockedBy: [c] });
    const long = await refusal(() => board.updateCard(c, { blockedBy: [a] }));
    expect(long).toEqual({
      code: "invalid_state",
      reason: "blocker_cycle",
      params: { cycle: "C → A → B → C" },
    });
    expect(board.getCard(c).blockedBy).toEqual([]);
  });

  test("a blocker that does not exist stops the creation of the card", async () => {
    const { board, project, ids } = await setup();
    const out = await refusal(() =>
      board.createCard(project.id, { title: "D", description: "", blockedBy: ["nope"] }),
    );
    expect(out?.code).toBe("not_found");
    expect(ids).toHaveLength(3);
  });

  test("two blockers that share a blocker of their own are no cycle", async () => {
    const { board, project, ids } = await setup(["A", "B", "C", "D"]);
    const [a, b, c, d] = ids as [string, string, string, string];
    board.updateCard(b, { blockedBy: [a] });
    board.updateCard(c, { blockedBy: [a] });
    board.updateCard(d, { blockedBy: [b, c] });
    const e = board.createCard(project.id, { title: "E", description: "" }).id;
    board.updateCard(e, { blockedBy: [d] });
    expect(board.getCard(e).blockedBy).toEqual([d]);
  });

  test("twenty blockers are allowed and twenty-one are not", async () => {
    const { board, project, ids } = await setup(["A"]);
    const many = Array.from(
      { length: 21 },
      (_, i) => board.createCard(project.id, { title: `M${i}`, description: "" }).id,
    );
    board.updateCard(ids[0] as string, { blockedBy: many.slice(0, 20) });
    expect(board.getCard(ids[0] as string).blockedBy).toHaveLength(20);
    const out = await refusal(() => board.updateCard(ids[0] as string, { blockedBy: many }));
    expect(out).toEqual({ code: "invalid_state", reason: "blocker_limit", params: { max: 20 } });
  });
});

describe("deps-model: a card that goes away", () => {
  test("a discarded blocker leaves the set, the dependent says so and is not waiting on a ghost", async () => {
    const { board, ids } = await setup();
    const [a, b, c] = ids as [string, string, string];
    board.updateCard(c, { blockedBy: [a, b] });
    await board.discardCard(a, true);
    const left = board.getCard(c);
    expect(left.blockedBy).toEqual([b]);
    expect(left.waitingOn).toEqual([b]);
    expect(left.notice).toBe('Blocker "A" was discarded and no longer blocks this card.');
    await board.discardCard(b, true);
    const free = board.getCard(c);
    expect(free.blockedBy).toEqual([]);
    expect(free.waitingOn).toEqual([]);
  });

  test("the watchers hear about the dependent when its blocker is discarded", async () => {
    const { board, ids } = await setup();
    const [a, b] = ids as [string, string];
    board.updateCard(b, { blockedBy: [a] });
    const heard: string[] = [];
    board.watch((card) => {
      if (card.id === b) heard.push(card.notice ?? "");
    });
    await board.discardCard(a, true);
    expect(heard.at(-1)).toBe('Blocker "A" was discarded and no longer blocks this card.');
  });

  test("a discarded dependent leaves no link rows behind", async () => {
    const { board, store, ids } = await setup();
    const [a, b] = ids as [string, string];
    board.updateCard(b, { blockedBy: [a] });
    await board.discardCard(b, true);
    expect(store.db.query("SELECT COUNT(*) AS n FROM card_blockers").get()).toEqual({ n: 0 });
    expect(board.getCard(a).blocking).toEqual([]);
  });
});
