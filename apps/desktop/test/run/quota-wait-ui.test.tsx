import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { WorkflowRun } from "@flightdeck/protocol";
import { registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";
import { settle } from "../wait.ts";

registerDom();
const { act, cleanup, render, screen } = await import("@testing-library/react");
const { AppStore, sessionKey } = await import("../../src/lib/app-store.ts");
const { TContext } = await import("../../src/i18n/context.tsx");
const { CardDetail } = await import("../../src/features/board/card-detail.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

/**
 * #1003: the card's run view says until when a workflow waits for the quota, in the store's clock.
 * It reads the run the store holds for the card, so the test seeds the store (the daemon sets
 * `quotaUntil` from the quota's reset: test/quota/queue.test.ts) instead of starting a daemon, a
 * git repo and the whole app for one line.
 */
const card = {
  id: "c1",
  projectId: "p1",
  title: "Cota",
  description: "",
  column: "in_progress",
  columnLocked: false,
  position: 1,
  slug: "cota",
  branch: "fd/cota",
  worktreePath: null,
  prUrl: null,
  prState: null,
  checksState: null,
  queued: false,
  sessionId: null,
  sessionStatus: null,
  notice: null,
  discarded: false,
  runs: [],
  workflowRunId: "r1",
  arenaOf: null,
  variant: null,
  arenaVariants: 0,
  issueRef: null,
  issueExternal: false,
  queueReason: null,
  quotaUntil: null,
  createdAt: "2030-01-01T17:00:00.000Z",
  updatedAt: "2030-01-01T17:00:00.000Z",
};

const waitingRun = (over: Partial<WorkflowRun> = {}): WorkflowRun =>
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

async function openCard(run: WorkflowRun, language: "pt-BR" | "en") {
  const store = new AppStore(memoryPlatform(false, language).platform, {
    baseDelayMs: 600_000,
    formatTime: (iso) => new Date(iso).toISOString().slice(11, 16),
  });
  store.i18n.start();
  store.hostCommand = (async () => null) as never;
  store.hostRequest = (async () => ({ ok: false, error: { code: "x", message: "x" } })) as never;
  await act(async () => {
    (store as unknown as { update(patch: object): void }).update({
      cards: { [sessionKey("h1", "c1")]: card },
      runs: { [sessionKey("h1", "r1")]: run },
    });
  });
  render(
    <TContext.Provider value={store.i18n.t}>
      <CardDetail
        store={store}
        hostId="h1"
        cardId="c1"
        onOpenSettings={() => {}}
        onOpenWorkflows={() => {}}
        onBack={() => {}}
        onOpenCard={() => {}}
      />
    </TContext.Provider>,
  );
}

const runNotice = () =>
  screen.queryByRole("region", { name: /Execução do workflow|Workflow run/ })?.textContent ?? "";

describe("run-quota-wait-ui: a workflow waiting for the quota (#1003)", () => {
  test("the card's run says until when it waits, in HH:MM from the store's clock", async () => {
    await openCard(waitingRun(), "pt-BR");
    await settle(() => runNotice().includes("aguardando cota até"));
    expect(runNotice()).toContain("aguardando cota até 18:45");
  });

  test("the same line in English", async () => {
    await openCard(waitingRun(), "en");
    await settle(() => runNotice().includes("waiting for the quota until"));
    expect(runNotice()).toContain("waiting for the quota until 18:45");
  });

  test("a run that does not wait for the quota shows its own reason, not a time", async () => {
    await openCard(waitingRun({ quotaUntil: null, statusReason: "check failed" }), "en");
    await settle(() => runNotice().includes("check failed"));
    expect(runNotice()).not.toContain("waiting for the quota until");
  });
});
