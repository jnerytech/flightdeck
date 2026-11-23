import { afterEach, describe, expect, setDefaultTimeout, spyOn, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform, TOKEN } from "../fixtures.ts";
import { settleMaybe, uiIdle, waiter } from "../wait.ts";
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
  await store.roster.add({ name: "pc", url: d.url, token: TOKEN });
  render(<App store={store} />);
  await settle(() => d.sent("askpass.watch").length > 0 || !feature);
  await uiIdle();
  return { d, store, platform };
}

const ask = async (d: Awaited<ReturnType<typeof open>>["d"], frame: unknown) => {
  await act(async () => {
    d.push(frame);
  });
  await uiIdle();
};

const dialog = () => screen.queryByRole("alertdialog") ?? screen.queryByRole("dialog");

const click = async (name: string) => {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
  await uiIdle();
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

  const type = async (value: string) => {
    const field = screen.queryByLabelText("Senha");
    expect(field).not.toBeNull();
    await act(async () => {
      fireEvent.change(field as HTMLElement, { target: { value } });
    });
    return field as HTMLInputElement;
  };

  test("Enter in the field sends the answer once, and on an empty field sends nothing (#4331)", async () => {
    const { d } = await open();
    await ask(d, request("r1"));
    const field = await type("");
    await act(async () => {
      fireEvent.keyDown(field, { key: "Enter" });
    });
    await uiIdle();
    expect(d.sent("askpass.answer")).toEqual([]);
    expect(dialog()).not.toBeNull();
    await type(SECRET);
    await act(async () => {
      fireEvent.keyDown(field, { key: "Enter" });
    });
    await uiIdle();
    expect(d.sent("askpass.answer")).toEqual([{ requestId: "r1", secret: SECRET }]);
    expect(dialog()).toBeNull();
  });

  test("a held Enter sends once, and an Enter that only confirms an IME composition sends nothing (#4331)", async () => {
    const { d } = await open();
    await ask(d, request("r1"));
    const field = await type(SECRET);
    await act(async () => {
      fireEvent.keyDown(field, { key: "Enter", isComposing: true });
      fireEvent.keyDown(field, { key: "Process", keyCode: 229 });
      fireEvent.keyDown(field, { key: "Enter", keyCode: 229 });
    });
    expect(d.sent("askpass.answer")).toEqual([]);
    await act(async () => {
      fireEvent.keyDown(field, { key: "Enter" });
      fireEvent.keyDown(field, { key: "Enter", repeat: true });
      fireEvent.keyDown(field, { key: "Enter" });
    });
    await uiIdle();
    expect(d.sent("askpass.answer")).toEqual([{ requestId: "r1", secret: SECRET }]);
  });

  test("the shown field is out of spellcheck, and the focus stays in the field after the toggle (#4331)", async () => {
    const { d } = await open();
    await ask(d, request("r1"));
    const field = await type(SECRET);
    await click("Mostrar o que foi digitado");
    expect(field.getAttribute("spellcheck")).toBe("false");
    expect(document.activeElement === field).toBe(true);
  });

  test("a show control lets the person check what was typed, and hides it again (#4331)", async () => {
    const { d } = await open();
    await ask(d, request("r1"));
    const field = await type(SECRET);
    const show = () => screen.queryByRole("button", { name: "Mostrar o que foi digitado" });
    expect(show()).not.toBeNull();
    expect(show()?.getAttribute("aria-pressed")).toBe("false");
    expect(field.type).toBe("password");
    await click("Mostrar o que foi digitado");
    expect(show()?.getAttribute("aria-pressed")).toBe("true");
    expect(field.type).toBe("text");
    await click("Mostrar o que foi digitado");
    expect(show()?.getAttribute("aria-pressed")).toBe("false");
    expect(field.type).toBe("password");
  });

  test("the next request starts hidden, whatever the last one showed (#4331)", async () => {
    const { d } = await open();
    await ask(d, request("r1"));
    await click("Mostrar o que foi digitado");
    expect((screen.queryByLabelText("Senha") as HTMLInputElement).type).toBe("text");
    await ask(d, request("r2"));
    await click("Cancelar");
    const field = screen.queryByLabelText("Senha") as HTMLInputElement | null;
    expect(field?.type).toBe("password");
    expect(
      screen
        .queryByRole("button", { name: "Mostrar o que foi digitado" })
        ?.getAttribute("aria-pressed"),
    ).toBe("false");
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
    await click("SSH");
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
    await store.roster.add({ name: "pc", url: d.url, token: TOKEN });
    render(<App store={store} />);
    await settle(() => d.sent("askpass.watch").length > 0);
    await settle(() => store.getState().hosts[0]?.status === "online");
    expect(store.getState().hosts[0]?.status).toBe("online");
    expect(store.getState().notices).toEqual([]);
  });
});

describe("conexoes-ui: where the focus goes when the askpass dialog closes (#4331)", () => {
  const opener = async () => {
    const button = screen.queryByRole("button", { name: "SSH" }) as HTMLElement | null;
    expect(button).not.toBeNull();
    button?.focus();
    expect(document.activeElement === button).toBe(true);
    return button as HTMLElement;
  };

  test("an answer, a cancel and Escape each give the focus back to what had it when the request came", async () => {
    const { d } = await open();
    const button = await opener();
    const closers: Array<[string, () => Promise<void>]> = [
      ["answer", async () => click("Enviar")],
      ["cancel", async () => click("Cancelar")],
      [
        "escape",
        async () => {
          await act(async () => {
            fireEvent.keyDown(dialog() as HTMLElement, { key: "Escape" });
          });
          await uiIdle();
        },
      ],
    ];
    const restored: Record<string, boolean> = {};
    for (const [index, [name, close]] of closers.entries()) {
      await ask(d, request(`r${index}`));
      expect(document.activeElement === button).toBe(false);
      await act(async () => {
        fireEvent.change(screen.queryByLabelText("Senha") as HTMLElement, {
          target: { value: SECRET },
        });
      });
      await close();
      await settleMaybe(() => dialog() === null);
      await settleMaybe(() => document.activeElement === button);
      restored[name] = document.activeElement === button;
    }
    expect(restored).toEqual({ answer: true, cancel: true, escape: true });
  });

  test("when what had the focus is gone, the focus goes to the main area, not to the page's end", async () => {
    const { d } = await open();
    const gone = document.createElement("button");
    document.body.append(gone);
    gone.focus();
    await ask(d, request("r1"));
    gone.remove();
    await click("Cancelar");
    await settleMaybe(() => dialog() === null);
    await settleMaybe(() => document.activeElement === document.querySelector("main"));
    expect(document.activeElement === document.querySelector("main")).toBe(true);
  });

  test("with two requests queued the focus goes to the second field, and back to the first place only after the last", async () => {
    const { d } = await open();
    const button = await opener();
    await ask(d, request("r1"));
    await ask(d, request("r2"));
    await click("Cancelar");
    await settleMaybe(() => document.activeElement === screen.queryByLabelText("Senha"));
    expect(document.activeElement === screen.queryByLabelText("Senha")).toBe(true);
    await click("Cancelar");
    await settleMaybe(() => dialog() === null);
    await settleMaybe(() => document.activeElement === button);
    expect(document.activeElement === button).toBe(true);
  });
});
