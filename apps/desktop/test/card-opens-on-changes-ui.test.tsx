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

async function open(first: object) {
  const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  store.hostCommand = (async () => null) as never;
  store.hostRequest = (async () => ({ ok: false, error: { code: "x", message: "x" } })) as never;
  const put = (over: object) =>
    act(async () => {
      (store as unknown as { update(patch: object): void }).update({
        cards: { [sessionKey("h1", "c1")]: card(over) },
      });
    });
  render(
    <TContext.Provider value={store.i18n.t}>
      <CardDetail
        store={store}
        hostId="h1"
        cardId="c1"
        onOpenSettings={() => {}}
        onBack={() => {}}
        onOpenCard={() => {}}
      />
    </TContext.Provider>,
  );
  await put(first);
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
