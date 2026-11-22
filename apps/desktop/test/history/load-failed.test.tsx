import { afterEach, describe, expect, test } from "bun:test";
import { en } from "../../src/i18n/en.ts";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";
import { waiter } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { HistoryList } = await import("../../src/features/history/history-list.tsx");
const { TContext } = await import("../../src/i18n/context.tsx");

afterEach(cleanup);
const settle = waiter(3000);

const SESSION = {
  claudeSessionId: "s-1",
  title: "Review the build",
  cwd: "/home/ana/app",
  lastTs: "2026-09-01T10:00:00.000Z",
  origin: "flightdeck",
  maybeActive: false,
  automated: false,
};
const LIST = { sessions: [SESSION], automatedCount: 0, nextCursor: null };

/** A history whose reads answer in turn: a list, or `null` for a refused read (as the store does). */
async function history(answers: Array<typeof LIST | null>) {
  const store = new AppStore(memoryPlatform(false, "en").platform);
  await store.i18n.setLang("en");
  const asked: unknown[] = [];
  store.history.list = (async (_host: string, filter: unknown) => {
    asked.push(filter);
    return answers.length > 1 ? answers.shift() : answers[0];
  }) as unknown as typeof store.history.list;
  render(
    <TContext.Provider value={store.i18n.t}>
      <HistoryList
        store={store}
        hostId="h"
        hostName="alfa"
        density="compact"
        openId={null}
        onOpen={() => {}}
      />
    </TContext.Provider>,
  );
  return { asked };
}

/** Lets the pending reads answer and the screen draw, so an assertion reads the result, not a wait. */
const flush = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
const text = () => document.body.textContent ?? "";
const tryAgain = () => screen.queryByRole("button", { name: "Try again" });
const listShown = () => screen.queryByRole("list", { name: en.historyUi.list }) !== null;

/** Types a folder and submits the filter form with its button. */
async function filterByFolder(folder: string) {
  const field = screen.queryByLabelText(en.historyUi.folder) as HTMLInputElement;
  await act(async () => {
    fireEvent.change(field, { target: { value: folder } });
  });
  const apply = screen.queryByRole("button", { name: en.historyUi.filter });
  await act(async () => {
    fireEvent.click(apply as HTMLElement);
  });
}

// Issue #3965: a refused read showed the loading skeleton for ever, and a filter change that was
// refused left the old list on screen as if it were the filtered one.
describe("history-load-failed: a refused read says so and can be tried again", () => {
  test("a refused first read shows what happened and Try again, then the list when it works", async () => {
    const { asked } = await history([null, LIST]);
    await settle(() => asked.length === 1);
    await flush();
    expect(text()).toContain("Could not read the history.");
    expect(tryAgain()).not.toBeNull();
    await act(async () => {
      fireEvent.click(tryAgain() as HTMLElement);
    });
    await settle(() => asked.length === 2);
    await flush();
    expect(listShown()).toBe(true);
    expect(text()).not.toContain("Could not read the history.");
  });

  test("a filter change drops the old list, and a refused read after it shows the error", async () => {
    const { asked } = await history([LIST, null]);
    await settle(listShown);
    await filterByFolder("/home/ana/other");
    await settle(() => asked.length === 2);
    await flush();
    expect(listShown()).toBe(false);
    expect(tryAgain()).not.toBeNull();
  });

  test("a filter change whose read works shows the new list", async () => {
    const { asked } = await history([LIST, { ...LIST, sessions: [{ ...SESSION, title: "Other" }] }]);
    await settle(listShown);
    await filterByFolder("/home/ana/other");
    await settle(() => text().includes("Other"));
    expect(asked).toHaveLength(2);
    expect(text()).not.toContain("Could not read the history.");
  });
});
