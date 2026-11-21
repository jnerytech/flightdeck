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

/** The history of a host whose list holds no session; `automated` runs are hidden by the filter. */
async function emptyHistory(automated: number) {
  const store = new AppStore(memoryPlatform(false, "en").platform);
  await store.i18n.setLang("en");
  const asked: unknown[] = [];
  store.history.list = (async (_host: string, filter: unknown) => {
    asked.push(filter);
    return { sessions: [], automatedCount: automated, nextCursor: null };
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

describe("history-filters: one Show them at a time (#588)", () => {
  test("when the empty list already offers Show them, the filter row does not repeat it or the count", async () => {
    await emptyHistory(95);
    const sentence = en.historyUi.emptyAutomated.replace("{count}", "95");
    await settle(() => (document.body.textContent ?? "").includes(sentence));
    const short = en.historyUi.automatedHidden.replace("{count}", "95");
    expect({
      buttons: screen.queryAllByRole("button", { name: en.historyUi.showAutomated }).length,
      short: (document.body.textContent ?? "").includes(short),
    }).toEqual({ buttons: 1, short: false });
  });
});

/** The form that holds the filter fields, or null when they sit outside one. */
function filterForm(): HTMLFormElement | null {
  return (screen.queryByLabelText(en.historyUi.folder) as HTMLElement).closest("form");
}

/** Enter in a field, as the browser does it: the form submits. */
async function submitFilters() {
  const form = filterForm();
  expect(form).not.toBeNull();
  await act(async () => {
    fireEvent.submit(form as HTMLFormElement);
  });
}

async function typeInto(label: string, value: string) {
  await act(async () => {
    fireEvent.change(screen.queryByLabelText(label) as HTMLElement, { target: { value } });
  });
}

// #3636: the filters were loose fields with a button, so Enter did nothing, a change of origin
// waited for the button, the folder box was too narrow for a path and a reversed period said nothing.
describe("history-filters: the filters are a form (#3636)", () => {
  test("Enter in a field applies the filters: the fields are one form with Filter as its submit", async () => {
    const { asked } = await emptyHistory(0);
    await typeInto(en.historyUi.folder, "web");
    await submitFilters();
    await settle(() => asked.some((filter) => (filter as { cwd?: string }).cwd === "web"));
    expect(
      (screen.queryByRole("button", { name: en.historyUi.filter }) as HTMLButtonElement).type,
    ).toBe("submit");
  });

  test("a change of Origin applies at once, without the button", async () => {
    const { asked } = await emptyHistory(0);
    await typeInto(en.historyUi.origin, "external");
    await settle(() =>
      asked.some((filter) => (filter as { origin?: string }).origin === "external"),
    );
    expect(asked.length).toBeGreaterThan(1);
  });

  test("From after To is said on the To field and the host is not asked", async () => {
    const { asked } = await emptyHistory(0);
    await settle(() => asked.length === 1);
    await typeInto(en.historyUi.from, "2026-11-10");
    await typeInto(en.historyUi.to, "2026-11-01");
    await submitFilters();
    expect({
      error: (document.body.textContent ?? "").includes(en.historyUi.periodReversed),
      invalid: screen.queryByLabelText(en.historyUi.to)?.getAttribute("aria-invalid"),
      asked: asked.length,
    }).toEqual({ error: true, invalid: "true", asked: 1 });
  });

  test("the error goes when a date is corrected", async () => {
    await emptyHistory(0);
    await typeInto(en.historyUi.from, "2026-11-10");
    await typeInto(en.historyUi.to, "2026-11-01");
    await submitFilters();
    await typeInto(en.historyUi.to, "2026-11-12");
    expect((document.body.textContent ?? "").includes(en.historyUi.periodReversed)).toBe(false);
  });

  test("the Folder field says what it matches and is wider than a short box", async () => {
    await emptyHistory(0);
    const folder = screen.queryByLabelText(en.historyUi.folder) as HTMLElement;
    const help = document.getElementById(folder.getAttribute("aria-describedby") ?? "");
    expect({ help: help?.textContent, narrow: folder.className.includes("w-32") }).toEqual({
      help: en.historyUi.folderHelp,
      narrow: false,
    });
  });
});
