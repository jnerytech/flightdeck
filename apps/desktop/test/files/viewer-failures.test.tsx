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

const ROOT: FileListing = {
  dir: "",
  entries: [{ name: "README.md", kind: "file" }],
  truncated: false,
};

/** A host of this computer: its reads refuse until `up()`, and its platform calls return `platform`. */
function host(platform: boolean) {
  let refusing = true;
  const reads: string[] = [];
  const store = {
    hostRequest: async (_host: string, type: string, payload: { path?: string }) => {
      if (type === "file.list") return { ok: true, data: ROOT };
      if (type === "file.read") {
        reads.push(payload.path ?? "");
        if (refusing) return { ok: false, code: "unavailable", message: "host is busy" };
        return { ok: true, data: { path: payload.path, text: "hello\n", hash: "h", size: 6 } };
      }
      return { ok: true, data: { target: "session:abc", root: "/r", base: null, files: [] } };
    },
    watchChanges: () => () => {},
    scan: { values: () => [], subscribe: () => () => {}, version: 0 },
    system: {
      canOpenPaths: () => true,
      openPath: async () => platform,
      revealPath: async () => platform,
    },
  } as unknown as AppStore;
  return {
    store,
    reads,
    up: () => {
      refusing = false;
    },
  };
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

describe("file-viewer-failures: a refused read can be run again (#3972)", () => {
  test("the notice has Try again, which reads the file again and shows it", async () => {
    const { store, reads, up } = host(true);
    await show(store);
    await press("README.md");
    expect(screen.queryByText("host is busy")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeNull();
    up();
    await press("Try again");
    expect(reads).toEqual(["README.md", "README.md"]);
    expect(screen.queryByText("host is busy")).toBeNull();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  test("the retry reads in Portuguese", async () => {
    const { store } = host(true);
    await show(store, "pt-BR");
    await press("README.md");
    expect(screen.queryByRole("button", { name: "Tentar de novo" })).not.toBeNull();
  });
});

describe("file-viewer-failures: a failed open or reveal says so (#3972)", () => {
  test("Open in its app that fails says so; one that works says nothing", async () => {
    const failing = host(false);
    failing.up();
    await show(failing.store);
    await press("README.md");
    expect(screen.queryByRole("alert")).toBeNull();
    await press("Open in its app");
    expect(screen.queryByRole("alert")?.textContent).toBe("Could not open the file in its app.");
    cleanup();
    const working = host(true);
    working.up();
    await show(working.store);
    await press("README.md");
    await press("Open in its app");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("Show in folder that fails says so, and in Portuguese too", async () => {
    const failing = host(false);
    failing.up();
    await show(failing.store);
    await press("README.md");
    await press("Show in folder");
    expect(screen.queryByRole("alert")?.textContent).toBe("Could not show the file in its folder.");
    cleanup();
    const pt = host(false);
    pt.up();
    await show(pt.store, "pt-BR");
    await press("README.md");
    await press("Mostrar na pasta");
    expect(screen.queryByRole("alert")?.textContent).toBe(
      "Não foi possível mostrar o arquivo na pasta.",
    );
  });
});
