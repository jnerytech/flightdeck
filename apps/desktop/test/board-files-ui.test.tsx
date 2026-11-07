import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { FileListing } from "@flightdeck/protocol";
import { NARROW_SHOTS } from "../../../scripts/lib/shots-narrow.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { settleMaybe } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { BoardView } = await import("../src/ui/BoardView.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

const card = (id: string, worktreePath: string | null, branch: string | null) => ({
  id,
  projectId: "p1",
  title: id,
  description: "",
  column: "in_progress",
  position: 1,
  createdAt: "2026-11-07T10:00:00Z",
  waitingOn: [],
  blocking: [],
  branch,
  worktreePath,
  sessionId: null,
  sessionStatus: null,
  queued: false,
});

/** Each worktree's folders: both have `src`, with a file of their own inside. */
const TREES: Record<string, Record<string, FileListing["entries"]>> = {
  "card:B": {
    "": [
      { name: "src", kind: "dir" },
      { name: "b-readme.md", kind: "file" },
    ],
    src: [{ name: "b-only.ts", kind: "file" }],
  },
  "card:C": {
    "": [
      { name: "src", kind: "dir" },
      { name: "c-readme.md", kind: "file" },
    ],
    src: [{ name: "c-only.ts", kind: "file" }],
  },
};

function setup(options: { language?: "en" | "pt-BR"; features?: string[] } = {}) {
  const store = new AppStore(memoryPlatform(false, options.language ?? "en").platform, {
    baseDelayMs: 600_000,
  });
  store.i18n.start();
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
        hostInfo: { daemonVersion: "x", features: options.features ?? ["file.list"] },
        incompatibility: null,
        daemonUpdate: null,
        sessions: [],
      },
    ],
    projects: { h1: [{ id: "p1", name: "api", path: "/x/api" }] },
    cards: {
      "h1/A": card("A", null, null),
      "h1/B": card("B", "/wt/b", "fd/b"),
      "h1/C": card("C", "/wt/c", "fd/c"),
    },
  });
  store.hostCommand = (async (_hostId: string, type: string) =>
    type === "board.get" ? { project: { id: "p1", name: "api" }, cards: [] } : {}) as never;
  store.hostRequest = (async (_hostId: string, type: string, payload: unknown) => {
    const { target, dir } = payload as { target: string; dir: string };
    if (type === "changes.get") return { ok: true, data: { root: "/wt", files: [] } };
    if (type === "file.list") {
      const entries = TREES[target]?.[dir] ?? [];
      return { ok: true, data: { dir, entries, truncated: false } };
    }
    return { ok: true, data: {} };
  }) as never;
  render(
    <BoardView
      store={store}
      hostId="h1"
      projectId="p1"
      onOpenCard={() => {}}
      onOpenSettings={() => {}}
    />,
  );
  const pick = (kind: "primary" | "worktree", path: string, branch: string) =>
    act(async () => {
      store.setWorktreeFilter({ hostId: "h1", projectId: "p1", kind, path, branch });
    });
  return { store, pick };
}

