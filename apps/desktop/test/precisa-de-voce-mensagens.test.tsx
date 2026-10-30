import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform, TOKEN } from "./fixtures.ts";
import { legacyDaemon } from "./legacy-daemon.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function settle(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await act(() => Bun.sleep(10));
}
const click = async (name: string | RegExp) => {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
};

const LOOP = {
  type: "messaging.alert",
  kind: "loop",
  from: "h/s1",
  to: "h/s2",
  message: "laço entre h/s1 e h/s2: o par foi pausado",
  at: "2026-10-30T12:00:00.000Z",
};

async function open(features = ["messaging", "teams"]) {
  const mem = memoryPlatform();
  const store = new AppStore(mem.platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  const daemon = legacyDaemon(cleanups);
  daemon.features.push(...features);
  render(<App store={store} />);
  await act(() => store.addHost({ name: "alfa", url: daemon.url, token: TOKEN }));
  await settle(() => store.getState().hosts[0]?.hostInfo != null);
  return { store, daemon, mem };
}

describe("precisa-de-voce: a paused loop and a team the quota paused", () => {
  test("a loop the daemon paused notifies and waits in Precisa de você, where Soltar o par frees it", async () => {
    const { store, daemon, mem } = await open();
    daemon.messaging.paused = ["h/s1|h/s2"];
    daemon.messaging.policy = { exceptions: [{ from: "x" }] };
    await act(async () => {
      daemon.push(LOOP);
    });
    await settle(() => mem.notifications.length > 0);
    expect(mem.notifications).toContainEqual({ title: "Laço pausado", body: LOOP.message });
    await act(async () => {
      store.router.push({ name: "needs-you" });
    });
    await click(/Laço pausado: h\/s1 e h\/s2/);
    expect(screen.queryByText(LOOP.message)).not.toBeNull();
    await click("Soltar o par");
    await settle(() => daemon.commands.some((c) => c.type === "messaging.rules.set"));
    expect(daemon.commands.find((c) => c.type === "messaging.rules.set")?.payload).toEqual({
      policy: { exceptions: [{ from: "x" }] },
      unpause: ["h/s1|h/s2"],
    });
    await settle(() => screen.queryByRole("button", { name: /Laço pausado/ }) === null);
    expect(screen.queryByRole("button", { name: /Laço pausado/ })).toBeNull();
  });

  test("a pair paused again waits once, and freeing it leaves the other pairs waiting", async () => {
    const { store, daemon } = await open();
    await act(async () => {
      daemon.push(LOOP);
      daemon.push({ ...LOOP, from: "h/s2", to: "h/s1" });
      daemon.push({ ...LOOP, from: "h/s3", to: "h/s4", message: "outro laço" });
    });
    await settle(() => store.getState().loopAlerts.length === 2);
    expect(store.getState().loopAlerts.map((a) => `${a.from}>${a.to}`)).toEqual([
      "h/s2>h/s1",
      "h/s3>h/s4",
    ]);
    await act(() => store.releaseLoop(store.getState().loopAlerts[0] as never));
    expect(store.getState().loopAlerts.map((a) => a.from)).toEqual(["h/s3"]);
  });

  test("a team the quota paused notifies with the reason, and Times says it was the quota", async () => {
    const { store, daemon, mem } = await open();
    const team = {
      id: "t1",
      name: "login",
      projectId: "p1",
      goal: "revisar",
      coordinator: null,
      members: [],
      checks: [],
      state: "paused",
      pausedBy: "quota",
      instructionsVersion: "1",
      createdAt: "2026-10-30T12:00:00.000Z",
    };
    daemon.messaging.teams = [team];
    await act(async () => {
      daemon.push({ type: "teams.updated", team, reason: "a cota do plano passou do limite" });
    });
    await settle(() => mem.notifications.length > 0);
    expect(mem.notifications).toContainEqual({
      title: "Time login",
      body: "a cota do plano passou do limite",
    });
    await act(async () => {
      store.router.push({ name: "teams" });
    });
    await settle(() => screen.queryByText("pausado pela cota") !== null);
    expect(screen.queryByText("pausado pela cota")).not.toBeNull();
  });
});
