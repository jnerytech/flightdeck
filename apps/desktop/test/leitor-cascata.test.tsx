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

type Opts = { cursor?: string; oldDaemon?: boolean };

/** One host with a 120-message transcript, opened in the reader (on a cursor, or as an old daemon would answer a plain open). */
async function open(opts: Opts) {
  const d = makeDaemon(cleanups);
  const lines = Array.from({ length: TOTAL }, (_, i) => {
    const ts = new Date(Date.UTC(2026, 8, 1, 10, 0, i)).toISOString();
    const o = { uuid: `m${i}`, text: `mensagem ${i}`, cwd: d.project, ts };
    return i % 2 === 0 ? userLine(o) : assistantLine(o);
  });
  writeTranscript(d.historyRoot, "-p", "longa", lines);
  await d.history.scan();
  const server = d.listen();
  const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  const asked: Array<string | undefined> = [];
  const real = store.historyGet.bind(store);
  store.historyGet = (async (host: string, id: string, cursor?: string, tail?: boolean) => {
    asked.push(cursor);
    // An old daemon strips `tail`: page one comes back, and it knows no `cursor` field.
    const page = await real(host, id, cursor, opts.oldDaemon ? false : tail);
    if (page && opts.oldDaemon) delete (page as { cursor?: string }).cursor;
    return page;
  }) as typeof store.historyGet;
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "alfa", url: server.url, token: TOKEN });
  });
  await settle(() => store.getState().hosts[0]?.status === "online");
  const hostId = store.getState().hosts[0]?.id ?? "";
  await act(async () => {
    store.router.push({
      name: "reader",
      target: { hostId, claudeSessionId: "longa", ...(opts.cursor ? { cursor: opts.cursor } : {}) },
    });
  });
  await settle(() => shown().length > 0);
  return { asked };
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

describe("leitor-cascata: a page read forward never drags the reader to its end", () => {
  test("opened on a cursor, a reader 10 px from the end of what is loaded stays where it is when the next page comes in", async () => {
    const { asked } = await open({ cursor: "0" });
    const first = shown().length;
    expect(first).toBeLessThan(TOTAL);
    const s = sized({ scroll: 3000, client: 400, top: 2590 });
    await act(async () => void fireEvent.scroll(s.el));
    await settle(() => shown().length > first);
    // The new page makes the log taller; the reader's place is the same message, not the new end.
    s.size.scroll = 6000;
    await grow();
    expect(s.size.top).toBe(2590);
    // One page was asked for by the scroll: no cascade through the transcript.
    expect(asked).toHaveLength(2);
  });

  test("an old daemon, which ignores tail and sends page one without a cursor, does not pin the reader and does not cascade", async () => {
    const { asked } = await open({ oldDaemon: true });
    expect(shown()[0]).toBe("m0");
    const s = sized({ scroll: 3000, client: 400, top: 0 });
    await grow();
    expect(s.size.top).toBe(0);
    s.size.scroll = 6000;
    await grow();
    expect(s.size.top).toBe(0);
    expect(asked).toHaveLength(1);
  });
});
