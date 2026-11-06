import { afterEach, describe, expect, test } from "bun:test";
import { en } from "../src/i18n/en.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { waiter } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { HistoryList } = await import("../src/ui/HistoryList.tsx");
const { TContext } = await import("../src/i18n/context.tsx");

afterEach(cleanup);
const settle = waiter(3000);

/** The history of a host whose list holds no session; `automated` runs are hidden by the filter. */
async function emptyHistory(automated: number) {
  const store = new AppStore(memoryPlatform(false, "en").platform);
  await store.i18n.setLang("en");
  const asked: unknown[] = [];
  store.historyList = (async (_host: string, filter: unknown) => {
    asked.push(filter);
    return { sessions: [], automatedCount: automated, nextCursor: null };
  }) as unknown as typeof store.historyList;
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
  return { store, asked };
}

/** The visible `<label>` tied to a control found by its name, or why there is none. */
function visibleLabel(name: string): string {
  const control = screen.queryByLabelText(name);
  if (!control) return `no control named "${name}"`;
  const label = control.id ? document.querySelector(`label[for="${control.id}"]`) : null;
  return label?.textContent ?? `"${name}" has no visible label`;
}

// Issue #180: the two dates had no visible label (which is from, which is to?), the folder only a
// placeholder, and the empty state said "No sessions in the history" next to "95 hidden".
describe("history-filters: the filters say what they are, and an empty list says why", () => {
  test("Folder, From, To and Origin have visible labels", async () => {
    await emptyHistory(0);
    for (const name of [
      en.historyUi.folder,
      en.historyUi.from,
      en.historyUi.to,
      en.historyUi.origin,
    ]) {
      expect(visibleLabel(name)).toBe(name);
    }
  });

  test("a list emptied by the hidden automated runs says so, and Show them shows them", async () => {
    const { asked } = await emptyHistory(95);
    const sentence = en.historyUi.emptyAutomated.replace("{count}", "95");
    await settle(() => (document.body.textContent ?? "").includes(sentence));
    expect(document.body.textContent ?? "").not.toContain(en.states.emptyHistory);
    const show = screen.queryAllByRole("button", { name: en.historyUi.showAutomated });
    expect(show.length).toBeGreaterThan(0);
    await act(async () => {
      fireEvent.click(show.at(-1) as HTMLElement);
    });
    await settle(() =>
      asked.some((filter) => (filter as { hideAutomated?: boolean }).hideAutomated === false),
    );
  });

  test("a list emptied by the filters says so and offers to clear them", async () => {
    const { asked } = await emptyHistory(0);
    await act(async () => {
      fireEvent.change(screen.queryByLabelText(en.historyUi.folder) as HTMLElement, {
        target: { value: "web" },
      });
    });
    await act(async () => {
      fireEvent.click(screen.queryByRole("button", { name: en.historyUi.filter }) as HTMLElement);
    });
    await settle(() => asked.length >= 2);
    await settle(() => (document.body.textContent ?? "").includes(en.historyUi.emptyFiltered));
    const clear = screen.queryByRole("button", { name: en.historyUi.clearFilters });
    expect(clear).not.toBeNull();
    await act(async () => {
      fireEvent.click(clear as HTMLElement);
    });
    expect((screen.queryByLabelText(en.historyUi.folder) as HTMLInputElement).value).toBe("");
  });
});
