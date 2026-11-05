import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { poll } from "../../daemon/test/helpers.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { waiter } from "./wait.ts";

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
const settle = waiter(6000);

type Daemon = ReturnType<typeof makeDaemon>;

/** Sessions that are running (idle between turns here) on a host. */
async function sessionsOn(d: Daemon, names: string[]) {
  const ids: string[] = [];
  for (const name of names) {
    const { sessionId } = await d.manager.create({
      cwd: d.project,
      prompt: `pedido de ${name}`,
      name,
    });
    await poll(() => d.manager.get(sessionId).status === "idle");
    ids.push(sessionId);
  }
  return ids;
}

/** What a daemon restart leaves: those sessions in `error`, with the code of the restart. */
function interrupt(d: Daemon, ids: string[]) {
  for (const sessionId of ids) {
    d.eventStore.updateSession(sessionId, { status: "error" });
    d.eventStore.appendEvent(sessionId, {
      type: "session.status",
      status: "error",
      reason: "daemon_restarted",
    });
  }
}

/** A host whose daemon was restarted under three running sessions. */
async function restarted(names = ["Revisar o login", "Migrar o banco", "Escrever os testes"]) {
  const d = makeDaemon(cleanups, {});
  const ids = await sessionsOn(d, names);
  interrupt(d, ids);
  return { d, ids };
}

async function connect(d: ReturnType<typeof makeDaemon>, mem = memoryPlatform(false, "en")) {
  const store = new AppStore(mem.platform, { baseDelayMs: 60_000 });
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "alfa", url: d.listen().url, token: TOKEN });
  });
  return { store, mem };
}

const dialog = () => screen.queryByRole("dialog", { name: "Resume interrupted sessions" });
const rows = () => (dialog() ? within(dialog() as HTMLElement).queryAllByRole("checkbox") : []);
const press = async (name: string | RegExp) => {
  const button = within(dialog() as HTMLElement).getByRole("button", { name });
  await act(async () => {
    fireEvent.click(button);
  });
};

describe("retomar-ui: the sessions a restart interrupted are offered in one dialog (issue #150)", () => {
  test("after a restart the dialog lists exactly those sessions, all ticked, and says what resume sends", async () => {
    const { d } = await restarted();
    await connect(d);
    await settle(() => dialog() !== null);
    expect(rows().map((row) => row.getAttribute("aria-label"))).toEqual([
      "Revisar o login",
      "Migrar o banco",
      "Escrever os testes",
    ]);
    expect(rows().every((row) => (row as HTMLInputElement).checked)).toBe(true);
    const text = within(dialog() as HTMLElement);
    expect(text.getByText(/Continue where you left off\./)).toBeTruthy();
    expect(text.getByText(/The original request is not sent again/)).toBeTruthy();
    // The last request of each session is shown with it.
    expect(text.getByText("pedido de Revisar o login")).toBeTruthy();
  });

  test("resuming two of the three leaves the third as it was, and each row says what happened", async () => {
    const { d, ids } = await restarted();
    await connect(d);
    await settle(() => dialog() !== null);
    await act(async () => {
      fireEvent.click(rows()[2] as HTMLElement);
    });
    await press("Resume selected");
    await settle(() => within(dialog() as HTMLElement).queryAllByText("Resumed").length === 2);
    expect(d.manager.get(ids[0] as string).status).not.toBe("error");
    expect(d.manager.get(ids[1] as string).status).not.toBe("error");
    expect(d.manager.get(ids[2] as string).status).toBe("error");
  });

  test("a session that cannot be resumed shows why, with Retry, and the others go on", async () => {
    const { d, ids } = await restarted();
    await connect(d);
    await settle(() => dialog() !== null);
    // Someone resumed the first one in the meantime: the offer is stale for it.
    await d.manager.resume(ids[0] as string);
    await press("Resume selected");
    await settle(() => within(dialog() as HTMLElement).queryAllByText("Resumed").length === 2);
    const failed = within(dialog() as HTMLElement);
    expect(failed.getByText(/Could not resume/)).toBeTruthy();
    expect(failed.getByRole("button", { name: /Retry Revisar o login/ })).toBeTruthy();
  });

  test("Not now closes it and it does not come back on a reconnect; the host page can reopen it", async () => {
    const { d } = await restarted();
    const { store } = await connect(d);
    await settle(() => dialog() !== null);
    await press("Not now");
    expect(dialog()).toBeNull();
    const hostId = store.getState().hosts[0]?.id as string;
    await act(async () => {
      await store.reloadHostInfo(hostId);
    });
    expect(dialog()).toBeNull();
    await act(async () => store.router.push({ name: "host", host: hostId }));
    await settle(
      () => screen.queryByRole("button", { name: /Resume interrupted sessions \(3\)/ }) !== null,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Resume interrupted sessions \(3\)/ }));
    });
    expect(dialog()).not.toBeNull();
  });

  test("Dismiss all removes the offer for good: no dialog, no way to reopen it", async () => {
    const { d } = await restarted();
    const { store } = await connect(d);
    await settle(() => dialog() !== null);
    await press("Dismiss all");
    expect(dialog()).toBeNull();
    const hostId = store.getState().hosts[0]?.id as string;
    await act(async () => store.router.push({ name: "host", host: hostId }));
    await settle(() => screen.queryByText("Resume automatically after a restart") !== null);
    expect(screen.queryByRole("button", { name: /Resume interrupted sessions/ })).toBeNull();
  });

  test("with the automatic setting on, no dialog appears and the sessions are resumed, with a notice listing them", async () => {
    const d = makeDaemon(cleanups, {});
    const ids = await sessionsOn(d, ["Revisar o login", "Migrar o banco"]);
    const { store } = await connect(d);
    const hostId = store.getState().hosts[0]?.id as string;
    await act(async () => store.router.push({ name: "host", host: hostId }));
    await settle(
      () => screen.queryByRole("switch", { name: "Resume automatically after a restart" }) !== null,
    );
    const auto = screen.getByRole("switch", { name: "Resume automatically after a restart" });
    expect(auto.getAttribute("aria-checked")).toBe("false");
    await act(async () => {
      fireEvent.click(auto);
    });
    expect(store.autoResume(hostId)).toBe(true);
    // The daemon restarts and the app reconnects: nothing to click.
    interrupt(d, ids);
    await act(async () => {
      await store.reloadHostInfo(hostId);
    });
    await settle(() => ids.every((id) => d.manager.get(id).status !== "error"));
    expect(dialog()).toBeNull();
    await settle(
      () =>
        screen.queryByText(
          /Resumed 2 sessions after the restart: Revisar o login, Migrar o banco/,
        ) !== null,
    );
  });

  test("a host whose daemon does not announce the offer shows nothing, even with sessions in error", async () => {
    const { d } = await restarted();
    const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 60_000 });
    render(<App store={store} />);
    await act(async () => {
      await store.addHost({
        name: "alfa",
        url: d.listen(0, undefined, ["terminal"]).url,
        token: TOKEN,
      });
    });
    await settle(() => store.getState().hosts[0]?.hostInfo !== null);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(dialog()).toBeNull();
    expect(store.getState().resumeOffers).toEqual({});
  });
});
