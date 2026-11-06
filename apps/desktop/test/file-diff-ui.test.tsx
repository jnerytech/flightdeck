import { afterEach, describe, expect, test } from "bun:test";
import type { ChangesUpdated, DiffFile, FileListing } from "@flightdeck/protocol";
import { liveScreen, registerDom } from "./dom.ts";
import { uiIdle } from "./wait.ts";

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
  entries: [{ name: "README.md", kind: "file" }],
  truncated: false,
};

/** README.md changed in `hunks` places, each one line, the newest last. */
const readme = (hunks: number): DiffFile => ({
  path: "README.md",
  oldPath: null,
  status: "modified",
  additions: hunks,
  deletions: 0,
  uncommitted: true,
  binary: false,
  hunks: Array.from({ length: hunks }, (_, i) => ({
    header: `@@ -${i * 10 + 1},0 +${i * 10 + 1} @@`,
    lines: [{ op: "+" as const, text: `edit number ${i + 1}` }],
  })),
});

/** A host whose README the session keeps editing: `push` sends the diff with more hunks. */
function host() {
  let live: ((update: ChangesUpdated) => void) | null = null;
  const store = {
    hostRequest: async (_host: string, type: string, payload: { path?: string }) => {
      if (type === "file.list") return { ok: true, data: ROOT };
      if (type === "file.read") {
        const text = "one\ntwo\n";
        return { ok: true, data: { path: payload.path, text, hash: "h", size: text.length } };
      }
      return {
        ok: true,
        data: { target: "session:abc", root: "/r", base: null, files: [readme(1)] },
      };
    },
    watchChanges: (_host: string, _target: string, listener: (update: ChangesUpdated) => void) => {
      live = listener;
      return () => {};
    },
  } as unknown as AppStore;
  const push = async (hunks: number) => {
    await act(async () => {
      live?.({
        type: "changes.updated",
        target: "session:abc",
        root: "/r",
        base: null,
        files: [readme(hunks)],
      });
    });
    await uiIdle();
  };
  return { store, push };
}

const press = async (name: string | RegExp) => {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    if (button) fireEvent.click(button);
  });
  await uiIdle();
};

/** Opens README's changes; the diff's scroll box measures 1000 px of content in a 100 px window. */
async function openDiff(language: "en" | "pt-BR", toggle: string) {
  const { store, push } = host();
  render(
    <TContext.Provider value={translator(language)}>
      <FileExplorer store={store} hostId="h" target="session:abc" />
    </TContext.Provider>,
  );
  await uiIdle();
  await press("README.md");
  await press(toggle);
  const box = document.querySelector<HTMLElement>("[data-follow]");
  expect(box).not.toBeNull();
  const el = box as HTMLElement;
  Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => 1000 });
  Object.defineProperty(el, "clientHeight", { configurable: true, get: () => 100 });
  const scrollTo = async (top: number) => {
    await act(async () => {
      el.scrollTop = top;
      fireEvent.scroll(el);
    });
  };
  return { el, push, scrollTo };
}

describe("file-diff-ui: the file's changes against HEAD follow the session live (#506)", () => {
  test("the toggle shows the diff; at the bottom, each new edit brings the newest hunk into view", async () => {
    const { el, push } = await openDiff("en", "Show changes");
    expect(screen.queryByText(/edit number 1$/)).not.toBeNull();
    await push(2);
    expect(screen.queryByText(/edit number 2$/)).not.toBeNull();
    expect(el.scrollTop).toBe(1000);
    expect(screen.queryByRole("button", { name: /Jump to latest/ })).toBeNull();
  });

  test("a scroll up stops following; Jump to latest brings it back, and so does a scroll to the bottom", async () => {
    const { el, push, scrollTo } = await openDiff("en", "Show changes");
    await scrollTo(0);
    await push(2);
    await push(3);
    expect(el.scrollTop).toBe(0);
    expect(screen.queryByRole("button", { name: "Jump to latest (2 new changes)" })).not.toBeNull();
    await press("Jump to latest (2 new changes)");
    expect(el.scrollTop).toBe(1000);
    expect(screen.queryByRole("button", { name: /Jump to latest/ })).toBeNull();
    await push(4);
    expect(el.scrollTop).toBe(1000);
    // Up again, one edit missed, then the person scrolls back down by hand.
    await scrollTo(200);
    await push(5);
    expect(screen.queryByRole("button", { name: "Jump to latest (1 new change)" })).not.toBeNull();
    await scrollTo(900);
    expect(screen.queryByRole("button", { name: /Jump to latest/ })).toBeNull();
    await push(6);
    expect(el.scrollTop).toBe(1000);
  });

  test("in Portuguese", async () => {
    const { push, scrollTo } = await openDiff("pt-BR", "Mostrar mudanças");
    await scrollTo(0);
    await push(2);
    expect(
      screen.queryByRole("button", { name: "Ir para a mais recente (1 mudança nova)" }),
    ).not.toBeNull();
    await press("Mostrar o arquivo");
    expect(document.querySelector("[data-follow]")).toBeNull();
  });
});
