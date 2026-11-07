import { describe, expect, test } from "bun:test";
import { homeLeaders, type LeaderSource, sharePercent } from "../src/lib/home-leaders.ts";

const projects = (...rows: Array<[string, number, number?]>): LeaderSource => ({
  byProject: rows.map(([projectKey, tokens, costUsd = 0]) => ({ projectKey, tokens, costUsd })),
  byModel: [],
  byPersona: [],
});
const none: LeaderSource = { byProject: [], byModel: [], byPersona: [] };
const flat = { direction: "flat", percent: 0 } as const;

describe("home-leaders: the share of each project, model and persona over the 7 days", () => {
  test("the five with the most tokens come first, then one row for the rest", () => {
    const week = projects(
      ["a", 400],
      ["b", 200, 9],
      ["c", 100],
      ["d", 100],
      ["e", 80],
      ["f", 70],
      ["g", 50],
    );
    const rows = homeLeaders(week, none, none).project.map(({ key, others, tokens, share }) => ({
      key,
      others,
      tokens,
      share,
    }));
    expect(rows).toEqual([
      { key: "a", others: 0, tokens: 400, share: 0.4 },
      { key: "b", others: 0, tokens: 200, share: 0.2 },
      { key: "c", others: 0, tokens: 100, share: 0.1 },
      { key: "d", others: 0, tokens: 100, share: 0.1 },
      { key: "e", others: 0, tokens: 80, share: 0.08 },
      { key: null, others: 2, tokens: 120, share: 0.12 },
    ]);
  });

  test("by tokens, not cost; nothing with no tokens; no 'rest' row for five or fewer", () => {
    const week = projects(["cheap", 300, 1], ["dear", 100, 50], ["idle", 0, 0]);
    expect(homeLeaders(week, none, none).project.map((r) => [r.key, r.others])).toEqual([
      ["cheap", 0],
      ["dear", 0],
    ]);
    expect(homeLeaders(none, none, none)).toEqual({ project: [], model: [], persona: [] });
  });

  test("six items are six names: a rest row stands for two or more", () => {
    const week = projects(["a", 6], ["b", 5], ["c", 4], ["d", 3], ["e", 2], ["f", 1]);
    expect(homeLeaders(week, none, none).project.map((r) => [r.key, r.others])).toEqual([
      ["a", 0],
      ["b", 0],
      ["c", 0],
      ["d", 0],
      ["e", 0],
      ["f", 0],
    ]);
  });

  test("no persona is a row of its own, and a model without a price still counts its tokens", () => {
    const week: LeaderSource = {
      byProject: [],
      byModel: [
        { model: "opus", tokens: 30, costUsd: 3, priced: true },
        { model: "local", tokens: 70, costUsd: 0, priced: false },
      ],
      byPersona: [
        { persona: null, tokens: 60, costUsd: 1 },
        { persona: "reviewer", tokens: 40, costUsd: 1 },
      ],
    };
    const leaders = homeLeaders(week, none, none);
    expect({
      model: leaders.model.map((r) => [r.key, r.share]),
      persona: leaders.persona.map((r) => [r.key, r.share]),
    }).toEqual({
      model: [
        ["local", 0.7],
        ["opus", 0.3],
      ],
      persona: [
        [null, 0.6],
        ["reviewer", 0.4],
      ],
    });
  });
});

describe("home-leaders: the trend compares days 1-3 with days 4-6", () => {
  test("up, down, flat under 10%, and new when the first half had nothing", () => {
    const week = projects(["up", 100], ["down", 100], ["flat", 100], ["new", 100], ["gone", 100]);
    const first = projects(["up", 30], ["down", 30], ["flat", 30], ["gone", 10]);
    const second = projects(["up", 60], ["down", 15], ["flat", 32], ["new", 10]);
    const trends = Object.fromEntries(
      homeLeaders(week, first, second).project.map((r) => [r.key, r.trend]),
    );
    expect(trends).toEqual({
      up: { direction: "up", percent: 100 },
      down: { direction: "down", percent: 50 },
      flat: { direction: "flat", percent: 7 },
      new: { direction: "new", percent: null },
      gone: { direction: "down", percent: 100 },
    });
  });

  test("the rest row's trend adds up what it stands for", () => {
    const week = projects(["a", 9], ["b", 8], ["c", 7], ["d", 6], ["e", 5], ["f", 4], ["g", 3]);
    const first = projects(["f", 10], ["g", 10]);
    const second = projects(["f", 10], ["g", 10]);
    const rest = homeLeaders(week, first, second).project.at(-1);
    expect(rest?.trend).toEqual(flat);
  });
});

describe("home-leaders: the share as a whole percent", () => {
  test("rounded, and a share above 0 that rounds to 0 is 'under 1%'", () => {
    expect([sharePercent(0.3249), sharePercent(1), sharePercent(0.004), sharePercent(0)]).toEqual([
      32,
      100,
      null,
      0,
    ]);
  });
});
