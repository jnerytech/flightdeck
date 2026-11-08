import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { settle } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore, sessionKey } = await import("../src/lib/app-store.ts");
const { TContext } = await import("../src/i18n/context.tsx");
const { CardDetail } = await import("../src/ui/CardDetail.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

const card = (over: object = {}) =>
  ({
    id: "c1",
    projectId: "p1",
    title: "Cart screen",
    description: "",
    column: "in_progress",
    columnLocked: false,
    position: 1,
    slug: "cart",
    branch: "fd/cart",
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
    workflowRunId: null,
    arenaOf: null,
    variant: null,
    arenaVariants: 0,
    issueRef: null,
    issueExternal: false,
    queueReason: null,
    quotaUntil: null,
    createdAt: "2026-11-08T12:00:00.000Z",
    updatedAt: "2026-11-08T12:00:00.000Z",
    ...over,
  }) as never;

const run = (steps: object[]) =>
  ({
    id: "r1",
    cardId: "c1",
    workflowName: "ship",
    workflowHash: "h",
    status: "waiting",
    statusReason: null,
    budget: {},
    usage: { turns: 0, minutes: 0, costUsd: 0 },
    inputs: {},
    startedAt: "2026-11-08T12:00:00.000Z",
    endedAt: null,
    steps,
    quotaUntil: null,
  }) as never;
const gate = (status: string) => ({
  stepId: "approve",
  attempt: 1,
  type: "gate",
  status,
  message: "Ship it?",
  output: null,
  sessionId: null,
  usage: null,
  startedAt: "2026-11-08T12:01:00.000Z",
  endedAt: null,
});

async function open(first: object, before = false, runSteps?: object[]) {
  const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  store.hostCommand = (async () => null) as never;
  store.hostRequest = (async () => ({ ok: false, error: { code: "x", message: "x" } })) as never;
  const put = (over: object) =>
    act(async () => {
      (store as unknown as { update(patch: object): void }).update({
        cards: { [sessionKey("h1", "c1")]: card(over) },
        ...(runSteps ? { runs: { [sessionKey("h1", "r1")]: run(runSteps) } } : {}),
      });
    });
  // A card the store already has is there on the first render: the page opens on its tab at once.
  if (before) await put(first);
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
  if (!before) await put(first);
  return { put };
}

const pressed = (name: string) =>
  screen.queryByRole("button", { name })?.getAttribute("aria-pressed") ?? null;
const FINISHED = { worktreePath: "/w", sessionId: "s1", sessionStatus: "ended" };

describe("card-opens-on-changes-ui: a finished run opens on its changes (#1197)", () => {
  test("a card with a finished run and no PR opens on Changes", async () => {
    await open(FINISHED);
    await settle(() => pressed("Conversation") !== null);
    expect([pressed("Changes"), pressed("Conversation")]).toEqual(["true", "false"]);
  });

  test("a card the store already has opens on Changes at its first paint, with no flash of the conversation", async () => {
    await open(FINISHED, true);
    expect([pressed("Changes"), pressed("Conversation")]).toEqual(["true", "false"]);
  });

  test("a card that never started, or is running, opens on the conversation", async () => {
    await open({});
    await settle(() => pressed("Conversation") !== null);
    expect([pressed("Changes"), pressed("Conversation")]).toEqual(["false", "true"]);
    cleanup();
    await open({ ...FINISHED, sessionStatus: "running" });
    await settle(() => pressed("Conversation") !== null);
    expect([pressed("Changes"), pressed("Conversation")]).toEqual(["false", "true"]);
  });

  test("a card with a PR opens on the conversation", async () => {
    await open({ ...FINISHED, prUrl: "https://x/pr/1", prState: "open" });
    await settle(() => pressed("Conversation") !== null);
    expect(pressed("Conversation")).toBe("true");
  });

  test("the person's own choice stays when the card is updated", async () => {
    const { put } = await open(FINISHED);
    await settle(() => pressed("Conversation") !== null);
    expect(pressed("Changes")).toBe("true");
    await act(async () => {
      fireEvent.click(screen.queryByRole("button", { name: "Conversation" }) as HTMLElement);
    });
    expect(pressed("Conversation")).toBe("true");
    await put({ ...FINISHED, updatedAt: "2026-11-08T12:05:00.000Z" });
    expect([pressed("Changes"), pressed("Conversation")]).toEqual(["false", "true"]);
  });
});

describe("card-opens-on-changes-ui: a gate waiting is the card's one primary (#1269)", () => {
  const names = () =>
    Array.from(document.querySelectorAll('[data-slot="card-run"] button')).map(
      (el) => el.getAttribute("aria-label") ?? el.textContent?.trim() ?? "",
    );
  const asked = { ...FINISHED, workflowRunId: "r1" };

  test("with a gate waiting, the run panel leads with nothing and the gate has Approve", async () => {
    await open(asked, true, [gate("waiting")]);
    await settle(() => pressed("Conversation") !== null);
    expect(screen.queryByRole("button", { name: "Open PR" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Review changes" })).toBeNull();
    expect(names()).toEqual(["Actions for Cart screen"]);
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeNull();
  });

  test("once the gate is answered, the run panel leads with Open PR again", async () => {
    await open(asked, true, [gate("approved")]);
    await settle(() => pressed("Conversation") !== null);
    expect(names()).toEqual(["Open PR", "Actions for Cart screen"]);
  });
});
