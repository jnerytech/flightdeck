import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { UNTRUSTED_MARK } from "../src/issues/issues.ts";
import { workflowCard } from "./workflow-helpers.ts";

// Real git in temp repositories and several turns per test: more than the default 5 s.
setDefaultTimeout(20_000);

const boards: Array<{ stop(): void }> = [];
afterEach(() => {
  for (const board of boards.splice(0)) board.stop();
});

/** The fake runtime echoes the prompt, so a prompt that ends in a json block is the agent's reply. */
const yaml = (findings: string) => `steps:
  - id: scan
    agent:
      prompt: |
        Here is what I found.
        \`\`\`json
        ${findings}
        \`\`\`
  - id: raise
    cards: { from: scan }
`;

const TWO = JSON.stringify([
  { key: "debt:a", title: "Debt A", body: "In a.ts." },
  { key: "debt:b", title: "Debt B" },
]);

async function finished(findings: string) {
  const ctx = await workflowCard(yaml(findings));
  boards.push(ctx.board);
  const titles = () =>
    ctx.board
      .getBoard(ctx.project.id)
      .columns.flatMap((column) => column.cards)
      .map((card) => card.title);
  await ctx.start();
  const run = await ctx.runWhen((r) => ["completed", "failed"].includes(r.status));
  const raise = run?.steps.find((step) => step.stepId === "raise");
  return { ...ctx, run, raise, titles };
}

describe("the cards step in a run (issue #79)", () => {
  test("raises each finding as a Backlog card and says how many", async () => {
    const { run, raise, titles, board, project } = await finished(TWO);
    expect(run?.status).toBe("completed");
    expect([raise?.type, raise?.status]).toEqual(["cards", "completed"]);
    expect(raise?.output).toBe("Raised 2 cards; 0 already covered; 0 over the cap of 10.");
    expect(titles().filter((title) => title.startsWith("Debt"))).toEqual(["Debt A", "Debt B"]);
    const raised = board
      .getBoard(project.id)
      .columns.flatMap((column) => column.cards)
      .find((card) => card.title === "Debt A");
    expect(raised?.column).toBe("backlog");
    expect(raised?.description.startsWith(UNTRUSTED_MARK)).toBe(true);
    expect(raised?.description.includes("In a.ts.")).toBe(true);
  });

  test("a finding a card already covers is counted, not raised", async () => {
    const ctx = await workflowCard(yaml(TWO));
    boards.push(ctx.board);
    ctx.board.createCard(ctx.project.id, { title: "debt a", description: "" });
    await ctx.start();
    const run = await ctx.runWhen((r) => ["completed", "failed"].includes(r.status));
    const raise = run?.steps.find((step) => step.stepId === "raise");
    expect(raise?.output).toBe("Raised 1 card; 1 already covered; 0 over the cap of 10.");
  });

  test("more than ten new findings raise ten and count the rest", async () => {
    const many = JSON.stringify(
      Array.from({ length: 12 }, (_, i) => ({ key: `debt:${i}`, title: `Debt ${i}` })),
    );
    const { raise } = await finished(many);
    expect(raise?.output).toBe("Raised 10 cards; 0 already covered; 2 over the cap of 10.");
  });

  test("an empty list is a run that raised nothing", async () => {
    const { run, raise } = await finished("[]");
    expect(run?.status).toBe("completed");
    expect(raise?.output).toBe("Raised 0 cards; 0 already covered; 0 over the cap of 10.");
  });

  test("a reply with no json block fails the run with its reason, and raises nothing", async () => {
    const ctx = await workflowCard(`steps:
  - id: scan
    agent: { prompt: "No findings block here." }
  - id: raise
    cards: { from: scan }
`);
    boards.push(ctx.board);
    await ctx.start();
    const run = await ctx.runWhen((r) => ["completed", "failed"].includes(r.status));
    expect(run?.status).toBe("failed");
    expect(run?.reasonKey).toBe("findings_missing");
    expect(run?.reasonParams).toEqual({ step: "scan" });
    expect(run?.steps.find((step) => step.stepId === "raise")?.status).toBe("failed");
  });

  test("one bad item fails the run with where it is, and raises nothing, even the good ones", async () => {
    const bad = JSON.stringify([
      { key: "debt:a", title: "Debt A" },
      { key: "bad key", title: "Debt B" },
    ]);
    const { run, titles } = await finished(bad);
    expect(run?.status).toBe("failed");
    expect(run?.reasonKey).toBe("findings_invalid");
    expect(run?.reasonParams).toEqual({ step: "scan", where: "item 2, key" });
    expect(titles().some((title) => title.startsWith("Debt"))).toBe(false);
  });
});
