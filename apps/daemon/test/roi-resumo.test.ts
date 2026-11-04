import { describe, expect, test } from "bun:test";
import { KEY, PERIOD, roiSetup } from "./roi-setup.ts";

const current = async (s: Awaited<ReturnType<typeof roiSetup>>) =>
  s.summarizer.summary(PERIOD).projects.find((p) => p.projectKey === KEY)?.current;

describe("roi-resumo: the roll-up per project for a period and the one before", () => {
  test("the period and the one before it have the same length", async () => {
    const s = await roiSetup();
    const result = s.summarizer.summary(PERIOD);
    expect(result).toMatchObject({
      from: "2026-10-08",
      to: "2026-10-14",
      previousFrom: "2026-10-01",
      previousTo: "2026-10-07",
    });
  });

  test("cost and tokens are the project's, by day, and the other key stays out", async () => {
    const s = await roiSetup();
    s.usage("2026-10-08", 2, 1000);
    s.usage("2026-10-14", 3, 500);
    s.usage("2026-10-15", 99, 99);
    s.usage("2026-10-05", 4, 200);
    s.usage("2026-10-10", 50, 50, "other/repo");
    const result = s.summarizer.summary(PERIOD).projects.find((p) => p.projectKey === KEY);
    expect(result?.current).toMatchObject({ costUsd: 5, tokens: 1500 });
    expect(result?.previous).toMatchObject({ costUsd: 4, tokens: 200 });
  });

  test("cards done are counted by the day they were first done, and PRs merged by how", async () => {
    const s = await roiSetup();
    s.done("a", "2026-10-09", "2026-09-01", { via: "merged" });
    s.done("b", "2026-10-10", "2026-09-01", { via: "completed" });
    s.done("c", "2026-10-03", "2026-09-01", { via: "merged" });
    s.done("d", "2026-09-01", "2026-08-01");
    const p = s.summarizer.summary(PERIOD).projects.find((x) => x.projectKey === KEY);
    expect(p?.current).toMatchObject({ cards: 2, prsMerged: 1 });
    expect(p?.previous).toMatchObject({ cards: 1, prsMerged: 1 });
  });

  test("done cards that came from an issue are the issues resolved", async () => {
    const s = await roiSetup();
    s.done("a", "2026-10-09", "2026-09-01", { issueRef: "github:acme/shop#4" });
    s.done("b", "2026-10-09", "2026-09-01");
    expect((await current(s))?.issuesResolved).toBe(1);
  });

  test("the rework is the fix rounds of the cards done in the period and what they cost", async () => {
    const s = await roiSetup();
    s.done("a", "2026-10-09", "2026-09-01", { via: "merged", fixRounds: 2, fixCostUsd: 1.5 });
    s.done("b", "2026-10-10", "2026-09-01", { via: "merged", fixRounds: 1, fixCostUsd: 0.25 });
    s.done("c", "2026-10-02", "2026-09-01", { via: "merged", fixRounds: 9, fixCostUsd: 9 });
    expect(await current(s)).toMatchObject({ fixRounds: 3, fixCostUsd: 1.75 });
  });

  test("hours are the card's estimate, else the project's default, and the cards with none are counted", async () => {
    const s = await roiSetup();
    s.done("a", "2026-10-09", "2026-09-01", { hours: 3 });
    s.done("b", "2026-10-09", "2026-09-01");
    s.done("c", "2026-10-09", "2026-09-01");
    expect(await current(s)).toMatchObject({ hours: 3, cardsWithoutEstimate: 2 });
    s.db.query("UPDATE projects SET default_hours = 2 WHERE id = ?").run(s.project.id);
    expect(await current(s)).toMatchObject({ hours: 7, cardsWithoutEstimate: 0 });
  });

  test("the waits are the managed approvals resolved in the period, for sessions in the project", async () => {
    const s = await roiSetup();
    s.db
      .query(
        `INSERT INTO sessions (id, cwd, status, permission_mode, created_at, updated_at)
         VALUES ('s1', ?, 'idle', 'default', '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z')`,
      )
      .run(s.repo);
    const ask = (id: string, created: string, resolved: string | null) =>
      s.db
        .query(
          `INSERT INTO permission_requests (id, session_id, tool_name, input, status, created_at, resolved_at)
           VALUES (?, 's1', 'Bash', '{}', 'allowed', ?, ?)`,
        )
        .run(id, created, resolved);
    ask("r1", "2026-10-09T10:00:00Z", "2026-10-09T10:01:00Z");
    ask("r2", "2026-10-10T10:00:00Z", "2026-10-10T11:00:00Z");
    ask("r3", "2026-10-12T10:00:00Z", null);
    ask("r4", "2026-10-02T10:00:00Z", "2026-10-02T10:30:00Z");
    expect(await current(s)).toMatchObject({ decisions: 2, waitedSeconds: 3660 });
  });

  test("cost that belongs to no card is reported apart", async () => {
    const s = await roiSetup();
    s.db
      .query(
        `INSERT INTO sessions (id, claude_session_id, cwd, status, permission_mode, created_at, updated_at)
         VALUES ('s9', 'cs-card', ?, 'idle', 'default', '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z')`,
      )
      .run(s.repo);
    const card = s.done("a", "2026-10-09", "2026-09-01");
    s.db
      .query(
        "INSERT INTO card_runs (id, card_id, session_id, queued_at) VALUES ('run1', ?, 's9', '2026-10-08T00:00:00Z')",
      )
      .run(card.id);
    s.usage("2026-10-09", 4, 0, KEY, "cs-card");
    s.usage("2026-10-10", 3, 0, KEY, "cs-manual");
    expect(await current(s)).toMatchObject({ costUsd: 7, outsideCardsUsd: 3 });
  });

  test("cards whose date was approximated are counted so the view can say so", async () => {
    const s = await roiSetup();
    s.done("a", "2026-10-09", "2026-09-01", { approx: true });
    s.done("b", "2026-10-09", "2026-09-01");
    expect(await current(s)).toMatchObject({ cards: 2, approxCards: 1 });
  });

  test("a period with nothing is zeros, and the project still has its row", async () => {
    const s = await roiSetup();
    const p = s.summarizer.summary(PERIOD).projects.find((x) => x.projectKey === KEY);
    expect(p?.current).toMatchObject({
      costUsd: 0,
      tokens: 0,
      cards: 0,
      planned: 0,
      unplanned: 0,
      prsMerged: 0,
      issuesResolved: 0,
      fixRounds: 0,
      fixCostUsd: 0,
      hours: 0,
      cardsWithoutEstimate: 0,
      decisions: 0,
      waitedSeconds: 0,
      outsideCardsUsd: 0,
      approxCards: 0,
    });
    expect(p?.current.weeks).toHaveLength(8);
  });

  test("the trend has eight weeks ending on the last day, oldest first, each with its own figures", async () => {
    const s = await roiSetup();
    s.usage("2026-10-14", 1, 10);
    s.usage("2026-10-07", 2, 20);
    s.done("a", "2026-10-13", "2026-09-01", { via: "merged" });
    s.done("b", "2026-10-06", "2026-09-01");
    const weeks = (await current(s))?.weeks ?? [];
    expect(weeks).toHaveLength(8);
    expect(weeks.at(-1)).toMatchObject({
      from: "2026-10-08",
      to: "2026-10-14",
      costUsd: 1,
      tokens: 10,
      cards: 1,
      prsMerged: 1,
    });
    expect(weeks.at(-2)).toMatchObject({
      from: "2026-10-01",
      to: "2026-10-07",
      costUsd: 2,
      tokens: 20,
      cards: 1,
      prsMerged: 0,
    });
    expect(weeks[0]).toMatchObject({ from: "2026-08-20", to: "2026-08-26" });
  });

  test("the project key filter answers one project", async () => {
    const s = await roiSetup();
    s.usage("2026-10-10", 5, 0, "other/repo");
    const all = s.summarizer.summary(PERIOD).projects.map((p) => p.projectKey);
    expect(all).toEqual(expect.arrayContaining([KEY, "other/repo"]));
    const one = s.summarizer
      .summary({ ...PERIOD, projectKey: KEY })
      .projects.map((p) => p.projectKey);
    expect(one).toEqual([KEY]);
  });
});
