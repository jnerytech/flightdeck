import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { assistantLine, userLine, writeTranscript } from "../../daemon/test/history-helpers.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { waiter } from "./wait.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

/** A ResizeObserver the test drives: `grow()` is a layout change (an image, a code block). */
const observers: Array<() => void> = [];
class FakeResizeObserver {
  constructor(private readonly callback: (entries: unknown[]) => void) {
    // The app's other observers read the entry's size: give them one.
    observers.push(() =>
      this.callback([{ contentRect: { width: 1000, height: 800 }, target: document.body }]),
    );
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}
const grow = () =>
  act(async () => {
    for (const fire of observers) fire();
  });

const cleanups: Array<() => unknown> = [];
let original: unknown;
beforeEach(() => {
  observers.length = 0;
  original = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver;
});
afterEach(async () => {
  cleanup();
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = original;
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const settle = waiter(3000);
const TOTAL = 120;

/** One host with a 120-message transcript, opened in the reader without a search hit. */
async function openLatest() {
  const d = makeDaemon(cleanups);
  const lines = Array.from({ length: TOTAL }, (_, i) => {
    const ts = new Date(Date.UTC(2026, 8, 1, 10, 0, i)).toISOString();
    const opts = { uuid: `m${i}`, text: `mensagem ${i}`, cwd: d.project, ts };
    return i % 2 === 0 ? userLine(opts) : assistantLine(opts);
  });
  writeTranscript(d.historyRoot, "-p", "longa", lines);
  await d.history.scan();
  const server = d.listen();
  const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "alfa", url: server.url, token: TOKEN });
  });
  await settle(() => store.getState().hosts[0]?.status === "online");
  const hostId = store.getState().hosts[0]?.id ?? "";
  await act(async () => {
    store.router.push({ name: "reader", target: { hostId, claudeSessionId: "longa" } });
  });
  await settle(() => shown().length > 0);
}

const shown = () =>
  [...document.querySelectorAll("[data-uuid]")].map((el) => (el as HTMLElement).dataset.uuid);

/** The log, with the sizes a browser would give it (the test DOM has no layout). */
function sized(height: { scroll: number; client: number; top: number }) {
  const el = screen.queryByRole("log", { name: "Transcript" }) as HTMLElement;
  expect(el).not.toBeNull();
  const size = { ...height };
  Object.defineProperty(el, "scrollHeight", { get: () => size.scroll, configurable: true });
  Object.defineProperty(el, "clientHeight", { get: () => size.client, configurable: true });
  Object.defineProperty(el, "scrollTop", {
    get: () => size.top,
    set: (v: number) => {
      size.top = v;
    },
    configurable: true,
  });
  return { el, size };
}

describe("leitor-fim", () => {
  test("a transcript opens on its latest messages, and stays at the end while the layout settles", async () => {
    await openLatest();
    expect(shown()[0]).toBe(`m${TOTAL - 50}`);
    expect(shown().at(-1)).toBe(`m${TOTAL - 1}`);
    const s = sized({ scroll: 1000, client: 400, top: 0 });
    await grow();
    expect(s.size.top).toBe(1000);
    s.size.scroll = 1800;
    await grow();
    expect(s.size.top).toBe(1800);
  });

  test("Carregar anteriores, from the top of what is loaded, leaves the reader on the same message", async () => {
    await openLatest();
    const s = sized({ scroll: 3000, client: 400, top: 100 });
    await act(async () => void fireEvent.scroll(s.el));
    s.size.scroll = 5000;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Carregar anteriores" }));
    });
    await settle(() => shown().length === 100);
    expect(shown()[0]).toBe(`m${TOTAL - 100}`);
    expect(s.size.top).toBe(2100);
  });
});