/** A ResizeObserver whose callbacks the test fires with the width it wants. */
function fakeResizeObserver() {
  const saved = globalThis.ResizeObserver;
  const observers: Array<(width: number) => void> = [];
  globalThis.ResizeObserver = class {
    constructor(callback: ResizeObserverCallback) {
      observers.push((width) =>
        callback([{ contentRect: { width } } as ResizeObserverEntry], this as ResizeObserver),
      );
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  return {
    resize: (width: number) =>
      act(async () => {
        for (const fire of observers) fire(width);
      }),
    restore: () => {
      globalThis.ResizeObserver = saved;
    },
  };
}

const panel = (name: string) => screen.queryByRole("complementary", { name });
const shows = (name: string, text: string) => {
  const region = panel(name);
  return region !== null && within(region).queryByText(text) !== null;
};
const press = async (name: string) => {
  const button = screen.queryByRole("button", { name });
  if (!button) return;
  await act(async () => {
    fireEvent.click(button);
  });
};

describe("board-files-ui: the files of the picked worktree beside the board (#117)", () => {
  test("a worktree picked in the sidebar shows its files beside the columns, and Files hides them", async () => {
    const { pick } = setup();
    await pick("worktree", "/wt/b", "fd/b");
    await settleMaybe(() => shows("Files · fd/b", "b-readme.md"));
    const shown = shows("Files · fd/b", "b-readme.md");
    const pressed = screen.queryByRole("button", { name: "Files" })?.getAttribute("aria-pressed");
    await press("Files");
    expect({ shown, pressed, hidden: panel("Files · fd/b") === null }).toEqual({
      shown: true,
      pressed: "true",
      hidden: true,
    });
  });

  test("another worktree shows its own files, never the folders the last one had open", async () => {
    const { pick } = setup();
    await pick("worktree", "/wt/b", "fd/b");
    await settleMaybe(() => shows("Files · fd/b", "src"));
    await press("src");
    await settleMaybe(() => shows("Files · fd/b", "b-only.ts"));
    const before = shows("Files · fd/b", "b-only.ts");
    await pick("worktree", "/wt/c", "fd/c");
    await settleMaybe(() => shows("Files · fd/c", "c-readme.md"));
    expect({
      before,
      own: shows("Files · fd/c", "c-readme.md"),
      stale: shows("Files · fd/c", "b-only.ts"),
    }).toEqual({ before: true, own: true, stale: false });
  });

  test("the main checkout has no files yet: the panel says to pick a worktree", async () => {
    const { pick } = setup();
    await pick("primary", "/x/api", "main");
    const hint = "Files show for a worktree. Pick one in the sidebar.";
    await settleMaybe(() => shows("Files · main", hint));
    expect(shows("Files · main", hint)).toBe(true);
  });

  test("nothing picked, or a host without file.list: no panel and no Files button", async () => {
    setup();
    const none = {
      panel: screen.queryAllByRole("complementary").length,
      button: screen.queryByRole("button", { name: "Files" }) !== null,
    };
    cleanup();
    const { pick } = setup({ features: [] });
    await pick("worktree", "/wt/b", "fd/b");
    expect({
      none,
      without: {
        panel: screen.queryAllByRole("complementary").length,
        button: screen.queryByRole("button", { name: "Files" }) !== null,
      },
    }).toEqual({ none: { panel: 0, button: false }, without: { panel: 0, button: false } });
  });

  test("em português", async () => {
    const { pick } = setup({ language: "pt-BR" });
    await pick("worktree", "/wt/b", "fd/b");
    await settleMaybe(() => shows("Arquivos · fd/b", "b-readme.md"));
    expect({
      shown: shows("Arquivos · fd/b", "b-readme.md"),
      button: screen.queryByRole("button", { name: "Arquivos" }) !== null,
    }).toEqual({ shown: true, button: true });
  });

  // A narrow board has no room for both: picking a worktree keeps the columns, and Files swaps
  // the panel in for them (the #117 design), so a stacked panel is never squeezed to a strip.
  test("in a narrow board the panel waits for Files, then takes the columns' place", async () => {
    const ro = fakeResizeObserver();
    try {
      const { pick } = setup();
      await ro.resize(700);
      await pick("worktree", "/wt/b", "fd/b");
      const files = () => screen.queryByRole("button", { name: "Files" });
      const columns = () => screen.queryByRole("region", { name: "In progress" }) !== null;
      const picked = {
        panel: panel("Files · fd/b") !== null,
        pressed: files()?.getAttribute("aria-pressed") ?? null,
        columns: columns(),
      };
      await press("Files");
      await settleMaybe(() => shows("Files · fd/b", "b-readme.md"));
      const opened = { panel: shows("Files · fd/b", "b-readme.md"), columns: columns() };
      await press("Files");
      expect({
        picked,
        opened,
        closed: { panel: panel("Files · fd/b") !== null, columns: columns() },
      }).toEqual({
        picked: { panel: false, pressed: "false", columns: true },
        opened: { panel: true, columns: false },
        closed: { panel: false, columns: true },
      });
    } finally {
      ro.restore();
    }
  });

  // The prints check the panel's contrast and overflow (#98, #103) at every narrow size too.
  test("the prints measure the board with its files at the narrow sizes", () => {
    expect(NARROW_SHOTS.includes("board-arquivos")).toBe(true);
  });
});
