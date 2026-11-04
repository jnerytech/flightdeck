import { afterEach, describe, expect, test } from "bun:test";
import { Profiler } from "react";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { stays, uiIdle } from "./wait.ts";

registerDom();
const { act, cleanup, render, within, waitFor } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** An app with one online host whose daemon pings every 20 ms, and the renders it commits. */
async function pinged() {
  const d = makeDaemon(cleanups, {});
  const server = d.listen(0, 20);
  const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 10 });
  cleanups.push(() => store.dispose());
  const counts = { commits: 0, notes: 0 };
  render(
    <Profiler id="app" onRender={() => counts.commits++}>
      <App store={store} />
    </Profiler>,
  );
  await act(() => store.addHost({ name: "pc", url: server.url, token: TOKEN }));
  await waitFor(() => expect(screen.queryByLabelText("pc: online")).not.toBeNull(), {
    timeout: 8000,
  });
  await uiIdle();
  store.subscribe(() => counts.notes++);
  return { store, counts };
}

describe("ping-renders: a heartbeat only moves the latency it carries", () => {
  test("pings that arrive while nothing else happens do not notify the state's subscribers", async () => {
    const { counts } = await pinged();
    await stays(() => counts.notes === 0, 600);
    expect(counts.notes).toBe(0);
  });

  test("and the app commits no render for them", async () => {
    const { counts } = await pinged();
    const before = counts.commits;
    await stays(() => counts.commits === before, 600);
    expect(counts.commits - before).toBe(0);
  });
});
