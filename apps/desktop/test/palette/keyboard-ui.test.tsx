import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { GlobalSearch } = await import("../../src/features/palette/ui.ts");

setDefaultTimeout(30_000);
afterEach(cleanup);

const live = (id: string) => ({
  id,
  name: `sessao-${id}`,
  cwd: `/work/api/${id}`,
  status: "idle",
  pendingPermissions: [],
  updatedAt: "2026-11-04T10:00:00Z",
});

const hit = (uuid: string) => ({
  hostId: "h1",
  hostName: "alfa",
  claudeSessionId: `s-${uuid}`,
  uuid,
  ts: "2026-11-04T10:00:00Z",
  cwd: "/work/api",
  title: null,
  role: "user",
  snippet: `a «${uuid}» in a message`,
  cursor: `c-${uuid}`,
});

const manyCards = Object.fromEntries(
  Array.from({ length: 30 }, (_, i) => [
    `h1/m${i}`,
    { id: `m${i}`, projectId: "p-api", title: `Card ${String(i).padStart(2, "0")}` },
  ]),
);

/** The palette over one host, with the history search's state when `search` is given. */
function open(over: Record<string, unknown> = {}, route?: object, recents: string[] = []) {
  const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  store.palette.load = (async () => {}) as never;
  store.palette.recents = () => recents;
  if (route) store.router.push(route as never);
  const state = {
    ...store.getState(),
    hosts: [
      {
        id: "h1",
        name: "alfa",
        url: "ws://x",
        token: "",
        status: "online",
        info: null,
        hostInfo: { daemonVersion: "x", features: ["issues"] },
        incompatibility: null,
        daemonUpdate: null,
        sessions: [live("a"), live("b")],
      },
    ],
    projects: {
      h1: [{ id: "p-api", name: "api", path: "/work/api", baseBranch: "main", issues: null }],
    },
    ...over,
  } as never as ReturnType<typeof store.getState>;
  const opened: string[] = [];
  render(
    <GlobalSearch
      state={state}
      store={store}
      costs={true}
      onSearch={() => {}}
      onClose={() => {}}
      onOpenHit={(h) => void opened.push(h.uuid)}
      onGo={() => {}}
    />,
  );
  return { opened };
}

const input = () => screen.getByLabelText("Search the history") as HTMLInputElement;
/** The palette's rows: the options of every list but the history hits. */
const options = () =>
  within(screen.getByRole("dialog"))
    .queryAllByRole("option")
    .filter((o) => o.closest("[role=listbox]")?.getAttribute("aria-label") !== "Search results");
const chosen = () => options().find((o) => o.getAttribute("aria-selected") === "true");
const type = (text: string) =>
  act(async () => {
    fireEvent.change(input(), { target: { value: text } });
  });
/** Returns whether the browser would still run the key's default (focus moves on Tab). */
const key = async (k: string): Promise<boolean> => {
  let kept = true;
  await act(async () => {
    kept = fireEvent.keyDown(input(), { key: k });
  });
  return kept;
};
/** The arrows go past every row of the lists (the query always offers some) onto hit number `n`. */
const toHit = async (n: number) => {
  for (let i = 0; i < options().length + n; i++) await key("ArrowDown");
};
const search = (...uuids: string[]) => ({
  query: "zzzz",
  hits: uuids.map(hit),
  waiting: [],
  silent: [],
});

describe("palette-keyboard: the history hits are in the arrow walk (#3887)", () => {
  test("ArrowDown reaches the first hit and Enter opens it", async () => {
    const { opened } = open({ search: search("u1", "u2") });
    await toHit(1);
    await key("Enter");
    expect(opened).toEqual(["u1"]);
  });

  test("the walk goes on to the next hit, and the chosen one is marked and named by the input", async () => {
    const { opened } = open({ search: search("u1", "u2") });
    await toHit(2);
    const results = within(screen.getByRole("listbox", { name: "Search results" }));
    const [first, second] = results.getAllByRole("option") as HTMLElement[];
    expect({
      chosen: [first?.getAttribute("aria-selected"), second?.getAttribute("aria-selected")],
      named: input().getAttribute("aria-activedescendant") === second?.id && second?.id !== "",
    }).toEqual({ chosen: ["false", "true"], named: true });
    await key("Enter");
    expect(opened).toEqual(["u2"]);
  });

  test("the hits are options of a listbox like the rows, and none is selected before an arrow", () => {
    open({ search: search("u1", "u2") });
    const box = screen.queryByRole("listbox", { name: "Search results" });
    const options = within(box as HTMLElement).queryAllByRole("option");
    expect({
      box: box !== null,
      count: options.length,
      selected: options.map((o) => o.getAttribute("aria-selected")),
      listItems: within(box as HTMLElement).queryAllByRole("listitem").length,
    }).toEqual({ box: true, count: 2, selected: ["false", "false"], listItems: 0 });
  });

  test("a hit is chosen with the arrows, not by Tab: it is out of the tab order", () => {
    open({ search: search("u1") });
    const results = within(screen.getByRole("listbox", { name: "Search results" }));
    expect(results.getAllByRole("option").map((b) => b.tabIndex)).toEqual([-1]);
  });
});

