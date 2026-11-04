import { describe, expect, test } from "bun:test";
import { KEY, PERIOD, roiSetup } from "./roi-setup.ts";

const project = async (s: Awaited<ReturnType<typeof roiSetup>>) =>
  s.summarizer.summary(PERIOD).projects.find((p) => p.projectKey === KEY);

describe("roi-planejado: planned and unplanned work, and tokens", () => {
  test("a card that was on the board before the period is planned, one created inside it is unplanned", async () => {
    const s = await roiSetup();
    s.done("a", "2026-10-09", "2026-09-20");
    s.done("b", "2026-10-10", "2026-10-07");
    s.done("c", "2026-10-10", "2026-10-08");
    s.done("d", "2026-10-13", "2026-10-12");
    expect((await project(s))?.current).toMatchObject({ cards: 4, planned: 2, unplanned: 2 });
  });

  test("the same split holds for the PRs merged", async () => {
    const s = await roiSetup();
    s.done("a", "2026-10-09", "2026-09-20", { via: "merged" });
    s.done("b", "2026-10-10", "2026-10-09", { via: "merged" });
    s.done("c", "2026-10-11", "2026-10-09", { via: "moved" });
    expect((await project(s))?.current).toMatchObject({
      prsMerged: 2,
      plannedPrs: 1,
      unplannedPrs: 1,
      planned: 1,
      unplanned: 2,
    });
  });

  test("the previous period is split from its own first day, and so is every week", async () => {
    const s = await roiSetup();
    s.done("a", "2026-10-03", "2026-09-20");
    s.done("b", "2026-10-05", "2026-10-02");
    s.done("c", "2026-10-09", "2026-10-02");
    const p = await project(s);
    expect(p?.previous).toMatchObject({ cards: 2, planned: 1, unplanned: 1 });
    expect(p?.current).toMatchObject({ cards: 1, planned: 1, unplanned: 0 });
    const last = p?.current.weeks.at(-1);
    expect(last).toMatchObject({ cards: 1, planned: 1, unplanned: 0 });
    expect(p?.current.weeks.at(-2)).toMatchObject({ cards: 2, planned: 1, unplanned: 1 });
  });

  test("planned plus unplanned is always the cards done", async () => {
    const s = await roiSetup();
    for (let i = 0; i < 6; i += 1)
      s.done(
        `c${i}`,
        `2026-10-${String(8 + i).padStart(2, "0")}`,
        i % 2 ? "2026-09-01" : "2026-10-09",
      );
    const current = (await project(s))?.current;
    expect((current?.planned ?? 0) + (current?.unplanned ?? 0)).toBe(current?.cards ?? -1);
  });

  test("tokens are the input, output and every kind of cache token of the period", async () => {
    const s = await roiSetup();
    s.usage("2026-10-09", 1, 1234);
    s.usage("2026-10-10", 1, 766);
    expect((await project(s))?.current.tokens).toBe(2000);
  });
});
