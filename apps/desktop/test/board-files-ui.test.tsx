import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { FileListing } from "@flightdeck/protocol";
import { NARROW_SHOTS } from "../../../scripts/lib/shots-narrow.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { settle } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { BoardView } = await import("../src/ui/BoardView.tsx");
// The app gives its screens the language through this context (App.tsx); the panel reads it.
const { TContext } = await import("../src/i18n/context.tsx");

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
  "project:p1": { "": [{ name: "api-readme.md", kind: "file" }] },
  "card:C": {
    "": [
      { name: "src", kind: "dir" },
      { name: "c-readme.md", kind: "file" },
    ],
    src: [{ name: "c-only.ts", kind: "file" }],
  },
};

/** A token's shape, built here so no real-looking key sits in the source. */
const TOKEN = `sk-${"x".repeat(24)}`;
/** A value of the vault (or a host's token): the app knows it, the patterns do not. */
const VAULT = `vault-${"v".repeat(12)}`;

/** What the host finds, by mode and query; anything else finds nothing. */
const SEARCH: Record<string, { matches: object[]; truncated: boolean }> = {
  "name|only": {
    matches: [{ path: "src/b-only.ts" }, { path: ".env.only", secret: true }],
    truncated: false,
  },
  "content|hello": {
    matches: [{ path: "src/b-only.ts", line: 3, text: "const hello = 1;" }],
    truncated: true,
  },
  "content|key": {
    matches: [{ path: "config.ts", line: 2, text: `const key = "${TOKEN}";` }],
    truncated: false,
  },
  // The host never sends a credential's line; if one came anyway, it stays unseen.
  "content|deploy": {
    matches: [{ path: ".env.only", line: 1, text: "DEPLOY=plain-words", secret: true }],
    truncated: false,
  },
  "content|vault": {
    matches: [{ path: "deploy.sh", line: 4, text: `curl -u ${VAULT} https://x` }],
    truncated: false,
  },
};
const NONE = { matches: [], truncated: false };

function setup(options: { language?: "en" | "pt-BR"; features?: string[] } = {}) {
  const searches: string[] = [];
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
    if (type === "file.read") {
      const { path } = payload as { path: string };
      return { ok: true, data: { path, text: "export const only = 1;\n", hash: "h", size: 23 } };
    }
    if (type === "file.search") {
      const { mode, query } = payload as { mode: "name" | "content"; query: string };
      searches.push(`${target}|${mode}|${query}`);
      if (query === "boom") return { ok: false, code: "command_failed", message: "rg failed" };
      return { ok: true, data: { mode, query, ...(SEARCH[`${mode}|${query}`] ?? NONE) } };
    }
    return { ok: true, data: {} };
  }) as never;
  render(
    <TContext.Provider value={store.i18n.t}>
      <BoardView
        store={store}
        hostId="h1"
        projectId="p1"
        onOpenCard={() => {}}
        onOpenSettings={() => {}}
      />
    </TContext.Provider>,
  );
  const pick = (kind: "primary" | "worktree", path: string, branch: string) =>
    act(async () => {
      store.setWorktreeFilter({ hostId: "h1", projectId: "p1", kind, path, branch });
    });
  return { store, pick, searches };
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
  if (!button) throw new Error(`no button named ${name}`);
  await act(async () => {
    fireEvent.click(button);
  });
};

