import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { ExternalSession } from "@flightdeck/protocol";
import { activityBoard, NO_ACTIVITY_FILTER } from "../../src/features/activity/activity.ts";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";
import { activityState, NOW } from "./fixtures.ts";

registerDom();
const { cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { ActivityBoard } = await import("../../src/features/activity/board.tsx");
const { TContext } = await import("../../src/i18n/context.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

/**
 * Issue #1751: the Activity card of a terminal session at a plan approval shows the plan, so the
 * person decides whether to go to the terminal without opening the session.
 */
const external = (over: Partial<ExternalSession>): ExternalSession => ({
  claudeSessionId: "c1",
  cwd: "/w/app",
  transcriptPath: null,
  source: null,
  status: "idle",
  statusReason: null,
  launchId: null,
  controllable: false,
  projectKey: null,
  startedAt: "2026-11-05T11:00:00Z",
  lastEventAt: "2026-11-05T11:57:00Z",
  endedAt: null,
  ...over,
});

const PLAN = "1. Ler o código ✅\n2. Escrever o teste";

function board(session: ExternalSession) {
  const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  store.now = () => NOW;
  const { hosts, hub, unread } = activityState([], store.getState());
  const externals = { "h1/c1": session };
  (store as unknown as { update(patch: object): void }).update({ hosts, hub, unread, externals });
  return store;
}

describe("activity-plan-text: a terminal plan wait shows its plan on the card (#1751)", () => {
  test("the card's row carries the plan the daemon sent", () => {
    const state = {
      ...activityState([], new AppStore(memoryPlatform(false, "en").platform).getState()),
      externals: { "h1/c1": external({ waiting: "plan", waitingPlan: PLAN }) },
    };
    const { columns } = activityBoard(state, NOW, NO_ACTIVITY_FILTER, false);
    expect(columns.needs_you.map((card) => card.row.waitingPlan)).toEqual([PLAN]);
  });

  test("the card shows the plan text, line breaks and emoji kept", () => {
    const store = board(external({ waiting: "plan", waitingPlan: PLAN }));
    render(
      <TContext.Provider value={store.i18n.t}>
        <ActivityBoard store={store} go={() => {}} onOpen={() => {}} holdMs={30} tickMs={20} />
      </TContext.Provider>,
    );
    const plan = document.querySelector("[data-slot='activity-card-plan']");
    expect(plan?.textContent).toBe(PLAN);
    expect(screen.queryAllByText(/Ler o código/).length).toBe(1); // NOSONAR: a failed length check on DOM elements prints each node
  });

  test("a card with no plan text, or a question, shows no plan block", () => {
    for (const session of [
      external({ waiting: "plan" }),
      external({ waiting: "question" }),
      external({ waiting: null, waitingPlan: PLAN }),
    ]) {
      const store = board(session);
      const view = render(
        <TContext.Provider value={store.i18n.t}>
          <ActivityBoard store={store} go={() => {}} onOpen={() => {}} holdMs={30} tickMs={20} />
        </TContext.Provider>,
      );
      expect(document.querySelectorAll("[data-slot='activity-card-plan']").length).toBe(0); // NOSONAR: a failed length check on DOM elements prints each node
      view.unmount();
    }
  });
});
