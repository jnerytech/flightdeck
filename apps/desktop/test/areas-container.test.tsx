import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { SplitView } = await import("../src/components/layout/split-view.tsx");
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

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

const view = (detail: string | null, onClose = () => {}) =>
  render(
    <SplitView
      list={<p>lista</p>}
      detail={detail === null ? null : <p>{detail}</p>}
      empty={<p>nada aberto</p>}
      onClose={onClose}
      labels={{ resize: "Redimensionar a lista", back: "Voltar à lista" }}
    />,
  );
const cols = () => screen.queryByRole("group")?.style.gridTemplateColumns;
const separator = () => screen.queryByRole("separator", { name: "Redimensionar a lista" });

describe("areas: a tela se adapta à largura da sua área", () => {
  test("in a narrow area with a session open, only the session shows, with a way back to the list", async () => {
    const ro = fakeResizeObserver();
    let closed = 0;
    view("detalhe", () => closed++);
    await ro.resize(500);
    expect(screen.queryByText("detalhe")).not.toBeNull();
    expect(screen.queryByText("lista")).toBeNull();
    expect(separator()).toBeNull();
    const back = screen.queryByRole("button", { name: "Voltar à lista" });
    expect(back).not.toBeNull();
    await act(async () => {
      fireEvent.click(back as HTMLElement);
    });
    expect(closed).toBe(1);
    ro.restore();
  });

  test("in a narrow area with nothing open, the list takes the whole area", async () => {
    const ro = fakeResizeObserver();
    view(null);
    await ro.resize(500);
    expect(screen.queryByText("lista")).not.toBeNull();
    expect(screen.queryByText("nada aberto")).toBeNull();
    expect(screen.queryByRole("button", { name: "Voltar à lista" })).toBeNull();
    ro.restore();
  });

  test("a medium area gives the list no more than 45% of it, so the detail never wraps word by word", async () => {
    const ro = fakeResizeObserver();
    view("detalhe");
    await ro.resize(700);
    expect(cols()).toBe("315px 1px minmax(0, 1fr)");
    expect(screen.queryByText("lista")).not.toBeNull();
    expect(screen.queryByText("detalhe")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Voltar à lista" })).toBeNull();
    // The preference stays what the user set: the divider still reports 380.
    expect(separator()?.getAttribute("aria-valuenow")).toBe("380");
    ro.restore();
  });

  test("a wide area keeps the list at the width the user chose, and widening it again brings both panes back", async () => {
    const ro = fakeResizeObserver();
    view("detalhe");
    await ro.resize(500);
    expect(screen.queryByText("lista")).toBeNull();
    await ro.resize(1200);
    expect(cols()).toBe("380px 1px minmax(0, 1fr)");
    expect(screen.queryByText("lista")).not.toBeNull();
    ro.restore();
  });

  test("each area is a container its screens lay out against", async () => {
    const store = new AppStore(memoryPlatform(false, "pt-BR").platform);
    render(<App store={store} />);
    await act(async () => {
      store.workspace.toggleSplit();
    });
    for (const n of ["1", "2"]) {
      const area = document.querySelector(`section[aria-label="Área ${n}"]`);
      expect(area).not.toBeNull();
      expect(area?.querySelector(".\\@container")).not.toBeNull();
    }
  });

  test("a screen never picks its columns from the window width: no sm:, md:, lg: or xl: in a screen (dialogs and sheets size to the window)", () => {
    const root = resolve(import.meta.dir, "../src");
    const files = [
      ...readdirSync(join(root, "ui")).map((f) => join(root, "ui", f)),
      ...["layout", "vault", "feedback"].flatMap((dir) =>
        readdirSync(join(root, "components", dir)).map((f) => join(root, "components", dir, f)),
      ),
    ].filter((file) => file.endsWith(".tsx") || file.endsWith(".ts"));
    const offenders = files.filter((file) =>
      /["'` ](sm|md|lg|xl|2xl):(?!max-w-)[a-z[]/.test(readFileSync(file, "utf8")),
    );
    expect(offenders.map((f) => f.slice(root.length))).toEqual([]);
  });
});
