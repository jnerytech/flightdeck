import { afterEach, describe, expect, test } from "bun:test";
import type { ChangesUpdated, FileListing } from "@flightdeck/protocol";
import { liveScreen, registerDom } from "./dom.ts";
import { settle, uiIdle } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { FileExplorer } = await import("../src/ui/FileExplorer.tsx");
const { TContext } = await import("../src/i18n/context.tsx");
const { translator } = await import("../src/i18n/index.ts");

import type { AppStore } from "../src/lib/app-store.ts";

afterEach(cleanup);

const changed = (path: string, status: "added" | "modified") => ({
  path,
  oldPath: null,
  status,
  additions: 1,
  deletions: 0,
  uncommitted: true,
  binary: false,
  hunks: [],
});

const listing = (dir: string, names: string[]): FileListing => ({
  dir,
  entries: names.map((name) => ({ name, kind: name.includes(".") ? "file" : "dir" })),
  truncated: false,
});

/** A host whose folders the test edits, as the session writes files; it records each folder asked. */
function host() {
  const asked: string[] = [];
  const tree: Record<string, FileListing> = {
    "": listing("", ["src", "docs", "README.md"]),
    src: listing("src", ["main.ts"]),
    docs: listing("docs", ["guide.md"]),
  };
  const refuse = { next: false };
  let live: ((update: ChangesUpdated) => void) | null = null;
  const store = {
    hostRequest: async (_host: string, type: string, payload: { dir?: string }) => {
      if (type === "file.list") {
        asked.push(payload.dir ?? "?");
        if (refuse.next) return { ok: false, code: "internal", message: "no" };
        return { ok: true, data: tree[payload.dir ?? ""] };
      }
      return { ok: true, data: { target: "session:abc", root: "/r", base: null, files: [] } };
    },
    canOpenPaths: () => false,
    watchChanges: (_host: string, _target: string, listener: (update: ChangesUpdated) => void) => {
      live = listener;
      return () => {};
    },
  } as unknown as AppStore;
  /** The session writes `path` (the listing of its folder gets the file) and the diff says so. */
  const write = async (dir: string, name: string, files: ReturnType<typeof changed>[]) => {
    tree[dir] = listing(dir, [...(tree[dir]?.entries.map((e) => e.name) ?? []), name]);
    await push(files);
  };
  const push = async (files: ReturnType<typeof changed>[]) => {
    await act(async () => {
      live?.({
        type: "changes.updated",
        target: "session:abc",
        root: "/r",
        base: null,
        files,
      } as never);
    });
    await uiIdle();
  };
  return { store, asked, write, push, refuse };
}

const show = async (store: AppStore, lang: "en" | "pt-BR" = "en") => {
  render(
    <TContext.Provider value={translator(lang)}>
      <FileExplorer store={store} hostId="h" target="session:abc" />
    </TContext.Provider>,
  );
  await uiIdle();
};

const names = () => [...document.querySelectorAll("li [data-name]")].map((e) => e.textContent);
const row = (name: string) => screen.queryByText(name, { selector: "li *" })?.closest("li") ?? null;
const open = async (name: string) => {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    if (button) fireEvent.click(button);
  });
  await uiIdle();
};

describe("file-explorer-live: a file the session writes shows in the tree without reopening the tab (issue #574)", () => {
  test("a new file in the root appears with its new mark, as the marks of listed files do", async () => {
    const { store, write } = host();
    await show(store);
    expect(names()).toEqual(["src", "docs", "README.md"]);
    await write("", "x.md", [changed("x.md", "added")]);
    await settle(() => names().includes("x.md"));
    expect(names()).toContain("x.md");
    expect(row("x.md") && within(row("x.md") as HTMLElement).queryByText("new")).not.toBeNull();
  });

  test("an open folder lists the new file; a folder that was never opened is not asked", async () => {
    const { store, write, asked } = host();
    await show(store);
    await open("src");
    await write("src", "a.ts", [changed("src/a.ts", "added")]);
    await settle(() => names().includes("a.ts"));
    expect(names()).toContain("a.ts");
    expect(asked.includes("docs")).toBe(false);
  });

  test("a push that changes no file does not list the folders again", async () => {
    const { store, push, asked } = host();
    await show(store);
    await push([changed("README.md", "modified")]);
    const before = asked.length;
    await push([changed("README.md", "modified")]);
    expect(asked.length).toBe(before);
  });

  test("a listing that fails to refresh leaves the entries that were there", async () => {
    const { store, write, refuse } = host();
    await show(store);
    refuse.next = true;
    await write("", "y.md", [changed("y.md", "added")]);
    await uiIdle();
    expect(names()).toEqual(["src", "docs", "README.md"]);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
