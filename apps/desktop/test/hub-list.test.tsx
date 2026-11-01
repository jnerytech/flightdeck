import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { renderProbe } from "./render-probe.tsx";

registerDom();
const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { AppStore } = await import("../src/lib/app-store.ts");
const { SessionsHub } = await import("../src/ui/SessionsHub.tsx");
const { TooltipProvider } = await import("../src/components/ui/tooltip.tsx");

setDefaultTimeout(60_000);
afterEach(cleanup);

/** The cap of rows the hub draws before "show more" (the spec of phase 28, `hub-list`). */
const CAP = 200;

type Store = InstanceType<typeof AppStore>;

/** A state with one online host and `n` history sessions in 40 projects; `reads.rows` counts how often `hubRows` read them. */
function bigState(store: Store, n: number) {
  const reads = { rows: 0 };
  const host = {
    id: "h1",
    name: "h1",
    url: "ws://x",
    token: "",
    status: "online",
    info: null,
    hostInfo: null,
    latencyMs: null,
    incompatibility: null,
    daemonUpdate: null,
    sessions: [],
  };
  const history = Array.from({ length: n }, (_, i) => ({
    claudeSessionId: `c${i}`,
    cwd: `/work/p${i % 40}`,
    projectKey: `host:h1:/work/p${i % 40}`,
    title: `session ${i}`,
    summary: null,
    lastTs: new Date(1_700_000_000_000 + i * 1000).toISOString(),
    firstTs: null,
    messageCount: 3,
  }));
  // `hubRows` filters the history once per call; nothing else the screen does touches it.
  const counted = new Proxy(history, {
    get(target, prop, receiver) {
      if (prop === "filter") reads.rows++;
      return Reflect.get(target, prop, receiver);
    },
  });
  const state = {
    ...store.getState(),
    hosts: [host],
    hub: { h1: { managed: [], history: counted } },
  };
  return { state: state as never as ReturnType<Store["getState"]>, reads };
}

function hub(store: Store, state: ReturnType<Store["getState"]>) {
  return (
    <TooltipProvider>
      <SessionsHub
        store={store}
        state={state}
        onOpen={() => {}}
        isOpen={() => false}
        density="comfortable"
      />
    </TooltipProvider>
  );
}

const newStore = () => new AppStore(memoryPlatform().platform, { baseDelayMs: 600_000 });
const rowsDrawn = () => document.querySelectorAll("li[aria-label]").length;

describe("hub-list: the sessions hub does its work once per change of its inputs", () => {
  test("100 renders caused by something else cost 0 recomputations of the rows", async () => {
    const store = newStore();
    const { state, reads } = bigState(store, 30);
    const view = render(hub(store, state));
    await act(() => Bun.sleep(20));
    expect(reads.rows).toBe(1);
    for (let i = 0; i < 100; i++) {
      view.rerender(hub(store, { ...state, error: `unrelated ${i}` }));
    }
    expect(reads.rows).toBe(1);
    // A change of what the rows are made of does recompute them.
    view.rerender(hub(store, { ...state, hub: { ...state.hub } }));
    expect(reads.rows).toBe(2);
  });

  test("with 9,090 history sessions the hub draws at most 200 rows, and 'show more' draws 200 more", async () => {
    const store = newStore();
    const { state } = bigState(store, 9090);
    render(hub(store, state));
    await act(() => Bun.sleep(20));
    expect(rowsDrawn()).toBe(CAP);
    fireEvent.click(screen.getByRole("button", { name: /Mostrar mais/ }));
    expect(rowsDrawn()).toBe(2 * CAP);
  });

  test("a hub with fewer rows than the cap has no 'show more'", async () => {
    const store = newStore();
    const { state } = bigState(store, 50);
    render(hub(store, state));
    await act(() => Bun.sleep(20));
    expect(rowsDrawn()).toBe(50);
    expect(screen.queryByRole("button", { name: /Mostrar mais/ })).toBeNull();
  });

  test("the render time at 9,090 rows is within 2x of the time at 690 rows", async () => {
    const mount = async (n: number) => {
      const store = newStore();
      const { state } = bigState(store, n);
      const probe = renderProbe();
      render(probe.wrap(hub(store, state)));
      await act(() => Bun.sleep(20));
      cleanup();
      return probe.stats.ms;
    };
    await mount(690); // warm up: the first mount pays for loading the components
    const small = await mount(690);
    const big = await mount(9090);
    expect(big).toBeLessThanOrEqual(small * 2);
  });
});
