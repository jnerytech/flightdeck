import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform, TOKEN } from "./fixtures.ts";
import { type SshDaemonOptions, sshDaemon, sshTarget } from "./ssh-daemon.ts";
import { waiter } from "./wait.ts";

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

const settle = waiter(4000);

/**
 * Two hosts: "pc" keeps the destinos (the first that announces ssh) and "vps" is where some of
 * them must open. `via` tunes the vps daemon.
 */
async function open(via: SshDaemonOptions = {}, vpsOnline = true) {
  const pc = sshDaemon(cleanups);
  const vps = sshDaemon(cleanups, via);
  const store = new AppStore(memoryPlatform(false, "pt-BR").platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  const pcId = await store.addHost({ name: "pc", url: pc.url, token: TOKEN });
  const vpsId = await store.addHost({
    name: "vps",
    url: vpsOnline ? vps.url : "ws://127.0.0.1:9/",
    token: TOKEN,
  });
  const bastion = sshTarget({ id: "b1", name: "bastion", host: "bastion.example.com" });
  const inner = sshTarget({
    id: "i1",
    name: "inner",
    host: "10.0.0.5",
    viaHost: vpsId,
    jump: "b1",
    tags: ["prod"],
  });
  pc.targets.push(bastion, inner);
  render(<App store={store} />);
  await settle(() => screen.queryByRole("button", { name: "Conexões" }) !== null);
  await act(async () => {
    fireEvent.click(screen.queryByRole("button", { name: "Conexões" }) as HTMLElement);
  });
  await settle(() => screen.queryByRole("button", { name: "Conectar inner" }) !== null);
  return { pc, vps, store, pcId, vpsId };
}

const click = async (name: string) => {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
  await act(() => Bun.sleep(40));
};

describe("conexoes-ui: opened by another host", () => {
  test("Conectar opens the terminal on the via host, with a copy of the destino and of its jump saved there first", async () => {
    const { pc, vps, store, vpsId } = await open();
    await click("Conectar inner");
    await settle(() => store.router.current.name === "terminal");
    expect(vps.targets.map((t) => t.name).sort()).toEqual(["bastion", "inner"]);
    const copy = vps.targets.find((t) => t.name === "inner");
    const bastion = vps.targets.find((t) => t.name === "bastion");
    expect(copy).toMatchObject({ host: "10.0.0.5", viaHost: null, jump: bastion?.id });
    expect(vps.sent("ssh.hostkey.check")).toEqual([{ targetId: copy?.id }]);
    expect(vps.sent("ssh.connect")).toEqual([{ targetId: copy?.id, cols: 80, rows: 24 }]);
    expect(pc.sent("ssh.connect")).toEqual([]);
    expect(store.router.current).toEqual({
      name: "terminal",
      host: vpsId,
      terminalId: "term-ssh-1",
    });
  });

  test("connecting again updates the copy instead of adding another", async () => {
    const { vps, store } = await open();
    await click("Conectar inner");
    await settle(() => store.router.current.name === "terminal");
    await act(async () => {
      store.router.push({ name: "connections" });
    });
    await settle(() => screen.queryByRole("button", { name: "Conectar inner" }) !== null);
    await click("Conectar inner");
    expect(vps.targets.map((t) => t.name).sort()).toEqual(["bastion", "inner"]);
  });

  test("a via host that is not connected says so and runs nothing", async () => {
    const { pc, vps } = await open({}, false);
    await click("Conectar inner");
    expect(screen.queryByRole("alert")?.textContent).toBe("O host vps não está conectado.");
    expect(pc.sent("ssh.connect")).toEqual([]);
    expect(vps.sent("ssh.save")).toEqual([]);
  });

  test("a via host without the ssh feature says so and runs nothing", async () => {
    const { pc, vps, store } = await open({ feature: false });
    await click("Conectar inner");
    expect(screen.queryByRole("alert")?.textContent).toBe("O host vps não tem o recurso de SSH.");
    expect(vps.sent("ssh.save")).toEqual([]);
    expect(pc.sent("ssh.connect")).toEqual([]);
    expect(store.router.current.name).toBe("connections");
  });
});
