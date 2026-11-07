import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { seedDemoHosts } from "../src/demo/boot.ts";
import { ptBR } from "../src/i18n/pt-BR.ts";
import { SIDEBAR_FOLD_KEY } from "../src/lib/sidebar-fold.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { waiter } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppShell } = await import("../src/components/layout/app-shell.tsx");
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(30_000);
const settle = waiter(4000);
const cleanups: Array<() => void> = [];

async function viewport(width: number) {
  await act(async () => {
    (window as unknown as { happyDOM: { setViewport(v: object): void } }).happyDOM.setViewport({
      width,
      height: 800,
    });
  });
  await settle(() => window.matchMedia("(width < 1024px)").matches === width < 1024);
  await act(async () => {});
}

afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0)) fn();
  await viewport(1024);
});

const LABELS = { sidebar: "Side", collapse: "Collapse", expand: "Expand" };
const rail = () => document.querySelector("[data-slot='sidebar']")?.getAttribute("data-collapsed");

describe("sidebar-fold-ui: the wide window's fold (issue #641)", () => {
  test("a shell given its fold shows it, reports each click, and leaves it alone when the window is not wide", async () => {
    const heard: boolean[] = [];
    render(
      <AppShell
        header={<span>Flightdeck</span>}
        sidebar={() => <p>hosts</p>}
        labels={LABELS}
        folded={true}
        onFold={(value) => heard.push(value)}
      >
        <p>content</p>
      </AppShell>,
    );
    expect(rail()).toBe("true");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    });
    expect(heard).toEqual([false]);
    // Medium: the rail is there whatever the fold, and opening the overlay is not a fold.
    await viewport(800);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    });
    expect(heard).toEqual([false]);
  });

  test("in the app, folding the sidebar is kept, and the next window opens folded", async () => {
    const mem = memoryPlatform(false, "pt-BR");
    seedDemoHosts(mem.win.localStorage, mem.tokens, [
      { id: "ha", name: "alfa", url: "ws://127.0.0.1:1", token: "t" },
    ]);
    const first = new AppStore(mem.platform, { baseDelayMs: 600_000 });
    cleanups.push(() => first.dispose());
    render(<App store={first} />);
    expect(rail()).toBe("false");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: ptBR.shell.collapse }));
    });
    expect(rail()).toBe("true");
    expect(mem.win.localStorage.getItem(SIDEBAR_FOLD_KEY)).toBe("true");
    cleanup();

    const second = new AppStore(mem.platform, { baseDelayMs: 600_000 });
    cleanups.push(() => second.dispose());
    render(<App store={second} />);
    expect(rail()).toBe("true");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: ptBR.shell.expand }));
    });
    expect(rail()).toBe("false");
    expect(mem.win.localStorage.getItem(SIDEBAR_FOLD_KEY)).toBe("false");
  });
});
