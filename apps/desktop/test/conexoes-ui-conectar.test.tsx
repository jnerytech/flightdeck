import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { SshHostKeyCheck } from "@flightdeck/protocol";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform, TOKEN } from "./fixtures.ts";
import { sshDaemon, sshTarget } from "./ssh-daemon.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(20_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function settle(check: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await act(() => Bun.sleep(10));
}

const VPS = sshTarget({ id: "t1", name: "vps", tags: ["prod"] });

/** The app on the Conexões screen of a daemon whose server key check answers `hostKey`. */
async function open(hostKey?: SshHostKeyCheck) {
  const d = sshDaemon(cleanups, { targets: [VPS], ...(hostKey ? { hostKey } : {}) });
  const store = new AppStore(memoryPlatform(false, "pt-BR").platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  const hostId = await store.addHost({ name: "pc", url: d.url, token: TOKEN });
  render(<App store={store} />);
  await settle(() => screen.queryByRole("button", { name: "Conexões" }) !== null);
  await act(async () => {
    fireEvent.click(screen.queryByRole("button", { name: "Conexões" }) as HTMLElement);
  });
  await settle(() => screen.queryByRole("button", { name: "Conectar vps" }) !== null);
  return { d, store, hostId };
}

const click = async (name: string) => {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
  await act(() => Bun.sleep(30));
};

describe("conexoes-ui: connect", () => {
  test("with the server key pinned, Conectar opens the terminal of the connection", async () => {
    const { d, store, hostId } = await open();
    await click("Conectar vps");
    await settle(() => store.router.current.name === "terminal");
    expect(d.sent("ssh.hostkey.check")).toEqual([{ targetId: "t1" }]);
    expect(d.sent("ssh.connect")).toEqual([{ targetId: "t1", cols: 80, rows: 24 }]);
    expect(store.router.current).toEqual({
      name: "terminal",
      host: hostId,
      terminalId: "term-ssh-1",
    });
  });

  test("a server key never seen shows its fingerprint and connects only after it is confirmed", async () => {
    const { d, store, hostId } = await open({
      status: "unknown",
      fingerprint: "SHA256:newkey",
      pinned: null,
    });
    await click("Conectar vps");
    expect(screen.queryByText("SHA256:newkey")).not.toBeNull();
    expect(d.sent("ssh.connect")).toEqual([]);
    await click("Confirmar chave do servidor");
    await settle(() => store.router.current.name === "terminal");
    expect(d.sent("ssh.hostkey.confirm")).toEqual([
      { targetId: "t1", fingerprint: "SHA256:newkey" },
    ]);
    expect(d.sent("ssh.connect")).toHaveLength(1);
    expect(store.router.current).toMatchObject({ name: "terminal", host: hostId });
  });

  test("cancelling the fingerprint dialog neither confirms nor connects", async () => {
    const { d, store } = await open({
      status: "unknown",
      fingerprint: "SHA256:newkey",
      pinned: null,
    });
    await click("Conectar vps");
    await click("Cancelar");
    expect(d.sent("ssh.hostkey.confirm")).toEqual([]);
    expect(d.sent("ssh.connect")).toEqual([]);
    expect(store.router.current.name).toBe("connections");
  });

  test("a changed server key blocks the connection and shows the old and the new fingerprint", async () => {
    const { d, store } = await open({
      status: "changed",
      fingerprint: "SHA256:new",
      pinned: "SHA256:old",
    });
    await click("Conectar vps");
    expect(screen.queryByText("SHA256:old")).not.toBeNull();
    expect(screen.queryByText("SHA256:new")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Confirmar chave do servidor" })).toBeNull();
    expect(d.sent("ssh.connect")).toEqual([]);
    expect(store.router.current.name).toBe("connections");
  });
});
