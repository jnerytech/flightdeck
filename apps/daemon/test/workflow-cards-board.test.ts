import { afterEach, describe, expect, test } from "bun:test";
import { cpSync } from "node:fs";
import { join } from "node:path";
import { UNTRUSTED_MARK } from "../src/issues/issues.ts";
import { CARDS_PER_RUN, type Finding } from "../src/workflows/findings.ts";
import { newBoard } from "./board-helpers.ts";

const boards: Array<{ stop(): void }> = [];
afterEach(() => {
  for (const board of boards.splice(0)) board.stop();
});

const ORIGIN = { workflow: "tech-debt-scan", runId: "run-1" };
const finding = (n: number, over: Partial<Finding> = {}): Finding => ({
  key: `debt:file${n}.ts:todo`,
  title: `Remove the TODO in file${n}.ts`,
  body: `file${n}.ts line 4 says TODO.`,
  ...over,
});

async function setup(options: Parameters<typeof newBoard>[0] = {}) {
  const suspended: Array<[string, string]> = [];
  const ctx = newBoard({
    suspendApproval: (cardId, reason) => suspended.push([cardId, reason]),
    ...options,
  });
  boards.push(ctx.board);
  const project = await ctx.board.addProject({ path: ctx.repo, promptTemplate: "" });
  const backlog = (projectId = project.id) =>
    ctx.board.getBoard(projectId).columns.find((c) => c.column === "backlog")?.cards ?? [];
  return { ...ctx, project, suspended, backlog };
}