describe("board-files-ui: the files of the picked worktree beside the board (#117)", () => {
  test("a worktree picked in the sidebar shows its files beside the columns, and Files hides them", async () => {
    const { pick } = setup();
    await pick("worktree", "/wt/b", "fd/b");
    await settle(() => shows("Files · fd/b", "b-readme.md"));
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
    await settle(() => shows("Files · fd/b", "src"));
    await press("src");
    await settle(() => shows("Files · fd/b", "b-only.ts"));
    const before = shows("Files · fd/b", "b-only.ts");
    await pick("worktree", "/wt/c", "fd/c");
    await settle(() => shows("Files · fd/c", "c-readme.md"));
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
    await settle(() => shows("Files · main", hint));
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
    await settle(() => shows("Arquivos · fd/b", "b-readme.md"));
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
      await settle(() => shows("Files · fd/b", "b-readme.md"));
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

describe("board-files-ui: search over the whole tree, on a host with file.search (#117, #797)", () => {
  const SEARCHING = ["file.list", "file.search"];
  const type = async (label: string, value: string) => {
    const field = screen.queryByRole("searchbox", { name: label });
    if (!field) throw new Error(`no searchbox named ${label}`);
    await act(async () => {
      fireEvent.change(field, { target: { value } });
    });
  };
  const tab = async (name: string) => {
    const trigger = screen.queryByRole("tab", { name });
    if (!trigger) throw new Error(`no tab named ${name}`);
    await act(async () => {
      fireEvent.mouseDown(trigger);
      fireEvent.click(trigger);
    });
  };

  test("by name it finds files in folders never opened, and a credential's name shows as hidden", async () => {
    const { pick, searches } = setup({ features: SEARCHING });
    await pick("worktree", "/wt/b", "fd/b");
    await settle(() => shows("Files · fd/b", "b-readme.md"));
    await type("Search names", "only");
    await settle(() => shows("Files · fd/b", "src/b-only.ts"));
    const region = panel("Files · fd/b");
    expect({
      found: region
        ? within(region).queryByRole("button", { name: "src/b-only.ts" }) !== null
        : false,
      secret: shows("Files · fd/b", ".env.only") && shows("Files · fd/b", "Hidden"),
      tree: shows("Files · fd/b", "b-readme.md"),
      asked: searches.includes("card:B|name|only"),
    }).toEqual({ found: true, secret: true, tree: false, asked: true });
  });

  test("by content it lists each match as path:line with the line, and says when there are more", async () => {
    const { pick, searches } = setup({ features: SEARCHING });
    await pick("worktree", "/wt/b", "fd/b");
    await settle(() => shows("Files · fd/b", "b-readme.md"));
    await tab("Content");
    await type("Search contents", "hello");
    await settle(() => shows("Files · fd/b", "src/b-only.ts:3"));
    expect({
      place: shows("Files · fd/b", "src/b-only.ts:3"),
      line: shows("Files · fd/b", "const hello = 1;"),
      more: shows("Files · fd/b", "More matches than shown here. Narrow the search."),
      asked: searches.includes("card:B|content|hello"),
    }).toEqual({ place: true, line: true, more: true, asked: true });
  });

  test("a match opens the file in the viewer", async () => {
    const { pick } = setup({ features: SEARCHING });
    await pick("worktree", "/wt/b", "fd/b");
    await settle(() => shows("Files · fd/b", "b-readme.md"));
    await type("Search names", "only");
    await settle(() => shows("Files · fd/b", "src/b-only.ts"));
    const region = panel("Files · fd/b");
    const match = region ? within(region).queryByRole("button", { name: "src/b-only.ts" }) : null;
    if (match) {
      await act(async () => {
        fireEvent.click(match);
      });
    }
    const viewer = () => screen.queryByRole("region", { name: "File src/b-only.ts" }) !== null;
    await settle(viewer);
    expect(viewer()).toBe(true);
  });

  // #827 (review of #823): a match's line goes through the app's secret masker (the fix of #830).
  test("a content match never shows a token: its line is masked", async () => {
    const { pick } = setup({ features: SEARCHING });
    await pick("worktree", "/wt/b", "fd/b");
    await settle(() => shows("Files · fd/b", "b-readme.md"));
    await tab("Content");
    await type("Search contents", "key");
    await settle(() => shows("Files · fd/b", "config.ts:2"));
    const text = panel("Files · fd/b")?.textContent ?? "";
    expect({
      place: text.includes("config.ts:2"),
      masked: text.includes("[redacted]"),
      token: text.includes(TOKEN),
    }).toEqual({ place: true, masked: true, token: false });
  });

  // A credential's line never shows at all: this held before #830, through the `secret` flag.
  test("a credential's content match shows its place, never its line", async () => {
    const { pick } = setup({ features: SEARCHING });
    await pick("worktree", "/wt/b", "fd/b");
    await settle(() => shows("Files · fd/b", "b-readme.md"));
    await tab("Content");
    await type("Search contents", "deploy");
    await settle(() => shows("Files · fd/b", ".env.only:1"));
    const text = panel("Files · fd/b")?.textContent ?? "";
    expect({ place: text.includes(".env.only:1"), line: text.includes("plain-words") }).toEqual({
      place: true,
      line: false,
    });
  });

  // Security review of #827: the masker also knows the vault's values and the hosts' tokens.
  test("a content match never shows a value of the vault or a host's token", async () => {
    const { store, pick } = setup({ features: SEARCHING });
    store.scanValues = () => [VAULT];
    await pick("worktree", "/wt/b", "fd/b");
    await settle(() => shows("Files · fd/b", "b-readme.md"));
    await tab("Content");
    await type("Search contents", "vault");
    await settle(() => shows("Files · fd/b", "deploy.sh:4"));
    const text = panel("Files · fd/b")?.textContent ?? "";
    expect({
      place: text.includes("deploy.sh:4"),
      masked: text.includes("[redacted]"),
      value: text.includes(VAULT),
    }).toEqual({ place: true, masked: true, value: false });
  });

  test("nothing found says so; a search the host refuses says why", async () => {
    const { pick } = setup({ features: SEARCHING });
    await pick("worktree", "/wt/b", "fd/b");
    await settle(() => shows("Files · fd/b", "b-readme.md"));
    await type("Search names", "zzz");
    await settle(() => shows("Files · fd/b", "Nothing found."));
    const none = shows("Files · fd/b", "Nothing found.");
    await type("Search names", "boom");
    await settle(() => (panel("Files · fd/b")?.querySelector("[role=alert]") ?? null) !== null);
    expect({
      none,
      refused: (panel("Files · fd/b")?.querySelector("[role=alert]") ?? null) !== null,
    }).toEqual({ none: true, refused: true });
  });

  test("the main checkout shows the project's own files", async () => {
    const { pick } = setup({ features: SEARCHING });
    await pick("primary", "/x/api", "main");
    await settle(() => shows("Files · main", "api-readme.md"));
    expect({
      files: shows("Files · main", "api-readme.md"),
      hint: shows("Files · main", "Files show for a worktree. Pick one in the sidebar."),
    }).toEqual({ files: true, hint: false });
  });

  test("em português, as abas e a busca por nome", async () => {
    const { pick, searches } = setup({ features: SEARCHING, language: "pt-BR" });
    await pick("worktree", "/wt/b", "fd/b");
    await settle(() => shows("Arquivos · fd/b", "b-readme.md"));
    const tabs = ["Nomes", "Conteúdo"].map((name) => screen.queryByRole("tab", { name }) !== null);
    await type("Buscar nomes", "only");
    await settle(() => searches.includes("card:B|name|only"));
    expect({ tabs, asked: searches.includes("card:B|name|only") }).toEqual({
      tabs: [true, true],
      asked: true,
    });
  });
});
