import { afterEach, describe, expect, test } from "bun:test";
import type { FileListing } from "@flightdeck/protocol";
import { liveScreen, registerDom } from "./dom.ts";
import { settleMaybe, uiIdle } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { FileExplorer } = await import("../src/ui/FileExplorer.tsx");
const { TContext } = await import("../src/i18n/context.tsx");
const { translator } = await import("../src/i18n/index.ts");

import type { AppStore } from "../src/lib/app-store.ts";

afterEach(cleanup);

const ROOT: FileListing = {
  dir: "",
  entries: [
    { name: ".env", kind: "file", secret: true },
    { name: "logo.png", kind: "file" },
    { name: "README.md", kind: "file" },
    { name: "app.ts", kind: "file" },
  ],
  truncated: false,
};

/** A host whose README has two lines and whose logo is not text; `local`: a host of this computer. */
function host(local = false) {
  const read: string[] = [];
  const opened: string[] = [];
  const store = {
    hostRequest: async (_host: string, type: string, payload: { path?: string }) => {
      if (type === "file.list") return { ok: true, data: ROOT };
      if (type === "file.read") {
        read.push(payload.path ?? "");
        if (payload.path === "logo.png") {
          return {
            ok: false,
            code: "bad_request",
            message: "not text",
            reason: "review_file_binary",
            params: { path: "logo.png" },
          };
        }
        const text =
          payload.path === "app.ts" ? "const answer = 42;\n" : "first line\nsecond line\n";
        return { ok: true, data: { path: payload.path, text, hash: "h", size: text.length } };
      }
      return { ok: true, data: { target: "session:abc", root: "/r", base: null, files: [] } };
    },
    watchChanges: () => () => {},
    canOpenPaths: () => local,
    openPath: async (_host: string, path: string) => {
      opened.push(`open ${path}`);
      return true;
    },
    revealPath: async (_host: string, path: string) => {
      opened.push(`reveal ${path}`);
      return true;
    },
  } as unknown as AppStore;
  return { store, read, opened };
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

describe("file-viewer-ui: a file of the tree, read only, with line numbers (#506)", () => {
  test("a click opens the file with its lines numbered, not editable; Close puts it away", async () => {
    const { store, read } = host();
    await show(store);
    await press("README.md");
    const viewer = screen.queryByRole("region", { name: "File README.md" });
    expect(viewer).not.toBeNull();
    const content = viewer?.querySelector(".cm-content");
    expect(content?.textContent ?? "").toContain("second line");
    expect(content?.getAttribute("contenteditable")).toBe("false");
    const numbers = [...(viewer?.querySelectorAll(".cm-lineNumbers .cm-gutterElement") ?? [])];
    expect(numbers.map((n) => n.textContent)).toContain("2");
    expect(read).toEqual(["README.md"]);
    await press("Close");
    expect(screen.queryByRole("region", { name: "File README.md" })).toBeNull();
  });

  test("a credential cannot be opened, and a file that is not text says so", async () => {
    const { store, read } = host();
    await show(store);
    expect(screen.queryByRole("button", { name: ".env" })).toBeNull();
    await press("logo.png");
    expect(screen.queryByText("The file logo.png is not text.")).not.toBeNull();
    expect(read).toEqual(["logo.png"]);
  });

  test("a file in a known language is colored by token once its language loads; plain text is not", async () => {
    const { store } = host();
    await show(store);
    await press("app.ts");
    const tokens = () => [...document.querySelectorAll(".cm-content .cm-line span")];
    const colored = () =>
      tokens().some((span) => span.textContent === "const" && span.className !== "");
    await settleMaybe(colored);
    expect(colored()).toBe(true);
    await press("Close");
    await press("README.md");
    expect(document.querySelector(".cm-content")?.textContent ?? "").toContain("second line");
    expect(tokens().length).toBe(0);
  });

  test("on a host of this computer the file opens in its app or shows in its folder; elsewhere neither is offered", async () => {
    const local = host(true);
    await show(local.store);
    await press("README.md");
    await press("Open in its app");
    await press("Show in folder");
    expect(local.opened).toEqual(["open /r/README.md", "reveal /r/README.md"]);
    // A file the host refused to read offers neither.
    await press("logo.png");
    expect(screen.queryByText("The file logo.png is not text.")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Open in its app" }) === null).toBe(true);
    cleanup();
    const remote = host(false);
    await show(remote.store);
    await press("README.md");
    expect(screen.queryByRole("button", { name: "Open in its app" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Show in folder" })).toBeNull();
  });

  test("in Portuguese", async () => {
    const { store } = host();
    await show(store, "pt-BR");
    await press("README.md");
    expect(screen.queryByRole("region", { name: "Arquivo README.md" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Fechar" })).not.toBeNull();
    cleanup();
    await show(host(true).store, "pt-BR");
    await press("README.md");
    expect(screen.queryByRole("button", { name: "Abrir no app padrão" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Mostrar na pasta" })).not.toBeNull();
  });
});
