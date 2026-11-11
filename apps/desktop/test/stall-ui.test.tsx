import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { activityState, NOW } from "./activity/fixtures.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { settle } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { CONTINUATION } = await import("../src/features/sessions/index.ts");
const { NeedsYou } = await import("../src/features/needs-you/page.tsx");
const { ActivityBoard } = await import("../src/features/activity/board.tsx");
const { TContext } = await import("../src/i18n/context.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

type Specs = Parameters<typeof activityState>[0];
const SPECS: Specs = [
  { id: "s1", name: "api", status: "running", agoMs: 40 * 60_000, quietMin: 23, quietTool: "Bash" },
  { id: "s2", name: "docs", status: "running", agoMs: 60_000 },
  { id: "s3", name: "web", status: "idle", agoMs: 3_600_000 },
];

function setup(language: "en" | "pt-BR" = "en", specs: Specs = SPECS) {
  const store = new AppStore(memoryPlatform(false, language).platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  store.now = () => NOW;
  const { hosts, hub, unread } = activityState(specs, store.getState());
  (store as unknown as { update(p: object): void }).update({ hosts, hub, unread });
  const sent: Array<[string, string, string?]> = [];
  store.interruptSession = (async (host: string, id: string) => {
    sent.push(["interrupt", `${host}/${id}`]);
  }) as never;
  store.sendTo = (async (host: string, id: string, text: string) => {
    sent.push(["send", `${host}/${id}`, text]);
  }) as never;
  return { store, sent };
}

function page(store: InstanceType<typeof AppStore>, go: (route: unknown) => void = () => {}) {
  const tree = () => (
    <TContext.Provider value={store.i18n.t}>
      <NeedsYou store={store} state={store.getState()} go={go} onOpenRequest={() => {}} />
    </TContext.Provider>
  );
  const shown = render(tree());
  /** The App hands the page the live state; here the test hands it the store's state again. */
  return { refresh: () => shown.rerender(tree()) };
}

const rows = () =>
  [...document.querySelectorAll("section li button")].map((b) => b.textContent ?? "");
const act1 = (fn: () => void) => act(async () => fn());
/** Presses the button of that name; the red is a missing button, not a thrown lookup. */
async function press(name: string | RegExp) {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act1(() => fireEvent.click(button as HTMLElement));
}

describe("stall-ui: a quiet session in Needs you (issue #1478)", () => {
  test("is listed with how long it has been quiet and its last tool, and the others are not", async () => {
    const { store } = setup();
    page(store);
    const [only, ...rest] = rows();
    expect(only ?? "").toContain("alfa · api");
    expect(only ?? "").toContain("Quiet for 23 min · last: Bash");
    expect(rest).toEqual([]);
    expect(document.body.textContent).not.toContain("Nothing is waiting for you.");
  });

  test("choosing it offers Open, Stop the turn, Send continue and Not stuck, and each does its one thing", async () => {
    const { store, sent } = setup();
    const went: unknown[] = [];
    page(store, (route) => went.push(route));
    await press(/alfa · api/);
    expect(document.body.textContent).toContain("Quiet for 23 min · last: Bash");

    await press("Open");
    expect(went).toEqual([{ name: "session", host: "h1", id: "s1" }]);

    await press("Stop the turn");
    await settle(() => sent.length === 1);
    expect(sent).toEqual([["interrupt", "h1/s1"]]);

    await press("Send “continue”");
    await settle(() => sent.length === 2);
    expect(sent[1]).toEqual(["send", "h1/s1", CONTINUATION]);
  });

  test("Not stuck, snooze 1 h takes it off the list and the focus does not fall on the page body", async () => {
    const { store } = setup();
    const view = page(store);
    await press(/alfa · api/);
    await press("Not stuck, snooze 1 h");
    await act1(() => view.refresh());
    await settle(() => document.body.textContent?.includes("Nothing is waiting for you.") === true);
    expect(rows()).toEqual([]);
    expect(store.getState().quietSnooze).toEqual({ "h1/s1": NOW + 60 * 60_000 });
    expect(document.activeElement === document.body).toBe(false);
  });

  test("Stop the turn and Send continue that make the row go also leave the focus on the list, not on the body", async () => {
    for (const name of ["Stop the turn", "Send “continue”"]) {
      cleanup();
      const { store } = setup();
      const view = page(store);
      await press(/alfa · api/);
      await press(name);
      // The host answers by clearing the quiet mark; the test stands in for it with the snooze.
      store.snoozeQuiet("h1", "s1");
      await act1(() => view.refresh());
      await settle(
        () => document.body.textContent?.includes("Nothing is waiting for you.") === true,
      );
      expect(document.activeElement === document.body).toBe(false);
    }
  });

  test("the same row and buttons in Portuguese", async () => {
    const { store } = setup("pt-BR");
    page(store);
    expect(rows()[0] ?? "").toContain("Em silêncio há 23 min · última: Bash");
    await press(/alfa · api/);
    for (const name of ["Abrir", "Parar o turno", "Enviar “continue”", "Não travou, adiar 1 h"]) {
      expect(screen.queryByRole("button", { name })).not.toBeNull();
    }
  });
});

describe("stall-ui: the Working card on the Activity board says it is quiet (issue #1478)", () => {
  function board(language: "en" | "pt-BR" = "en") {
    const { store } = setup(language);
    render(
      <TContext.Provider value={store.i18n.t}>
        <ActivityBoard store={store} go={() => {}} onOpen={() => {}} holdMs={30} tickMs={20} />
      </TContext.Provider>,
    );
    return store;
  }
  const card = (title: string) =>
    document.querySelector(`[data-slot='activity-card'][aria-label='${title}']`);

  test("a quiet session's card carries a badge, and a running one that is not does not", async () => {
    board();
    expect(card("api")?.textContent ?? "").toContain("Quiet 23 min");
    expect(card("docs")).not.toBeNull();
    expect(card("docs")?.textContent).not.toContain("Quiet");
  });

  test("in Portuguese", async () => {
    board("pt-BR");
    expect(card("api")?.textContent ?? "").toContain("Em silêncio 23 min");
  });
});

describe("stall-ui: the Needs you badge counts the quiet rows (issue #1478)", () => {
  test("one quiet session is a 1 on the Needs you entry, and snoozing it takes the 1 away", async () => {
    const { store } = setup();
    const { Sidebar } = await import("../src/ui/Sidebar.tsx");
    const tree = () => (
      <Sidebar
        store={store}
        state={store.getState()}
        collapsed={false}
        t={store.i18n.t}
        go={() => {}}
        onOpenProjectScreen={() => {}}
        onNewSession={() => {}}
        onRemoveHost={() => {}}
        onRenameHost={() => null}
        onOpenSearch={() => {}}
        onNewTab={() => {}}
        onToggleTheme={() => {}}
      />
    );
    const shown = render(tree());
    const entry = () => screen.queryByRole("button", { name: /Needs you/ })?.textContent ?? "";
    expect(entry()).toContain("Needs you1");
    store.snoozeQuiet("h1", "s1");
    await act1(() => shown.rerender(tree()));
    expect(entry()).toBe("Needs you");
  });
});
