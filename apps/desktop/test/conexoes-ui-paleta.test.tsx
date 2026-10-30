import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
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

const dialog = () => screen.queryByRole("dialog", { name: "Busca global" });
const options = () =>
  (dialog() ? within(dialog() as HTMLElement).queryAllByRole("option") : []).map(
    (option) => option.getAttribute("aria-label") ?? "",
  );

/** The app on its first screen, over a daemon with two destinos. */
async function open() {
  const d = sshDaemon(cleanups, {
    targets: [
      sshTarget({ id: "t1", name: "vps", tags: ["prod"] }),
      sshTarget({ id: "t2", name: "lab" }),
    ],
  });
  const store = new AppStore(memoryPlatform(false, "pt-BR").platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  const hostId = await store.addHost({ name: "pc", url: d.url, token: TOKEN });
  render(<App store={store} />);
  await settle(() => screen.queryByRole("button", { name: "Conexões" }) !== null);
  return { d, store, hostId };
}

async function openPalette() {
  await act(async () => {
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  });
  expect(dialog()).not.toBeNull();
}

async function type(text: string) {
  const field = screen.queryByLabelText("Buscar no histórico") as HTMLInputElement | null;
  expect(field).not.toBeNull();
  await act(async () => {
    fireEvent.change(field as HTMLInputElement, { target: { value: text } });
  });
}

describe("conexoes-ui: the palette", () => {
  test('Ctrl+K lists "Conectar a <name>" for each destino and filters them as you type', async () => {
    await open();
    await openPalette();
    await settle(() => options().includes("Conectar a vps"));
    expect(options()).toContain("Conectar a vps");
    expect(options()).toContain("Conectar a lab");
    await type("vps");
    expect(options()).toContain("Conectar a vps");
    expect(options()).not.toContain("Conectar a lab");
  });

  test("choosing one connects to it: the server key is checked and the terminal opens", async () => {
    const { d, store, hostId } = await open();
    await openPalette();
    await settle(() => options().includes("Conectar a vps"));
    await type("vps");
    const option = within(dialog() as HTMLElement).queryByRole("option", {
      name: "Conectar a vps",
    });
    expect(option).not.toBeNull();
    await act(async () => {
      fireEvent.click(option as HTMLElement);
    });
    await settle(() => store.router.current.name === "terminal");
    expect(d.sent("ssh.hostkey.check")).toEqual([{ targetId: "t1" }]);
    expect(d.sent("ssh.connect")).toEqual([{ targetId: "t1", cols: 80, rows: 24 }]);
    expect(store.router.current).toEqual({
      name: "terminal",
      host: hostId,
      terminalId: "term-ssh-1",
    });
  });
});
