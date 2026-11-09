import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { settle } from "./wait.ts";

registerDom();
const { act, cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { BoardView } = await import("../src/ui/BoardView.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

/**
 * #1553 (the #1478 spec): a card whose session says nothing wears a Quiet badge on the board, with
 * the Hourglass icon, "Quiet 23 min" as words and the row's full status line as its name. It is not
 * a button, and a snoozed session does not show it.
 */
const NOW = Date.parse("2026-11-09T12:30:00.000Z");
const MIN = 60_000;
const ago = (minutes: number) => new Date(NOW - minutes * MIN).toISOString();

const card = (id: string, sessionId: string | null, over: object = {}) => ({
  id,
  projectId: "p1",
  title: id,
  description: "",
  column: "in_progress",
  position: 1,
  createdAt: "2026-11-04T10:00:00Z",
  waitingOn: [],
  blocking: [],
  branch: null,
  worktreePath: null,
  sessionId,
  sessionStatus: "running",
  queued: false,
  ...over,
});
const session = (id: string, over: object = {}) => ({
  id,
  name: id,
  cwd: "/w",
  status: "running",
  pendingPermissions: [],
  updatedAt: ago(40),
  ...over,
});

function setup(language: "en" | "pt-BR" = "en") {
  const store = new AppStore(memoryPlatform(false, language).platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  store.now = () => NOW;
  const internals = store as unknown as { update(p: object): void };
  internals.update({
    hosts: [
      {
        id: "h1",
        name: "alfa",
        url: "ws://x",
        token: "",
        status: "online",
        info: null,
        hostInfo: { daemonVersion: "x", features: [] },
        incompatibility: null,
        daemonUpdate: null,
        sessions: [
          session("Q", { quietSince: ago(23), quietTool: "Bash" }),
          session("Busy"),
          // A stale mark on a session that is no longer running.
          session("Idle", { status: "idle", quietSince: ago(50) }),
        ],
      },
    ],
    cards: Object.fromEntries(
      [
        card("Quiet one", "Q"),
        card("Working", "Busy"),
        card("Finished", "Idle", { sessionStatus: "idle" }),
        card("Plain", null, { sessionStatus: null, column: "backlog" }),
      ].map((c) => [`h1/${c.id}`, c]),
    ),
  });
  const project = { id: "p1", name: "api", path: "/p1", projectKey: "git:acme/api" };
  store.loadBoard = (async () => {}) as never;
  store.hostCommand = (async (_host: string, type: string) => {
    if (type === "board.get") return { project, cards: [] };
    if (type === "project.list") return { projects: [project], maxParallelRuns: 3 };
    if (type === "workflow.list") return { workflows: [] };
    return {};
  }) as never;
  store.hostRequest = (async () => ({ ok: true, data: {} })) as never;
  render(
    <BoardView
      store={store}
      hostId="h1"
      projectId="p1"
      onOpenCard={() => {}}
      onOpenSettings={() => {}}
    />,
  );
  return store;
}

const tile = (title: string) => screen.queryByLabelText(`Card ${title}`) as HTMLElement | null;
const ready = () => settle(() => tile("Working") !== null);
const wearing = (title: string) =>
  [...(tile(title)?.querySelectorAll("[data-slot='badge']") ?? [])]
    .map((badge) => (badge.textContent ?? "").replace(/\s+/g, " ").trim())
    .filter((text) => text.includes("Quiet") || text.includes("silêncio"));

describe("board-quiet-badge-ui: a card whose session says nothing wears the Quiet badge (#1553)", () => {
  test("the quiet card has it, as words with the full line as the name; the others do not", async () => {
    setup();
    await ready();
    expect(wearing("Quiet one")).toEqual(["Quiet 23 min Quiet for 23 min · last: Bash"]);
    // The words show; the full line is what a screen reader reads, in the same badge.
    const badge = tile("Quiet one")?.querySelector("[data-slot='badge']");
    const hidden = badge?.querySelector("[aria-hidden='true']:not(svg)")?.textContent;
    const spoken = badge?.querySelector(".sr-only")?.textContent;
    expect([hidden, spoken]).toEqual(["Quiet 23 min", "Quiet for 23 min · last: Bash"]);
    expect(wearing("Working")).toEqual([]);
    expect(wearing("Finished")).toEqual([]);
    expect(wearing("Plain")).toEqual([]);
  });

  test("it is a badge with an icon, not a button", async () => {
    setup();
    await ready();
    const badge = tile("Quiet one")?.querySelector("[data-slot='badge']");
    expect(badge?.querySelector("svg") !== null).toBe(true);
    expect(badge?.closest("button") === null).toBe(true);
    expect(badge?.tagName === "BUTTON").toBe(false);
  });

  test("Not stuck hides it with the row, and the same badge reads in Portuguese", async () => {
    const store = setup("pt-BR");
    await ready();
    expect(wearing("Quiet one")).toEqual([
      "Em silêncio 23 min Em silêncio há 23 min · última: Bash",
    ]);
    await act(async () => store.snoozeQuiet("h1", "Q"));
    await settle(() => wearing("Quiet one").length === 0);
    expect(wearing("Quiet one")).toEqual([]);
  });
});