describe("palette-keyboard: an entry in two sections is two stops (#3887)", () => {
  /** The rows and the more buttons, in the order the page shows them: what the arrows must walk. */
  const walk = () =>
    Array.from(
      screen
        .getByRole("dialog")
        .querySelectorAll<HTMLElement>('[role="option"], button[aria-current], button'),
    ).filter((el) => el.getAttribute("role") === "option" || /\bmore$/.test(el.textContent ?? ""));
  const marked = (el: HTMLElement) =>
    el.getAttribute("aria-selected") === "true" || el.getAttribute("aria-current") === "true";

  test("each arrow chooses the next row in page order, and every row has its own id", async () => {
    open({}, undefined, ["session:h1/a", "session:h1/b"]);
    const stops = walk();
    const chosenAfter: number[] = [];
    for (let i = 0; i < stops.length; i++) {
      await key("ArrowDown");
      chosenAfter.push(walk().findIndex(marked));
    }
    expect({
      unique: new Set(stops.map((el) => el.id)).size === stops.length,
      chosenAfter,
    }).toEqual({ unique: true, chosenAfter: stops.map((_, i) => i) });
  });
});

describe("palette-keyboard: the more row is in the arrow walk (#3887)", () => {
  test("ArrowDown past the eighth row reaches '22 more'; Enter shows more and keeps the walk on the first new row", async () => {
    open({ cards: manyCards });
    await type("card");
    for (let i = 0; i < 9; i++) await key("ArrowDown");
    const more = screen.getByRole("button", { name: "22 more" });
    expect({
      current: more.getAttribute("aria-current"),
      named: input().getAttribute("aria-activedescendant") === more.id && more.id !== "",
      tabIndex: more.tabIndex,
    }).toEqual({ current: "true", named: true, tabIndex: -1 });
    await key("Enter");
    expect({
      rows: options().length,
      on: chosen()?.getAttribute("aria-label"),
    }).toEqual({ rows: 28, on: "Card 08" });
  });
});

describe("palette-keyboard: the scope chips are reached by Tab (#3887)", () => {
  const onBoard = { name: "board", host: "h1", projectId: "p-api" };

  test("with chips and no row chosen, Tab leaves the input for them", async () => {
    open({}, onBoard);
    expect(await key("Tab")).toBe(true);
  });

  test("with no chips there is nowhere to go: Tab stays in the palette", async () => {
    open();
    expect(await key("Tab")).toBe(false);
  });

  test("with a row chosen Tab is still the actions toggle, and never moves the focus", async () => {
    open({}, onBoard);
    await key("ArrowDown");
    expect(await key("Tab")).toBe(false);
  });

  test("with a more button chosen Tab still leaves for the chips: it has no actions to show", async () => {
    open({ cards: manyCards }, onBoard);
    await type("card");
    for (let i = 0; i < 9; i++) await key("ArrowDown");
    expect(await key("Tab")).toBe(true);
  });

  test("the rows are out of the tab order, so Tab goes from the input to the chips", () => {
    open({ cards: manyCards }, onBoard);
    expect(options().map((o) => o.tabIndex)).toEqual(options().map(() => -1));
  });
});

describe("palette-keyboard: the input is a combobox over the lists (#3887)", () => {
  test("it has the combobox role", () => {
    open();
    expect(input().getAttribute("role")).toBe("combobox");
  });

  test("it says it is expanded and controls every list of the palette", () => {
    open({ search: search("u1") });
    const lists = screen.getAllByRole("listbox");
    expect(lists.some((l) => l.getAttribute("aria-label") === "Search results")).toBe(true);
    expect({
      expanded: input().getAttribute("aria-expanded"),
      controls: (input().getAttribute("aria-controls") ?? "").split(" ").sort(),
    }).toEqual({ expanded: "true", controls: lists.map((l) => l.id).sort() });
  });

  test("aria-activedescendant is the chosen option, and none before an arrow is pressed", async () => {
    open();
    expect(input().hasAttribute("aria-activedescendant")).toBe(false);
    await key("ArrowDown");
    const option = chosen();
    expect(input().getAttribute("aria-activedescendant")).toBe(option?.id ?? null);
    expect(option?.id).not.toBe("");
  });

  test("an option keeps its label as its name and is described by its host and path", async () => {
    open();
    await type("sessao-a");
    const option = screen.getByRole("option", { name: "sessao-a" });
    const described = (option.getAttribute("aria-describedby") ?? "")
      .split(" ")
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ");
    expect(described).toContain("/work/api/a");
  });
});
