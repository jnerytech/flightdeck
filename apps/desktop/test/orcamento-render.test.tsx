import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { Profiler } from "react";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform, TOKEN } from "./fixtures.ts";
import { legacyDaemon } from "./legacy-daemon.ts";

registerDom();
const { act, cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");
const { useSessionState, useStoreState } = await import("../src/lib/use-store.ts");

setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const delta = (sessionId: string, seq: number) => ({
  type: "event",
  sessionId,
  seq,
  ts: "2026-10-31T12:00:00.000Z",
  event: { type: "message.delta", text: "palavra " },
});

async function online() {
  const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 600_000 });
  cleanups.push(() => store.dispose());
  const daemon = legacyDaemon(cleanups);
  await act(async () => {
    await store.addHost({ name: "alfa", url: daemon.url, token: TOKEN });
  });
  const deadline = Date.now() + 5000;
  while (store.getState().hosts[0]?.status !== "online" && Date.now() < deadline) {
    await act(() => Bun.sleep(10));
  }
  await act(() => Bun.sleep(200));
  return { store, daemon };
}

/** Streams `n` events of a session to the app, as the daemon does. */
async function stream(daemon: ReturnType<typeof legacyDaemon>, sessionId: string, n: number) {
  for (let i = 1; i <= n; i++) {
    await act(async () => {
      daemon.push(delta(sessionId, i));
      await Bun.sleep(2);
    });
  }
}

describe("orcamento-render: what a token costs", () => {
  test("a screen that is not a conversation does not render for a session's events", async () => {
    const { store, daemon } = await online();
    let renders = 0;
    function Probe() {
      renders++;
      useStoreState(store);
      return <span>probe</span>;
    }
    render(<Probe />);
    const before = renders;
    await stream(daemon, "s1", 20);
    expect(renders - before).toBe(0);
  });

  test("it still follows what is not a session's events", async () => {
    const { store, daemon } = await online();
    let renders = 0;
    function Probe() {
      renders++;
      const state = useStoreState(store);
      return <span>{state.hosts.length}</span>;
    }
    render(<Probe />);
    const before = renders;
    await act(async () => {
      await store.addHost({ name: "beta", url: daemon.url, token: TOKEN });
    });
    expect(renders - before).toBeGreaterThan(0);
    expect(screen.queryByText("2")).not.toBeNull();
  });

  test("a conversation renders for its own session's events and for no other's", async () => {
    const { store, daemon } = await online();
    const hostId = store.getState().hosts[0]?.id ?? "";
    let renders = 0;
    function Probe() {
      renders++;
      const session = useSessionState(store, `${hostId}/s1`);
      return <span>{session.streaming}</span>;
    }
    render(<Probe />);
    const before = renders;
    await stream(daemon, "s2", 20);
    expect(renders - before).toBe(0);
    await stream(daemon, "s1", 5);
    expect(renders - before).toBe(5);
    expect(screen.queryByText(/palavra/)).not.toBeNull();
  });

  test("the whole app: a session's tokens do not re-render the app, and a quiet second costs nothing", async () => {
    const { store, daemon } = await online();
    let commits = 0;
    render(
      <Profiler
        id="app"
        onRender={() => {
          commits++;
        }}
      >
        <App store={store} />
      </Profiler>,
    );
    await act(() => Bun.sleep(300));
    const quiet = commits;
    await act(() => Bun.sleep(1000));
    expect(commits - quiet).toBe(0);
    await stream(daemon, "s9", 30);
    expect(commits - quiet).toBe(0);
  });
});
