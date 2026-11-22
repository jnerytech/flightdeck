import { afterEach, describe, expect, test } from "bun:test";
import type { FileListing } from "@flightdeck/protocol";
import { liveScreen, registerDom } from "../dom.ts";
import { uiIdle } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { FileExplorer } = await import("../../src/features/files/file-explorer.tsx");
const { TContext } = await import("../../src/i18n/context.tsx");
const { translator } = await import("../../src/i18n/index.ts");

import type { AppStore } from "../../src/lib/app-store.ts";

afterEach(cleanup);

const TREE: Record<string, FileListing> = {
  "": {
    dir: "",
    entries: [
      { name: "src", kind: "dir" },
      { name: ".env", kind: "file", secret: true },
      { name: "README.md", kind: "file" },
    ],
    truncated: false,
  },
  src: { dir: "src", entries: [{ name: "main.ts", kind: "file" }], truncated: false },
};

/** A host that refuses the folders in `down` until `up(dir)` is called, and records each ask. */
function host(down: string[]) {
  const refusing = new Set(down);
  const asked: string[] = [];
  const store = {
    hostRequest: async (_host: string, type: string, payload: { dir?: string }) => {
      if (type === "file.list") {
        const dir = payload.dir ?? "";
        asked.push(dir);
        if (refusing.has(dir)) return { ok: false, code: "unavailable", message: "host is busy" };
        return { ok: true, data: TREE[dir] };
      }
      return { ok: true, data: { target: "session:abc", root: "/r", base: null, files: [] } };
    },
    system: { canOpenPaths: () => false },
    watchChanges: () => () => {},
  } as unknown as AppStore;
  return { store, asked, up: (dir: string) => refusing.delete(dir) };
}

const show = async (store: AppStore, language: "en" | "pt-BR" = "en") => {
  render(
    <TContext.Provider value={translator(language)}>
      <FileExplorer store={store} hostId="h" target="session:abc" />
    </TContext.Provider>,
  );
  await uiIdle();
};

const press = async (name: string) => {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    if (button) fireEvent.click(button);
  });
  await uiIdle();
};

describe("file-explorer-refused: a refused folder can be read again (#3971)", () => {
  test("closing and opening a refused folder asks the host again, and it lists once the host recovers", async () => {
    const { store, asked, up } = host(["src"]);
    await show(store);
    await press("src");
    expect(screen.queryByRole("alert")?.textContent?.includes("host is busy")).toBe(true);
    await press("src"); // close
    up("src");
    await press("src"); // open again
    expect(asked.filter((dir) => dir === "src")).toHaveLength(2);
    expect(screen.queryByText("main.ts")).not.toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("the error row has Try again, which asks again and lists the folder", async () => {
    const { store, asked, up } = host(["src"]);
    await show(store);
    await press("src");
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeNull();
    up("src");
    await press("Try again");
    expect(asked.filter((dir) => dir === "src")).toHaveLength(2);
    expect(screen.queryByText("main.ts")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  test("a refused root has Try again too", async () => {
    const { store, up } = host([""]);
    await show(store);
    expect(screen.queryByRole("alert")).not.toBeNull();
    up("");
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeNull();
    await press("Try again");
    expect(screen.queryByRole("button", { name: "src" })).not.toBeNull();
  });

  test("the retry reads in Portuguese", async () => {
    const { store } = host(["src"]);
    await show(store, "pt-BR");
    await press("src");
    expect(screen.queryByRole("button", { name: "Tentar de novo" })).not.toBeNull();
  });
});

describe("file-explorer-refused: a folder shows a chevron that turns when open (#3971)", () => {
  test("a folder has one, a file has none, and it changes with the open state", async () => {
    const { store } = host([]);
    await show(store);
    const folder = screen.queryByRole("button", { name: "src" });
    const file = screen.queryByRole("button", { name: "README.md" });
    expect(folder?.querySelector("svg.lucide-chevron-right") !== null).toBe(true);
    expect(file?.querySelector("svg") === null).toBe(true);
    await press("src");
    expect(folder?.querySelector("svg.lucide-chevron-down") !== null).toBe(true);
    expect(folder?.querySelector("svg.lucide-chevron-right") === null).toBe(true);
  });
});