describe("Board.raiseCards (issue #79)", () => {
  test("raises each new finding as a Backlog card, in order, with its text", async () => {
    const { board, project, backlog } = await setup();
    const raised = board.raiseCards(project.id, [finding(1), finding(2)], ORIGIN);
    expect(raised).toMatchObject({ duplicates: 0, overCap: 0 });
    expect(raised.created).toHaveLength(2);
    expect(backlog().map((card) => card.title)).toEqual([
      "Remove the TODO in file1.ts",
      "Remove the TODO in file2.ts",
    ]);
    expect(raised.created).toEqual(backlog().map((card) => card.id));
  });

  test("the card says it is the agent's text and where it came from, and shows the external seal", async () => {
    const { board, project, backlog } = await setup();
    board.raiseCards(project.id, [finding(1)], ORIGIN);
    const [card] = backlog();
    expect(card?.description.startsWith(UNTRUSTED_MARK)).toBe(true);
    expect(card?.description.includes("tech-debt-scan")).toBe(true);
    expect(card?.description.includes("run-1")).toBe(true);
    expect(card?.description.endsWith("file1.ts line 4 says TODO.")).toBe(true);
    expect(card?.issueExternal).toBe(true);
  });

  test("automatic approval stays off on every card it makes", async () => {
    const { board, project, suspended } = await setup();
    const raised = board.raiseCards(project.id, [finding(1), finding(2)], ORIGIN);
    expect(suspended).toHaveLength(2);
    expect(suspended.map(([cardId]) => cardId)).toEqual(raised.created);
    expect(suspended.every(([, reason]) => reason.length > 0)).toBe(true);
  });

  test("a finding whose key a card already has is not raised again", async () => {
    const { board, project, backlog } = await setup();
    board.raiseCards(project.id, [finding(1)], ORIGIN);
    // Same key, another title: the key decides.
    const again = board.raiseCards(project.id, [finding(1, { title: "Another words" })], ORIGIN);
    expect(again).toEqual({ created: [], duplicates: 1, overCap: 0 });
    expect(backlog()).toHaveLength(1);
  });

  test("a key repeated inside the list is raised once", async () => {
    const { board, project } = await setup();
    const raised = board.raiseCards(
      project.id,
      [finding(1), finding(1, { title: "Twice" })],
      ORIGIN,
    );
    expect(raised.created).toHaveLength(1);
    expect(raised.duplicates).toBe(1);
  });

  test("an open card with the same title is not raised again, whatever its case and spacing", async () => {
    const { board, project, backlog } = await setup();
    board.createCard(project.id, { title: "  remove the TODO   in FILE1.ts ", description: "" });
    const raised = board.raiseCards(project.id, [finding(1)], ORIGIN);
    expect(raised).toEqual({ created: [], duplicates: 1, overCap: 0 });
    expect(backlog()).toHaveLength(1);
  });

  test("a card of another project does not cover it", async () => {
    const { board, project, root, repo } = await setup();
    // A copy of the repository, with its history, is another folder and so another project.
    cpSync(repo, join(root, "repo2"), { recursive: true });
    const other = await board.addProject({ path: join(root, "repo2"), promptTemplate: "" });
    expect(board.raiseCards(other.id, [finding(1)], ORIGIN).created).toHaveLength(1);
    const raised = board.raiseCards(project.id, [finding(1)], ORIGIN);
    expect(raised.created).toHaveLength(1);
    expect(raised.duplicates).toBe(0);
  });

  test("a card done in the last 30 days still covers it, and one done earlier does not", async () => {
    const day = 24 * 60 * 60 * 1000;
    let skew = 0;
    const { board, project } = await setup({ clock: () => Date.now() + skew });
    const [first] = board.raiseCards(project.id, [finding(1)], ORIGIN).created;
    expect(first).toBeDefined();
    if (first) board.moveCard(first, "done");
    skew = 29 * day;
    expect(board.raiseCards(project.id, [finding(1)], ORIGIN).duplicates).toBe(1);
    skew = 31 * day;
    const later = board.raiseCards(project.id, [finding(1)], ORIGIN);
    expect(later.created).toHaveLength(1);
    expect(later.duplicates).toBe(0);
  });

  test(`creates at most ${CARDS_PER_RUN} cards and counts the rest, duplicates not included`, async () => {
    const { board, project, backlog } = await setup();
    board.raiseCards(project.id, [finding(0)], ORIGIN);
    const many = Array.from({ length: CARDS_PER_RUN + 2 }, (_, i) => finding(i));
    const raised = board.raiseCards(project.id, many, ORIGIN);
    // finding(0) was a duplicate; of the other 11, the first 10 are raised.
    expect(raised.duplicates).toBe(1);
    expect(raised.created).toHaveLength(CARDS_PER_RUN);
    expect(raised.overCap).toBe(1);
    expect(backlog()).toHaveLength(CARDS_PER_RUN + 1);
    expect(backlog().at(-1)?.title).toBe(`Remove the TODO in file${CARDS_PER_RUN}.ts`);
  });

  test("a card whose suspension fails is not left behind without it", async () => {
    let calls = 0;
    const { board, project, backlog } = await setup({
      suspendApproval: () => {
        calls++;
        if (calls === 2) throw new Error("the store is read-only");
      },
    });
    expect(() => board.raiseCards(project.id, [finding(1), finding(2)], ORIGIN)).toThrow(
      "the store is read-only",
    );
    // The first card was suspended and stays; the second never got its suspension, so it goes.
    expect(backlog().map((card) => card.title)).toEqual(["Remove the TODO in file1.ts"]);
  });

  test("the variants of an arena started on a raised card keep the mark and the suspension", async () => {
    const { board, project, suspended } = await setup();
    const [raisedId] = board.raiseCards(project.id, [finding(1)], ORIGIN).created;
    expect(raisedId).toBeDefined();
    suspended.length = 0;
    const arena = await board.startArena(raisedId ?? "", { variants: [{}, {}] });
    expect(arena.variants).toHaveLength(2);
    for (const variant of arena.variants) {
      const card = board.getCard(variant.id);
      expect(card.issueExternal).toBe(true);
      expect(card.description.startsWith(UNTRUSTED_MARK)).toBe(true);
    }
    expect(suspended.map(([cardId]) => cardId).sort()).toEqual(
      arena.variants.map((variant) => variant.id).sort(),
    );
  });

  test("an unknown project is refused with its reason", async () => {
    const { board } = await setup();
    const refused = (() => {
      try {
        board.raiseCards("nope", [finding(1)], ORIGIN);
        return null;
      } catch (error) {
        return (error as { reason?: string }).reason ?? null;
      }
    })();
    expect(refused).toBe("project_not_found");
  });
});
