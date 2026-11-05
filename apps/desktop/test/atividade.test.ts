import { describe, expect, test } from "bun:test";
import {
  ACTIVITY_COLUMNS,
  activityBoard,
  activityOptions,
  DONE_WINDOW_MS,
  NO_ACTIVITY_FILTER,
} from "../src/lib/activity.ts";
import { AppStore } from "../src/lib/app-store.ts";
import { activityState, HOUR, MIN, NOW } from "./activity-fixtures.ts";
import { memoryPlatform } from "./fixtures.ts";

const base = new AppStore(memoryPlatform(false, "en").platform, {
  baseDelayMs: 600_000,
}).getState();
const ids = (cards: Array<{ row: { sessionId: string | null } }>) =>
  cards.map((c) => c.row.sessionId);

describe("atividade: every session across the hosts by state (issue #151)", () => {
  test("four columns in a fixed order; a Done turn counts for two hours", () => {
    expect(ACTIVITY_COLUMNS).toEqual(["needs_you", "working", "done", "idle"]);
    expect(DONE_WINDOW_MS).toBe(2 * HOUR);
  });

  test("a session lands in the column of its state, and a finished unopened turn is Done", () => {
    const state = activityState(
      [
        { id: "ask", status: "awaiting_permission", agoMs: 5 * MIN },
        { id: "run", status: "running", agoMs: MIN },
        { id: "fin", status: "idle", agoMs: 10 * MIN, unread: true },
        { id: "old", status: "idle", agoMs: 3 * HOUR, unread: true },
        { id: "seen", status: "idle", agoMs: 10 * MIN },
        { id: "gone", status: "ended", agoMs: 10 * MIN },
      ],
      base,
    );
    const { columns } = activityBoard(state, NOW, NO_ACTIVITY_FILTER, true);
    expect(ids(columns.needs_you)).toEqual(["ask"]);
    expect(ids(columns.working)).toEqual(["run"]);
    expect(ids(columns.done)).toEqual(["fin"]);
    // Opened or too old: Idle. An ended session is on no column.
    expect(ids(columns.idle)).toEqual(["seen", "old"]);
  });

  test("the Idle column is left out unless asked for, and the total follows what is on show", () => {
    const state = activityState(
      [
        { id: "run", status: "running", agoMs: MIN },
        { id: "seen", status: "idle", agoMs: 10 * MIN },
      ],
      base,
    );
    const hidden = activityBoard(state, NOW, NO_ACTIVITY_FILTER, false);
    expect(hidden.columns.idle).toEqual([]);
    expect([hidden.shown, hidden.total]).toEqual([1, 1]);
    const all = activityBoard(state, NOW, NO_ACTIVITY_FILTER, true);
    expect([all.shown, all.total]).toEqual([2, 2]);
  });

  test("newest change first inside a column", () => {
    const state = activityState(
      [
        { id: "a", status: "running", agoMs: 30 * MIN },
        { id: "b", status: "running", agoMs: MIN },
        { id: "c", status: "running", agoMs: 10 * MIN },
      ],
      base,
    );
    expect(ids(activityBoard(state, NOW, NO_ACTIVITY_FILTER, false).columns.working)).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  test("a card carries its pending request only when it can be answered here", () => {
    const state = activityState([{ id: "ask", status: "awaiting_permission", agoMs: MIN }], base);
    const [card] = activityBoard(state, NOW, NO_ACTIVITY_FILTER, false).columns.needs_you;
    expect(card?.pending?.requestId).toBe("r-ask");
    expect(card?.project).toBe("api");
    expect(card?.changedAt).toBe(NOW - MIN);
    const question = activityState(
      [{ id: "q", status: "awaiting_permission", agoMs: MIN, tool: "AskUserQuestion" }],
      base,
    );
    expect(
      activityBoard(question, NOW, NO_ACTIVITY_FILTER, false).columns.needs_you[0]?.pending,
    ).toBeNull();
  });

  test("filters combine: text, host, project and persona, and the count is n of m", () => {
    const state = activityState(
      [
        { id: "one", status: "running", agoMs: MIN, name: "Fix login", cwd: "/work/api" },
        {
          id: "two",
          status: "running",
          agoMs: MIN,
          name: "Write docs",
          cwd: "/work/web",
          persona: { id: "p-rev", name: "Reviewer" },
        },
        {
          id: "three",
          status: "running",
          agoMs: MIN,
          name: "Fix cache",
          cwd: "/work/api",
          host: "h2",
        },
      ],
      base,
    );
    const run = (filter: Partial<typeof NO_ACTIVITY_FILTER>) => {
      const data = activityBoard(state, NOW, { ...NO_ACTIVITY_FILTER, ...filter }, false);
      return [ids(data.columns.working).sort(), data.shown, data.total];
    };
    expect(run({})).toEqual([["one", "three", "two"], 3, 3]);
    expect(run({ text: "fix" })).toEqual([["one", "three"], 2, 3]);
    expect(run({ text: "fix", host: "beta" })).toEqual([["three"], 1, 3]);
    expect(run({ project: "web" })).toEqual([["two"], 1, 3]);
    expect(run({ persona: "p-rev" })).toEqual([["two"], 1, 3]);
    expect(run({ text: "fix", project: "web" })).toEqual([[], 0, 3]);
  });

  test("the options of the filters are the hosts, projects and personas that exist", () => {
    const state = activityState(
      [
        { id: "a", status: "running", agoMs: MIN, cwd: "/work/api" },
        {
          id: "b",
          status: "idle",
          agoMs: MIN,
          cwd: "/work/web",
          host: "h2",
          persona: { id: "p", name: "Reviewer" },
        },
      ],
      base,
    );
    expect(activityOptions(state)).toEqual({
      hosts: ["alfa", "beta"],
      projects: ["api", "web"],
      personas: [{ id: "p", name: "Reviewer" }],
    });
  });
});
