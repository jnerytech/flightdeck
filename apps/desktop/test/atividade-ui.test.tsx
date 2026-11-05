import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { formatAgo } from "../src/i18n/format.ts";
import type { HubRow } from "../src/lib/hub.ts";
import { ROUTE_NAMES } from "../src/lib/router.ts";
import { shortcutOf } from "../src/lib/shortcuts.ts";
import { activityState, HOUR, MIN, NOW } from "./activity-fixtures.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { settle } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { ActivityBoard } = await import("../src/ui/ActivityBoard.tsx");
const { Sidebar } = await import("../src/ui/Sidebar.tsx");
const { TContext } = await import("../src/i18n/context.tsx");
const { breadcrumb } = await import("../src/lib/breadcrumb.ts");

setDefaultTimeout(30_000);
afterEach(cleanup);

type Specs = Parameters<typeof activityState>[0];

function setup(_specs: Specs, options: { language?: "en" | "pt-BR"; platform?: never } = {}) {
  const mem = memoryPlatform(false, options.language ?? "en");
  const store = new AppStore(mem.platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  store.now = () => NOW;
  const responded: Array<[string, string, string]> = [];
  store.respondTo = (async (hostId: string, requestId: string, decision: string) => {
    responded.push([hostId, requestId, decision]);
  }) as never;
  const opened: Array<[string, boolean]> = [];
  const make = (next: Specs) => activityState(next, store.getState());
  const view = (next: Specs) => (
    <TContext.Provider value={store.i18n.t}>
      <ActivityBoard
        store={store}
        state={make(next)}
        go={() => {}}
        onOpen={(row: HubRow, newTab: boolean) => void opened.push([row.title, newTab])}
        holdMs={30}
      />
    </TContext.Provider>
  );
  return { store, mem, responded, opened, view };
}

const SPECS: Specs = [
  {
    id: "ask",
    name: "Fix login",
    status: "awaiting_permission",
    agoMs: 5 * MIN,
    request: "Fix the login bug",
  },
  {
    id: "run",
    name: "Write docs",
    status: "running",
    agoMs: MIN,
    cwd: "/work/web",
    persona: { id: "p", name: "Reviewer" },
  },
  { id: "fin", name: "Tidy up", status: "idle", agoMs: 10 * MIN, unread: true, host: "h2" },
  { id: "seen", name: "Old chat", status: "idle", agoMs: 40 * MIN },
];
/** The names of the columns on the board, left to right (the page itself is a region too). */
const columnNames = () =>
  [...document.querySelectorAll("[data-slot='activity-column']")].map((el) =>
    el.getAttribute("aria-label"),
  );
const column = (name: string) => screen.getByRole("region", { name });
const cardsOf = (name: string) =>
  [...column(name).querySelectorAll("[data-slot='activity-card']")].map(
    (el) => el.getAttribute("aria-label") ?? "",
  );

describe("atividade-ui: the Activity board (issue #151)", () => {
  test("three columns by default, in order, each with a count; Idle waits for its switch", async () => {
    const w = setup(SPECS);
    render(w.view(SPECS));
    expect(columnNames()).toEqual(["Needs you", "Working", "Done"]);
    expect(cardsOf("Needs you")).toEqual(["Fix login"]);
    expect(cardsOf("Working")).toEqual(["Write docs"]);
    expect(cardsOf("Done")).toEqual(["Tidy up"]);
    expect(within(column("Working")).getByText("1")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox", { name: "Show idle sessions" }));
    });
    expect(cardsOf("Idle")).toEqual(["Old chat"]);
  });

  test("the Idle choice is kept across starts", async () => {
    const w = setup(SPECS);
    render(w.view(SPECS));
    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox", { name: "Show idle sessions" }));
    });
    cleanup();
    const again = new AppStore(w.mem.platform, { baseDelayMs: 600_000 });
    again.i18n.start();
    again.now = () => NOW;
    render(
      <TContext.Provider value={again.i18n.t}>
        <ActivityBoard
          store={again}
          state={activityState(SPECS, again.getState())}
          go={() => {}}
          onOpen={() => {}}
        />
      </TContext.Provider>,
    );
    expect(cardsOf("Idle")).toEqual(["Old chat"]);
  });

  test("a card says the session, its host, project, persona, last request and age; an empty column says None", () => {
    const w = setup(SPECS);
    render(w.view(SPECS));
    const ask = within(column("Needs you")).getByLabelText("Fix login");
    expect(ask.textContent).toContain("alfa");
    expect(ask.textContent).toContain("api");
    expect(ask.textContent).toContain("Fix the login bug");
    expect(ask.textContent).toContain(formatAgo(5 * MIN, w.store.i18n.t));
    const run = within(column("Working")).getByLabelText("Write docs");
    expect(run.textContent).toContain("Reviewer");
    expect(run.textContent).toContain("web");
    cleanup();
    const quiet = setup([{ id: "x", status: "running", agoMs: MIN }]);
    render(quiet.view([{ id: "x", status: "running", agoMs: MIN }]));
    expect(within(column("Needs you")).getByText("None")).toBeTruthy();
    expect(within(column("Done")).getByText("None")).toBeTruthy();
  });

  test("a click opens the session; Ctrl-click and the middle button open it in a tab", async () => {
    const w = setup(SPECS);
    render(w.view(SPECS));
    const open = () => within(column("Working")).getByRole("button", { name: "Write docs" });
    await act(async () => {
      fireEvent.click(open());
      fireEvent.click(open(), { ctrlKey: true });
      fireEvent(open(), new window.MouseEvent("auxclick", { button: 1, bubbles: true }));
    });
    expect(w.opened).toEqual([
      ["Write docs", false],
      ["Write docs", true],
      ["Write docs", true],
    ]);
  });

  test("Approve and Deny answer the request from the card", async () => {
    const w = setup(SPECS);
    render(w.view(SPECS));
    await act(async () => {
      fireEvent.click(within(column("Needs you")).getByRole("button", { name: "Approve" }));
    });
    await act(async () => {
      fireEvent.click(within(column("Needs you")).getByRole("button", { name: "Deny" }));
    });
    expect(w.responded).toEqual([
      ["h1", "r-ask", "allow"],
      ["h1", "r-ask", "deny"],
    ]);
  });

  test("a high-risk request is approved only by holding the button", async () => {
    const specs: Specs = [{ id: "ask", status: "awaiting_permission", agoMs: MIN, risk: "high" }];
    const w = setup(specs);
    render(w.view(specs));
    expect(within(column("Needs you")).queryByRole("button", { name: "Approve" })).toBeNull();
    const hold = within(column("Needs you")).getByRole("button", { name: "Hold to approve" });
    await act(async () => {
      fireEvent.click(hold);
    });
    expect(w.responded).toEqual([]);
    await act(async () => {
      fireEvent.pointerDown(hold);
    });
    await settle(() => w.responded.length === 1);
    expect(w.responded[0]).toEqual(["h1", "r-ask", "allow"]);
  });

  test("a question for the person has no Approve: only the session to open", () => {
    const specs: Specs = [
      { id: "q", status: "awaiting_permission", agoMs: MIN, tool: "AskUserQuestion" },
    ];
    const w = setup(specs);
    render(w.view(specs));
    expect(within(column("Needs you")).queryByRole("button", { name: "Approve" })).toBeNull();
  });

  test("filters combine and the count says n of m shown", async () => {
    const w = setup(SPECS);
    render(w.view(SPECS));
    expect(screen.getByText("3 of 3 shown")).toBeTruthy();
    await act(async () => {
      fireEvent.change(screen.getByRole("searchbox", { name: "Search sessions" }), {
        target: { value: "fix" },
      });
    });
    expect(screen.getByText("1 of 3 shown")).toBeTruthy();
    expect(cardsOf("Working")).toEqual([]);
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Host"), { target: { value: "beta" } });
    });
    expect(screen.getByText("0 of 3 shown")).toBeTruthy();
    expect(within(column("Needs you")).getByText("None")).toBeTruthy();
  });

  test("it reads in Portuguese", () => {
    const w = setup(SPECS, { language: "pt-BR" });
    render(w.view(SPECS));
    expect(columnNames()).toEqual(["Precisa de você", "Trabalhando", "Concluídas"]);
  });
});

