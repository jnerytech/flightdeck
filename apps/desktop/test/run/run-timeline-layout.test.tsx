import { afterEach, describe, expect, jest, test } from "bun:test";
import type { StepRun, WorkflowRun } from "@flightdeck/protocol";
import type { T } from "../../src/i18n/index.ts";
import { registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";

registerDom();
const { act, cleanup, render, screen } = await import("@testing-library/react");
const { AppStore } = await import("../../src/lib/app-store.ts");
const { TContext } = await import("../../src/i18n/context.tsx");
const { RunTimeline } = await import("../../src/features/runenv/run-timeline.tsx");
const { stepDuration } = await import("../../src/features/runenv/domain/runs.ts");

afterEach(cleanup);

const START = "2026-11-08T10:00:00.000Z";
const at = (seconds: number) => new Date(Date.parse(START) + seconds * 1000);

const step = (over: Partial<StepRun>): StepRun => ({
  stepId: "check-the-migration-for-the-orders-table",
  attempt: 1,
  type: "check",
  status: "running",
  sessionId: null,
  output: null,
  exitCode: null,
  note: null,
  message: null,
  usage: null,
  startedAt: START,
  endedAt: null,
  ...over,
});
const run = (steps: StepRun[]): WorkflowRun =>
  ({
    id: "r1",
    cardId: "c1",
    workflowName: "feature",
    workflowHash: "h",
    status: "running",
    statusReason: null,
    reasonKey: null,
    reasonParams: null,
    budget: {},
    usage: { turns: 0, minutes: 0, costUsd: 0 },
    inputs: {},
    startedAt: START,
    endedAt: null,
    steps,
    quotaUntil: null,
  }) as WorkflowRun;

async function timeline(lang: "en" | "pt-BR", steps: StepRun[]) {
  const store = new AppStore(memoryPlatform(false, lang).platform);
  await store.i18n.setLang(lang);
  render(
    <TContext.Provider value={store.i18n.t}>
      <RunTimeline run={run(steps)} onOpenStep={() => {}} formatTime={String} />
    </TContext.Provider>,
  );
  return store;
}

describe("a step line of the run timeline wraps inside the window (#4286)", () => {
  test.each(["en", "pt-BR"] as const)(
    "a step that opens its output is one button that wraps and reads from the left, in %s",
    async (lang) => {
      await timeline(lang, [step({})]);
      const button = screen.queryAllByRole("button")[0];
      const classes = (button?.className ?? "").split(/\s+/);
      expect({
        wraps: classes.includes("whitespace-normal"),
        grows: classes.includes("h-auto"),
        left: classes.includes("text-left"),
        count: screen.queryAllByRole("button").length,
      }).toEqual({ wraps: true, grows: true, left: true, count: 1 });
    },
  );
});

describe("the time of a running step moves (#4286)", () => {
  const shown = () => screen.queryAllByRole("button")[0]?.textContent ?? "";

  test("it advances each second while a step has no end", async () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(at(5));
      await timeline("en", [step({})]);
      expect(shown().includes("· 5 s")).toBe(true);
      await act(async () => {
        // Advancing the timers moves the fake clock by the same second.
        jest.setSystemTime(at(7));
        jest.advanceTimersByTime(1000);
      });
      expect(shown().includes("· 8 s")).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  test("no one-second timer runs when every step has ended", async () => {
    const every = (ms: number) => spy.mock.calls.filter((call) => call[1] === ms).length;
    const spy = jest.spyOn(globalThis, "setInterval");
    try {
      await timeline("en", [step({ status: "completed", endedAt: at(2).toISOString() })]);
      const idle = every(1000);
      cleanup();
      await timeline("en", [step({})]);
      expect({ idle, running: every(1000) }).toEqual({ idle: 0, running: 1 });
    } finally {
      spy.mockRestore();
    }
  });
});

describe("the units of a step's time come from the dictionary (#4286)", () => {
  // A translator that names the key it was asked for, so a literal unit shows.
  const named = ((key: string, params?: Record<string, unknown>) =>
    `${key}:${params?.n}`) as unknown as T;
  const timed = stepDuration as unknown as (step: StepRun, now: number, t: typeof named) => string;
  const long = (seconds: number) => step({ endedAt: at(seconds).toISOString() });

  test("seconds and minutes are keys with the count", () => {
    expect([
      timed(long(5), 0, named),
      timed(long(59), 0, named),
      timed(long(120), 0, named),
    ]).toEqual(["runUi.durationSeconds:5", "runUi.durationSeconds:59", "runUi.durationMinutes:2"]);
  });

  test("the keys exist in both languages", async () => {
    const store = await timeline("pt-BR", []);
    expect([
      store.i18n.t("runUi.durationSeconds" as never, { n: 5 }),
      store.i18n.t("runUi.durationMinutes" as never, { n: 2 }),
    ]).toEqual(["5 s", "2 min"]);
  });
});
