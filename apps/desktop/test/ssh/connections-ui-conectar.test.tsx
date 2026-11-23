import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { SshHostKeyCheck } from "@flightdeck/protocol";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform, TOKEN } from "../fixtures.ts";
import { uiIdle, waiter } from "../wait.ts";
import { sshDaemon, sshTarget } from "./daemon.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { App } = await import("../../src/app/App.tsx");

setDefaultTimeout(20_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const settle = waiter(4000);

const VPS = sshTarget({ id: "t1", name: "vps", tags: ["prod"] });

/** The app on the Conexões screen of a daemon whose server key check answers `hostKey`. */
async function open(hostKey?: SshHostKeyCheck) {
  const d = sshDaemon(cleanups, { targets: [VPS], ...(hostKey ? { hostKey } : {}) });
  const { platform } = memoryPlatform(false, "pt-BR");
  const store = new AppStore(platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  const hostId = await store.roster.add({ name: "pc", url: d.url, token: TOKEN });
  render(<App store={store} />);
  await settle(() => screen.queryByRole("button", { name: "SSH" }) !== null);
  await act(async () => {
    fireEvent.click(screen.queryByRole("button", { name: "SSH" }) as HTMLElement);
  });
  await settle(() => screen.queryByRole("button", { name: "Conectar vps" }) !== null);
  return { d, store, hostId, platform };
}

const click = async (name: string) => {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
  await uiIdle();
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

  test("a changed server key says how to go on, and Editar destino opens that destino without trusting the key", async () => {
    const { d, store } = await open({
      status: "changed",
      fingerprint: "SHA256:new",
      pinned: "SHA256:old",
    });
    await click("Conectar vps");
    expect(screen.queryByText(/Esquecer chave do servidor/)).not.toBeNull();
    await click("Editar destino");
    await settle(() => screen.queryByRole("button", { name: "Salvar destino" }) !== null);
    expect(screen.queryByText("SHA256:new")).toBeNull();
    expect(d.sent("ssh.hostkey.confirm")).toEqual([]);
    expect(d.sent("ssh.connect")).toEqual([]);
    expect(store.router.current.name).toBe("connections");
  });

  test("closing the form that Editar destino opened puts the focus on that destino's Editar (#4333)", async () => {
    await open({ status: "changed", fingerprint: "SHA256:new", pinned: "SHA256:old" });
    await click("Conectar vps");
    await click("Editar destino");
    await settle(() => screen.queryByRole("button", { name: "Salvar destino" }) !== null);
    await click("Cancelar");
    const edit = screen.queryByRole("button", { name: "Editar vps" });
    expect(edit).not.toBeNull();
    expect(document.activeElement === edit).toBe(true);
  });

  test("a changed server key names its two values Chave salva and Chave oferecida agora", async () => {
    await open({ status: "changed", fingerprint: "SHA256:new", pinned: "SHA256:old" });
    await click("Conectar vps");
    expect(screen.queryByText("Chave salva")).not.toBeNull();
    expect(screen.queryByText("Chave oferecida agora")).not.toBeNull();
  });

  test("a server key never seen labels its fingerprint and Copiar impressão digital copies it", async () => {
    const { platform } = await open({
      status: "unknown",
      fingerprint: "SHA256:newkey",
      pinned: null,
    });
    const copied: string[] = [];
    platform.copyText = async (text) => {
      copied.push(text);
    };
    await click("Conectar vps");
    expect(screen.queryByText("Impressão digital (SHA256)")).not.toBeNull();
    await click("Copiar impressão digital");
    expect(copied).toEqual(["SHA256:newkey"]);
  });

  test("a changed server key copies the key offered now", async () => {
    const { platform } = await open({
      status: "changed",
      fingerprint: "SHA256:new",
      pinned: "SHA256:old",
    });
    const copied: string[] = [];
    platform.copyText = async (text) => {
      copied.push(text);
    };
    await click("Conectar vps");
    await click("Copiar impressão digital");
    expect(copied).toEqual(["SHA256:new"]);
  });
});
