import { afterEach, describe, expect, test } from "bun:test";
import { translator } from "../src/i18n/index.ts";
import type { ProjectCard } from "../src/lib/project-cards.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { TContext } = await import("../src/i18n/context.tsx");
const { BoardLanding } = await import("../src/components/projects/board-landing.tsx");

afterEach(cleanup);

const NONE = { backlog: 0, in_progress: 0, waiting: 0, review: 0, done: 0 };

const project = (name: string, over: Partial<ProjectCard> = {}): ProjectCard => ({
  hostId: "h1",
  hostName: "alfa",
  projectId: `p-${name}`,
  name,
  path: `/work/${name}`,
  branch: "main",
  projectKey: `k-${name}`,
  liveSessions: 0,
  inProgress: 0,
  needsYou: 0,
  lastActivity: null,
  costWeekUsd: null,
  columns: NONE,
  ...over,
});

function setup(cards: ProjectCard[]) {
  const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  const opened: string[] = [];
  render(
    <TContext.Provider value={translator("en")}>
      <BoardLanding
        store={store}
        hostId="h1"
        cards={cards}
        onOpenBoard={(id) => opened.push(id)}
        onAdded={() => {}}
      />
    </TContext.Provider>,
  );
  return { opened };
}

const boards = () =>
  screen
    .queryAllByRole("button")
    .filter((b) => /^Open the board of /.test(b.getAttribute("aria-label") ?? ""));
const described = (button: Element | undefined) =>
  document.getElementById(button?.getAttribute("aria-describedby") ?? "")?.textContent ?? "";

// Issue #669: the Board screen of a host was one text link per project. It is a grid of project
// cards now: each card opens its board and says what the board holds.
describe("board-landing: the Board screen of a host is a grid of project cards", () => {
  test("each project is one button that opens its board and is described by its counts", () => {
    const { opened } = setup([
      project("api", {
        columns: { backlog: 4, in_progress: 2, waiting: 1, review: 0, done: 9 },
        liveSessions: 2,
        needsYou: 1,
      }),
      project("docs"),
    ]);
    const [api, docs] = boards();
    if (api) fireEvent.click(api);
    expect({
      names: boards().map((b) => b.getAttribute("aria-label")),
      inGrid: api?.closest("ul")?.className.includes("card-grid") ?? false,
      // Read as a screen reader hears it: the parts apart, and the sessions that need you not
      // confused with the board's "Needs you" column.
      api: [
        "Backlog 4, In progress 2, Needs you 1, Done 9.",
        "2 live sessions, 1 session needs you.",
      ].filter((part) => !described(api).includes(part)),
      docs: [described(docs).includes("No cards yet."), described(docs).includes("need you")],
      opened,
    }).toEqual({
      names: ["Open the board of api", "Open the board of docs"],
      inGrid: true,
      api: [],
      docs: [true, false],
      opened: ["p-api"],
    });
  });

  test("the path and branch are shown muted, with the full text on hover", () => {
    setup([project("api", { path: "/a/very/long/path/to/the/api", branch: "develop" })]);
    const path = boards()[0]?.querySelector("[data-slot='board-card-path']");
    expect({
      text: path?.textContent ?? null,
      title: path?.getAttribute("title") ?? null,
    }).toEqual({
      text: "/a/very/long/path/to/the/api · develop",
      title: "/a/very/long/path/to/the/api · develop",
    });
  });

  test("the ones that need you come first, then the latest activity", () => {
    setup([
      project("quiet"),
      project("recent", { lastActivity: "2026-11-05T00:00:00Z" }),
      project("asks", { needsYou: 2, lastActivity: "2026-10-01T00:00:00Z" }),
    ]);
    expect(boards().map((b) => b.getAttribute("aria-label"))).toEqual([
      "Open the board of asks",
      "Open the board of recent",
      "Open the board of quiet",
    ]);
  });

  test("the arrows move the focus between the cards", () => {
    setup([project("a"), project("b"), project("c")]);
    const [a, b] = boards();
    a?.focus();
    if (a) fireEvent.keyDown(a, { key: "ArrowRight" });
    const afterRight = document.activeElement === b;
    if (b) fireEvent.keyDown(b, { key: "Home" });
    expect({ afterRight, home: a !== undefined && document.activeElement === a }).toEqual({
      afterRight: true,
      home: true,
    });
  });

  test("more than six projects bring a filter box; six or fewer do not", () => {
    setup(["a", "b", "c", "d", "e", "f"].map((n) => project(n)));
    const six = screen.queryByRole("textbox", { name: "Filter projects" }) !== null;
    cleanup();
    setup(["api", "web", "docs", "cli", "app", "site", "infra"].map((n) => project(n)));
    const box = screen.queryByRole("textbox", { name: "Filter projects" });
    if (box) fireEvent.change(box, { target: { value: "WEB" } });
    const shown = boards().map((b) => b.getAttribute("aria-label"));
    if (box) fireEvent.change(box, { target: { value: "nothing" } });
    expect({
      six,
      seven: box !== null,
      shown,
      none: screen.queryByText("No project matches the filter.") !== null,
    }).toEqual({ six: false, seven: true, shown: ["Open the board of web"], none: true });
  });

  test("a host with no project offers Add project, with one line on what a board is", async () => {
    setup([]);
    await act(async () => {});
    expect({
      add: screen.queryByRole("button", { name: "Add project" }) !== null,
      line:
        screen.queryByText(
          "A board holds a project's cards, from the backlog to done, and the sessions that work on them.",
        ) !== null,
    }).toEqual({ add: true, line: true });
  });
});
