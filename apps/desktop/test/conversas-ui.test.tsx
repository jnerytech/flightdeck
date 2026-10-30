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

const message = (over: Record<string, unknown>) => ({
  id: "m1",
  fromSession: "s1",
  fromHost: "h",
  toSession: "s2",
  toHost: "h",
  text: "pode revisar o login?",
  status: "delivered",
  reason: null,
  createdAt: "2026-10-30T12:00:00.000Z",
  deliveredAt: "2026-10-30T12:00:01.000Z",
  teamId: null,
  kind: "session",
  ...over,
});

/** The app on a daemon that announces messaging, with two messages, on Conversas. */
async function open(features = ["messaging"]) {
  const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  const daemon = legacyDaemon(cleanups);
  daemon.features.push(...features);
  daemon.messaging.messages = [
    message({}),
    message({
      id: "m2",
      status: "refused",
      reason: "laço: o par está pausado",
      text: "de novo",
      createdAt: "2026-10-30T12:05:00.000Z",
      deliveredAt: null,
      teamId: "t1",
    }),
  ];
  render(<App store={store} />);
  await act(() => store.addHost({ name: "alfa", url: daemon.url, token: TOKEN }));
  await settle(() => store.getState().hosts[0]?.hostInfo != null);
  const list = () => screen.queryByRole("list", { name: "Mensagens entre sessões" });
  return { store, daemon, list };
}

describe("conversas-ui: the messages between sessions", () => {
  test("Conversas is in the sidebar only when a host has messaging", async () => {
    await open([]);
    expect(screen.queryByRole("button", { name: "Conversas" })).toBeNull();
    cleanup();
    await open();
    expect(screen.queryByRole("button", { name: "Conversas" })).not.toBeNull();
  });

  test("the timeline lists the messages newest first, with the host, the state and why one was refused", async () => {
    const { list } = await open();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Conversas" }));
    });
    await settle(() => (list()?.children.length ?? 0) === 2);
    const [newest, oldest] = [...(list()?.children ?? [])].map((li) => li.textContent ?? "");
    expect(newest).toContain("de novo");
    expect(newest).toContain("Recusada");
    expect(newest).toContain("laço: o par está pausado");
    expect(oldest).toContain("pode revisar o login?");
    expect(oldest).toContain("Entregue");
    expect(oldest).toContain("alfa");
  });

  test("the filters narrow by state and by team", async () => {
    const { list } = await open();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Conversas" }));
    });
    await settle(() => (list()?.children.length ?? 0) === 2);
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Estado"), { target: { value: "refused" } });
    });
    expect(list()?.children.length).toBe(1);
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Estado"), { target: { value: "" } });
      fireEvent.change(screen.getByLabelText("Filtrar mensagens"), { target: { value: "t1" } });
    });
    expect(list()?.children.length).toBe(1);
    expect(list()?.textContent).toContain("de novo");
  });

  test("a messages.updated frame refreshes the timeline", async () => {
    const { daemon, list } = await open();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Conversas" }));
    });
    await settle(() => (list()?.children.length ?? 0) === 2);
    daemon.messaging.messages = [
      ...daemon.messaging.messages,
      message({ id: "m3", text: "nova", createdAt: "2026-10-30T12:10:00.000Z" }),
    ];
    await act(async () => {
      daemon.push({ type: "messages.updated", message: message({ id: "m3", text: "nova" }) });
    });
    await settle(() => (list()?.children.length ?? 0) === 3);
    expect(list()?.children.length).toBe(3);
  });

  test("Abrir a sessão opens the message's recipient", async () => {
    const { store, daemon, list } = await open();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Conversas" }));
    });
    await settle(() => (list()?.children.length ?? 0) === 2);
    const oldest = list()?.children[1] as HTMLElement;
    await act(async () => {
      fireEvent.click(within(oldest).getByRole("button", { name: "Abrir a sessão" }));
    });
    expect(store.router.current).toMatchObject({ name: "external", claudeSessionId: "s2" });
    // A recipient that is a managed session of the host opens as one.
    await act(async () => {
      daemon.push({
        type: "event",
        sessionId: "s1",
        seq: 1,
        ts: "2026-10-30T12:00:00.000Z",
        event: {
          type: "session.summary",
          sessionId: "s1",
          name: "a1",
          cwd: "/p",
          status: "idle",
          pendingPermissions: [],
          updatedAt: "2026-10-30T12:00:00.000Z",
        },
      });
    });
    await settle(() => store.getState().hosts[0]?.sessions.length === 1);
    daemon.messaging.messages = [message({ id: "m9", toSession: "s1" })];
    await act(async () => {
      daemon.push({ type: "messages.updated", message: message({ id: "m9", toSession: "s1" }) });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Conversas" }));
    });
    await settle(() => (list()?.children.length ?? 0) === 1);
    await act(async () => {
      fireEvent.click(
        within(list()?.children[0] as HTMLElement).getByRole("button", { name: "Abrir a sessão" }),
      );
    });
    expect(store.router.current).toMatchObject({ name: "session", id: "s1" });
  });
});
