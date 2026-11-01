import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { hubRows } from "../src/lib/hub.ts";
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

const BLOCKED = {
  id: "7c5dcf5d",
  name: "faxina",
  cwd: "/work/app",
  state: "blocked",
  status: "waiting",
  waitingFor: "permission prompt",
  pid: 4242,
  claudeSessionId: "c1",
  startedAt: 1_793_534_400_000,
  costUsd: 0.5,
};
const DONE = {
  id: "a1b2c3d4",
  name: null,
  cwd: "/work/relatorio",
  state: "done",
  status: null,
  waitingFor: null,
  pid: null,
  claudeSessionId: null,
  startedAt: 1_793_534_000_000,
  costUsd: null,
};

async function open(features = ["bg", "terminal"], sessions: unknown[] = [BLOCKED, DONE]) {
  const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  const daemon = legacyDaemon(cleanups);
  daemon.features.push(...features);
  daemon.bg.list = { supported: true, sessions };
  render(<App store={store} />);
  const hostId = await act(() => store.addHost({ name: "alfa", url: daemon.url, token: TOKEN }));
  await settle(() => store.getState().hosts[0]?.hostInfo != null);
  return { store, daemon, hostId };
}

describe("bg-ui: the hub", () => {
  test("the background sessions are rows of the origin segundo plano, with the state the listing gives", async () => {
    const { store, hostId } = await open();
    await act(async () => {
      await store.loadBackground(hostId);
    });
    const rows = hubRows(store.getState()).filter((r) => r.origin === "background");
    expect(rows.map((r) => [r.title, r.state, r.claudeSessionId, r.cwd])).toEqual([
      ["faxina", "needs_you", "c1", "/work/app"],
      ["relatorio", "idle", null, "/work/relatorio"],
    ]);
    // A host that does not offer it, or a claude with none, adds nothing.
    expect(store.getState().background[hostId]?.supported).toBe(true);
  });

  test("the rows show the badge and the origin filter keeps only them", async () => {
    const { store } = await open();
    await act(async () => {
      store.router.push({ name: "hub" });
    });
    await settle(() => screen.queryByRole("listitem", { name: "faxina" }) !== null);
    const row = screen.queryByRole("listitem", { name: "faxina" }) as HTMLElement;
    expect(row.textContent).toContain("segundo plano");
    const origin = screen.queryByLabelText("Origem") as HTMLSelectElement;
    expect([...origin.options].map((o) => o.textContent)).toContain("Segundo plano");
    await act(async () => {
      fireEvent.change(origin, { target: { value: "background" } });
    });
    expect(screen.queryByRole("listitem", { name: "faxina" })).not.toBeNull();
    expect(screen.queryByRole("listitem", { name: "relatorio" })).not.toBeNull();
  });
});

describe("bg-ui: the actions of a session", () => {
  const panel = () => screen.queryByRole("region", { name: "Sessão em segundo plano" });
  async function openPanel(features?: string[]) {
    const ctx = await open(features);
    await act(async () => {
      await ctx.store.loadBackground(ctx.hostId);
      ctx.store.router.push({ name: "external", host: ctx.hostId, claudeSessionId: "c1" });
    });
    await settle(() => panel() !== null);
    return ctx;
  }

  test("a session that is in the listing has a panel with its state, what it waits for and its cost", async () => {
    await openPanel();
    expect(panel()?.textContent).toContain("esperando você");
    expect(panel()?.textContent).toContain("permission prompt");
    expect(panel()?.textContent).toContain("US$ 0.50");
  });

  test("Parar and Reiniciar ask the host, Trazer para o terminal opens claude attach in a tab", async () => {
    const { daemon, store } = await openPanel();
    await click("Parar");
    await click("Reiniciar");
    await click("Trazer para o terminal");
    const asked = daemon.commands.filter(
      (c) => c.type.startsWith("bg.") || c.type === "terminal.open",
    );
    expect(asked.map((c) => [c.type, c.payload])).toEqual([
      ["bg.list", {}],
      ["bg.stop", { id: "7c5dcf5d" }],
      ["bg.respawn", { id: "7c5dcf5d" }],
      [
        "terminal.open",
        { cwd: "/work/app", command: ["claude", "attach", "7c5dcf5d"], cols: 80, rows: 24 },
      ],
    ]);
    expect(store.tabs.tabs.some((t) => t.router.current.name === "terminal")).toBe(true);
  });

  test("a message goes to the host, and a refusal is said in the app's language", async () => {
    const { daemon, store } = await openPanel();
    const field = screen.queryByLabelText("Mensagem") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(field, { target: { value: "continue" } });
    });
    await click("Enviar");
    expect(daemon.commands.find((c) => c.type === "bg.message")?.payload).toEqual({
      id: "7c5dcf5d",
      text: "continue",
    });
    daemon.bg.refused.set("bg.message", { reason: "bg_no_message_path" });
    await act(async () => {
      fireEvent.change(field, { target: { value: "de novo" } });
    });
    await click("Enviar");
    await settle(() => store.getState().notices.length > 0);
    expect(store.getState().notices[0]).toMatchObject({ reason: "bg_no_message_path" });
    await settle(() => screen.queryByText(/Não dá para mandar mensagem/) !== null);
    expect(screen.queryByText(/Não dá para mandar mensagem/)).not.toBeNull();
  });

  test("a host without the terminal does not offer to bring it there", async () => {
    await openPanel(["bg"]);
    expect(screen.queryByRole("button", { name: "Trazer para o terminal" })).toBeNull();
  });
});

describe("bg-ui: Iniciar em segundo plano", () => {
  async function newSession(features?: string[]) {
    const ctx = await open(features, []);
    await act(async () => {
      ctx.store.router.push({ name: "new-session", host: ctx.hostId });
    });
    await settle(() => screen.queryByLabelText("Prompt") !== null);
    return ctx;
  }

  test("the form has the option only on a host with bg, and then starts the session in the background", async () => {
    const { daemon, store } = await newSession();
    const box = screen.queryByLabelText("Iniciar em segundo plano") as HTMLInputElement;
    expect(box).not.toBeNull();
    await act(async () => {
      fireEvent.change(screen.queryByLabelText("Prompt") as HTMLTextAreaElement, {
        target: { value: "limpe os logs" },
      });
      fireEvent.click(box);
    });
    await act(async () => {
      fireEvent.submit(
        screen.queryByRole("button", { name: "Criar sessão" })?.closest("form") as HTMLFormElement,
      );
    });
    await settle(() => daemon.commands.some((c) => c.type === "bg.start"));
    const started = daemon.commands.find((c) => c.type === "bg.start")?.payload as {
      prompt: string;
    };
    expect(started.prompt).toBe("limpe os logs");
    expect(daemon.commands.some((c) => c.type === "session.create")).toBe(false);
    // The listing is read again, and the hub shows it.
    await settle(() => store.router.current.name === "hub");
    expect(store.router.current.name).toBe("hub");
  });

  test("a host without bg has no such option", async () => {
    await newSession([]);
    expect(screen.queryByLabelText("Iniciar em segundo plano")).toBeNull();
  });
});
