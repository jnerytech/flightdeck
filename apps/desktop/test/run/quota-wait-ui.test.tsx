import { afterEach, describe, expect, test } from "bun:test";
import type { WorkflowRun } from "@flightdeck/protocol";
import { registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";

registerDom();
const { cleanup, render, screen } = await import("@testing-library/react");
const { AppStore } = await import("../../src/lib/app-store.ts");
const { TContext } = await import("../../src/i18n/context.tsx");
const { RunTimeline } = await import("../../src/features/runenv/run-timeline.tsx");

afterEach(cleanup);

/**
 * #1003: the run view says until when a workflow waits for the quota, in the person's clock. It
 * reads the run it is given, so the test hands it one (the daemon sets `quotaUntil` from the
 * quota's reset: test/quota/queue.test.ts) instead of starting a daemon and a git repo for it.
 */
const waitingRun = (over: Partial<WorkflowRun> = {}) =>
  ({
    id: "r1",
    cardId: "c1",
    workflowName: "wf",
    workflowHash: "h",
    status: "running",
    statusReason: "aguardando cota",
    reasonKey: null,
    reasonParams: null,
    budget: {},
    usage: { turns: 1, minutes: 1, costUsd: 0.1 },
    inputs: {},
    startedAt: "2030-01-01T17:00:00.000Z",
    endedAt: null,
    steps: [],
    quotaUntil: new Date(Date.UTC(2030, 0, 1, 18, 45)).toISOString(),
    ...over,
  }) as WorkflowRun;

function viewOf(run: WorkflowRun, language: "pt-BR" | "en") {
  const store = new AppStore(memoryPlatform(false, language).platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  return (
    <TContext.Provider value={store.i18n.t}>
      <RunTimeline
        run={run}
        formatTime={(iso) => new Date(iso).toISOString().slice(11, 16)}
        onOpenStep={() => {}}
      />
    </TContext.Provider>
  );
}

const notice = () => screen.queryByRole("status")?.textContent ?? "";

describe("run-quota-wait-ui: a workflow waiting for the quota (#1003)", () => {
  test("the run says until when it waits, in HH:MM", () => {
    render(viewOf(waitingRun(), "pt-BR"));
    expect(notice()).toBe("aguardando cota até 18:45");
  });

  test("the same line in English", () => {
    render(viewOf(waitingRun(), "en"));
    expect(notice()).toBe("waiting for the quota until 18:45");
  });

  test("a run that does not wait for the quota shows its own reason, not a time", () => {
    render(viewOf(waitingRun({ quotaUntil: null, statusReason: "check failed" }), "en"));
    expect(notice()).toBe("check failed");
  });
});
