import { afterEach, describe, expect, test } from "bun:test";
import type { ChangesUpdated, FileListing } from "@flightdeck/protocol";
import { liveScreen, registerDom } from "./dom.ts";
import { uiIdle } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { FileExplorer } = await import("../src/ui/FileExplorer.tsx");
const { SessionTabs } = await import("../src/ui/SessionTabs.tsx");
const { TContext } = await import("../src/i18n/context.tsx");
const { translator } = await import("../src/i18n/index.ts");

import type { AppStore } from "../src/lib/app-store.ts";

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
  src: {
    dir: "src",
    entries: [
      { name: "lib", kind: "dir" },
      { name: "main.ts", kind: "file" },
    ],
    truncated: true,
  },
  "src/lib": { dir: "src/lib", entries: [{ name: "util.ts", kind: "file" }], truncated: false },
};

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

/** A host with the tree above; `src/main.ts` changed. Records each folder it is asked for. */
function host(refuse = false) {
  const asked: string[] = [];
  let live: ((update: ChangesUpdated) => void) | null = null;
  const store = {
    hostRequest: async (_host: string, type: string, payload: { dir?: string }) => {
      if (type === "file.list") {
        asked.push(payload.dir ?? "?");
        if (refuse) {
          return {
            ok: false,
            code: "bad_request",
            message: "not a repository",
            reason: "repo_not_git",
            params: { path: "/home/u/notes" },
          };
        }
        return { ok: true, data: TREE[payload.dir ?? ""] };
      }
      return {
        ok: true,
        data: {
          target: "session:abc",
          root: "/r",
          base: null,
          files: [changed("src/main.ts", "modified")],
        },
      };
    },
    watchChanges: (_host: string, _target: string, listener: (update: ChangesUpdated) => void) => {
      live = listener;
      return () => {};
    },
  } as unknown as AppStore;
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
  };
  return { store, asked, push };
}

const show = async (store: AppStore, language: "en" | "pt-BR" = "en") => {
  render(
    <TContext.Provider value={translator(language)}>
      <FileExplorer store={store} hostId="h" target="session:abc" />
    </TContext.Provider>,
  );
  await uiIdle();
};

const row = (name: string) => screen.queryByText(name, { selector: "li *" })?.closest("li") ?? null;

const toggle = async (name: string) => {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    if (button) fireEvent.click(button);
  });
  await uiIdle();
};

describe("file-explorer-ui: the session's files as a tree (#506)", () => {
  test("the root shows folders first, a credential as hidden, and asks for nothing else", async () => {
    const { store, asked } = host();
    await show(store);
    expect(screen.queryByRole("region", { name: "Files of the repository" })).not.toBeNull();
    const names = [...document.querySelectorAll("li [data-name]")].map((e) => e.textContent);
    expect(names).toEqual(["src", ".env", "README.md"]);
    expect(row(".env") && within(row(".env") as HTMLElement).queryByText("Hidden")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "src" })?.getAttribute("aria-expanded")).toBe(
      "false",
    );
    expect(asked).toEqual([""]);
  });

  test("a folder opens on click, asking the host once, and closes again; a cut folder says so", async () => {
    const { store, asked } = host();
    await show(store);
    await toggle("src");
    expect(screen.queryByText("main.ts")).not.toBeNull();
    expect(screen.queryByText("This folder has more entries than are shown here.")).not.toBeNull();
    await toggle("src");
    expect(screen.queryByText("main.ts")).toBeNull();
    await toggle("src");
    expect(screen.queryByText("main.ts")).not.toBeNull();
    expect(asked).toEqual(["", "src"]);
  });

  test("a changed file carries its status, and the folders above it say they hold changes", async () => {
    const { store, push } = host();
    await show(store);
    expect(
      row("src") && within(row("src") as HTMLElement).queryByText("has changes"),
    ).not.toBeNull();
    await toggle("src");
    expect(
      row("main.ts") && within(row("main.ts") as HTMLElement).queryByText("modified"),
    ).not.toBeNull();
    expect(
      row("README.md") && within(row("README.md") as HTMLElement).queryByText("modified"),
    ).toBeNull();
    await push([changed("README.md", "added")]);
    expect(
      row("README.md") && within(row("README.md") as HTMLElement).queryByText("new"),
    ).not.toBeNull();
    expect(
      row("main.ts") && within(row("main.ts") as HTMLElement).queryByText("modified"),
    ).toBeNull();
  });

  test("the filter keeps matching names and the folders on their way; nothing matching says so", async () => {
    const { store } = host();
    await show(store);
    await toggle("src");
    await toggle("lib");
    const filter = screen.queryByRole("searchbox", { name: "Filter by name" });
    expect(filter).not.toBeNull();
    await act(async () => {
      fireEvent.change(filter as HTMLElement, { target: { value: "UTIL" } });
    });
    expect(screen.queryByText("util.ts")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "lib" })).not.toBeNull();
    expect(screen.queryByText("README.md")).toBeNull();
    expect(screen.queryByText("main.ts")).toBeNull();
    await act(async () => {
      fireEvent.change(filter as HTMLElement, { target: { value: "zzz" } });
    });
    expect(screen.queryByText("Nothing matches the filter.")).not.toBeNull();
  });

  test("in Portuguese, and a session outside git says why", async () => {
    const ok = host();
    await show(ok.store, "pt-BR");
    expect(screen.queryByRole("region", { name: "Arquivos do repositório" })).not.toBeNull();
    expect(row(".env") && within(row(".env") as HTMLElement).queryByText("Oculto")).not.toBeNull();
    expect(screen.queryByRole("searchbox", { name: "Filtrar por nome" })).not.toBeNull();
    cleanup();
    const refused = host(true);
    await show(refused.store);
    expect(screen.queryByRole("alert")?.textContent ?? "").toBe(
      "/home/u/notes is not a git repository.",
    );
  });

  test("the session's Files tab is there when the host lists files, and opens the tree", async () => {
    const tabs = (files: boolean) => (
      <TContext.Provider value={translator("en")}>
        <SessionTabs
          store={host().store}
          hostId="h"
          claudeSessionId="abc"
          enabled={false}
          files={files}
        >
          <p>conversation</p>
        </SessionTabs>
      </TContext.Provider>
    );
    render(tabs(false));
    expect(screen.queryByRole("button", { name: "Files" })).toBeNull();
    cleanup();
    render(tabs(true));
    await toggle("Files");
    expect(screen.queryByRole("region", { name: "Files of the repository" })).not.toBeNull();
  });
});