describe("atividade-ui: cards move with a view transition when the browser has one", () => {
  const fake = () => {
    const calls: number[] = [];
    (document as unknown as { startViewTransition: unknown }).startViewTransition = (
      update: () => void,
    ) => {
      calls.push(1);
      update();
      return { finished: Promise.resolve() };
    };
    return calls;
  };
  const quiet = (reduce: boolean) => {
    (window as unknown as { matchMedia: unknown }).matchMedia = (query: string) => ({
      matches: reduce && query.includes("prefers-reduced-motion"),
      addEventListener() {},
      removeEventListener() {},
    });
  };
  afterEach(() => {
    delete (document as unknown as { startViewTransition?: unknown }).startViewTransition;
  });

  test("a card that changes column starts one; the first draw and the same state do not", async () => {
    quiet(false);
    const calls = fake();
    const before: Specs = [{ id: "a", status: "running", agoMs: MIN }];
    const after: Specs = [{ id: "a", status: "awaiting_permission", agoMs: MIN }];
    const w = setup(before);
    const view = render(w.view(before));
    expect(calls).toHaveLength(0);
    view.rerender(w.view(before));
    expect(calls).toHaveLength(0);
    view.rerender(w.view(after));
    await settle(() => within(column("Needs you")).queryByLabelText("a") !== null);
    expect(calls).toHaveLength(1);
  });

  test("with reduced motion the card just moves", async () => {
    quiet(true);
    const calls = fake();
    const before: Specs = [{ id: "a", status: "running", agoMs: MIN }];
    const after: Specs = [{ id: "a", status: "awaiting_permission", agoMs: MIN }];
    const w = setup(before);
    const view = render(w.view(before));
    view.rerender(w.view(after));
    await settle(() => within(column("Needs you")).queryByLabelText("a") !== null);
    expect(calls).toHaveLength(0);
  });
});

describe("atividade-ui: the screen is reachable (issue #151)", () => {
  test("a route, a shortcut g a, a breadcrumb and a sidebar item", async () => {
    expect(ROUTE_NAMES.has("activity")).toBe(true);
    expect(shortcutOf("go-activity" as never)?.keys).toEqual(["g", "a"]);
    const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 600_000 });
    store.i18n.start();
    expect(
      breadcrumb({ name: "activity" } as never, store.getState(), store.i18n.t).at(-1)?.label,
    ).toBe("Activity");
    const went: unknown[] = [];
    const state = activityState([{ id: "a", status: "running", agoMs: HOUR }], store.getState());
    render(
      <Sidebar
        store={store}
        state={state}
        collapsed={false}
        t={store.i18n.t}
        go={(route) => void went.push(route)}
        onOpenProjectScreen={() => {}}
        onNewSession={() => {}}
        onRemoveHost={() => {}}
        onRenameHost={() => null}
        onOpenSearch={() => {}}
        onNewTab={() => {}}
        onToggleTheme={() => {}}
      />,
    );
    // The grouped sidebar (Observability) is not on this base: the item sits after Costs.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Activity" }));
    });
    expect(went).toEqual([{ name: "activity" }]);
  });
});
