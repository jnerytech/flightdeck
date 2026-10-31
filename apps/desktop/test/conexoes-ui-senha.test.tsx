import { afterEach, describe, expect, setDefaultTimeout, spyOn, test } from "bun:test";
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

const SECRET = "hunter2-askpass-test-secret";

const request = (requestId: string, kind: "password" | "passphrase" = "password") => ({
  type: "askpass.request",
  requestId,
  targetId: "t1",
  targetName: "vps",
  kind,
  secretRef: null,
  prompt: "deploy@vps's password:",
});

async function open(feature = true) {
  const d = sshDaemon(cleanups, { targets: [sshTarget({ id: "t1", name: "vps" })], feature });
  const platform = memoryPlatform(false, "pt-BR");
  const store = new AppStore(platform.platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  await store.addHost({ name: "pc", url: d.url, token: TOKEN });
  render(<App store={store} />);
  await settle(() => d.sent("askpass.watch").length > 0 || !feature);
  await act(() => Bun.sleep(30));
  return { d, store, platform };
}

const ask = async (d: Awaited<ReturnType<typeof open>>["d"], frame: unknown) => {
  await act(async () => {
    d.push(frame);
  });
  await act(() => Bun.sleep(30));
};

const dialog = () => screen.queryByRole("alertdialog") ?? screen.queryByRole("dialog");

const click = async (name: string) => {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
  await act(() => Bun.sleep(30));
};

describe("conexoes-ui: ssh asks for a password", () => {
  test("the app follows the askpass requests of a host that announces ssh, and of no other", async () => {
    const { d } = await open();
    expect(d.sent("askpass.watch")).toHaveLength(1);
    cleanup();
    const other = await open(false);
    expect(other.d.sent("askpass.watch")).toEqual([]);
  });

  test("a request opens a dialog with the prompt and a masked field, and the answer goes back with its request id", async () => {
    const { d } = await open();
    await ask(d, request("r1"));
    expect(dialog()).not.toBeNull();
    expect(screen.queryByText("Senha de vps")).not.toBeNull();
    expect(screen.queryByText("deploy@vps's password:")).not.toBeNull();
    const field = screen.queryByLabelText("Senha") as HTMLInputElement | null;
    expect(field?.type).toBe("password");
    await act(async () => {
      fireEvent.change(field as HTMLElement, { target: { value: SECRET } });
    });
    await click("Enviar");
    expect(d.sent("askpass.answer")).toEqual([{ requestId: "r1", secret: SECRET }]);
    expect(dialog()).toBeNull();
  });

  test("cancelling answers with nothing, so ssh fails at once", async () => {
    const { d } = await open();
    await ask(d, request("r1"));
    await click("Cancelar");
    expect(d.sent("askpass.answer")).toEqual([{ requestId: "r1", secret: null }]);
    expect(dialog()).toBeNull();
  });

  test("a key passphrase has its own title and label", async () => {
    const { d } = await open();
    await ask(d, request("r2", "passphrase"));
    expect(screen.queryByText("Frase da chave de vps")).not.toBeNull();
    expect(screen.queryByLabelText("Frase")).not.toBeNull();
  });

  test("requests are answered one at a time, in order", async () => {
    const { d } = await open();
    await ask(d, request("r1"));
    await ask(d, request("r2"));
    expect(screen.queryAllByLabelText("Senha")).toHaveLength(1);
    await click("Cancelar");
    expect(d.sent("askpass.answer")).toEqual([{ requestId: "r1", secret: null }]);
    expect(screen.queryByLabelText("Senha")).not.toBeNull();
    await click("Cancelar");
    expect(d.sent("askpass.answer").map((a) => a.requestId)).toEqual(["r1", "r2"]);
  });

  test("the secret is never in the store, the storage, the page or the logs", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      spyOn(console, m),
    );
    const { d, store, platform } = await open();
    await ask(d, request("r1"));
    const field = screen.queryByLabelText("Senha");
    expect(field).not.toBeNull();
    await act(async () => {
      fireEvent.change(field as HTMLElement, { target: { value: SECRET } });
    });
    await click("Enviar");
    expect(d.sent("askpass.answer")).toEqual([{ requestId: "r1", secret: SECRET }]);
    expect(JSON.stringify(store.getState())).not.toContain(SECRET);
    expect(platform.platform.storage.getItem("flightdeck.hosts") ?? "").not.toContain(SECRET);
    expect(document.body.innerHTML).not.toContain(SECRET);
    for (const spy of spies) expect(JSON.stringify(spy.mock.calls)).not.toContain(SECRET);
    // The only command that carries it is the answer.
    expect(JSON.stringify(d.commands.filter((c) => c.type !== "askpass.answer"))).not.toContain(
      SECRET,
    );
    for (const spy of spies) spy.mockRestore();
  });

  test("the form offers password authentication, which keeps no reference to the password", async () => {
    const { d } = await open();
    await click("Conexões");
    await click("Novo destino");
    const fill = async (label: string, value: string) => {
      const field = screen.queryByLabelText(label);
      expect(field).not.toBeNull();
      await act(async () => {
        fireEvent.change(field as HTMLElement, { target: { value } });
      });
    };
    await fill("Nome", "box");
    await fill("Host", "box.example.com");
    await fill("Usuário", "me");
    await fill("Autenticação", "password");
    expect(screen.queryByLabelText("Arquivo de chave")).toBeNull();
    await click("Salvar destino");
    expect(d.sent("ssh.save").at(-1)).toMatchObject({ auth: "password", secretRef: null });
  });
  test("a host that refuses to be followed for askpass stays online and quiet", async () => {
    const d = sshDaemon(cleanups, {
      targets: [sshTarget({ id: "t1", name: "vps" })],
      refuse: ["askpass.watch"],
    });
    const store = new AppStore(memoryPlatform(false, "pt-BR").platform, { baseDelayMs: 60_000 });
    cleanups.push(() => store.dispose());
    await store.addHost({ name: "pc", url: d.url, token: TOKEN });
    render(<App store={store} />);
    await settle(() => d.sent("askpass.watch").length > 0);
    await act(() => Bun.sleep(30));
    expect(store.getState().hosts[0]?.status).toBe("online");
    expect(store.getState().notices).toEqual([]);
  });
});
