import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { hubRows } from "../src/lib/hub.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform, TOKEN } from "./fixtures.ts";
import { legacyDaemon } from "./legacy-daemon.ts";
import { sidebarNav } from "./sidebar.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const sidebar = sidebarNav({ act, fireEvent, screen });
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");
const { rowRoute } = await import("../src/ui/Screens.tsx");

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
  daemon.roots.push("/work");
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

  test("a row opens the session's screen when the host knows its Claude session, else it stays in the hub; a state it does not know reads as idle", async () => {
    const { store, hostId } = await open(
      ["bg"],
      [BLOCKED, { ...DONE, state: "something-new", startedAt: null }],
    );
    await act(async () => {
      await store.loadBackground(hostId);
    });
    const rows = hubRows(store.getState()).filter((r) => r.origin === "background");
    expect(rows.map((r) => rowRoute(r).name)).toEqual(["external", "hub"]);
    expect(rows[1]).toMatchObject({ state: "idle", lastActivity: "" });
  });

  test("the rows show the badge and the origin filter keeps only them", async () => {
    const { store } = await open();
    await act(async () => {
      store.router.push({ name: "hub" });
    });
    await settle(() => screen.queryByRole("listitem", { name: "faxina" }) !== null);
    // The origin is in the header of the group, or in the row when the group mixes origins.
    expect(screen.queryByRole("region", { name: "Projeto app" })?.textContent).toContain(
      "segundo plano",
    );
    await sidebar.openFilters();
    const origin = screen.queryByLabelText("Origem") as HTMLSelectElement;
    expect([...origin.options].map((o) => o.textContent)).toContain("Segundo plano");
    await act(async () => {
      fireEvent.change(origin, { target: { value: "background" } });
    });
    expect(screen.queryByRole("listitem", { name: "faxina" })).not.toBeNull();
    expect(screen.queryByRole("listitem", { name: "relatorio" })).not.toBeNull();
  });
});

describe("bg-ui: the hub follows them", () => {
  test("while the hub is open it asks the host again every 10 s, and stops when it closes", async () => {
    const timers: Array<{ fn: () => void; ms: number; cancelled: boolean }> = [];
    const store = new AppStore(memoryPlatform().platform, {
      baseDelayMs: 60_000,
      timers: {
        setTimeout: (fn, ms) => {
          timers.push({ fn, ms, cancelled: false });
          return timers.length - 1;
        },
        clearTimeout: (handle) => {
          const timer = timers[handle as number];
          if (timer) timer.cancelled = true;
        },
      },
    });
    cleanups.push(() => store.dispose());
    const daemon = legacyDaemon(cleanups);
    daemon.features.push("bg");
    daemon.bg.list = { supported: true, sessions: [BLOCKED] };
    const { unmount } = render(<App store={store} />);
    const hostId = await act(() => store.addHost({ name: "alfa", url: daemon.url, token: TOKEN }));
    await settle(() => store.getState().hosts[0]?.hostInfo != null);
    await act(async () => {
      store.router.push({ name: "hub" });
    });
    await settle(() => timers.some((t) => t.ms === 10_000));
    const asks = () => daemon.commands.filter((c) => c.type === "bg.list").length;
    const before = asks();
    daemon.bg.list = { supported: true, sessions: [{ ...BLOCKED, state: "done" }] };
    const pending = timers.filter((t) => t.ms === 10_000 && !t.cancelled).at(-1);
    await act(async () => {
      // A timer that fired is over.
      if (pending) pending.cancelled = true;
      pending?.fn();
    });
    await settle(() => asks() > before);
    expect(asks()).toBeGreaterThan(before);
    await settle(() => store.getState().background[hostId]?.sessions[0]?.state === "done");
    expect(store.getState().background[hostId]?.sessions[0]?.state).toBe("done");
    // Another one is scheduled; closing the hub cancels it.
    await settle(() => timers.filter((t) => t.ms === 10_000 && !t.cancelled).length > 0);
    unmount();
    expect(timers.filter((t) => t.ms === 10_000 && !t.cancelled)).toHaveLength(0);
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
      (c) => (c.type.startsWith("bg.") && c.type !== "bg.list") || c.type === "terminal.open",
    );
    expect(asked.map((c) => [c.type, c.payload])).toEqual([
      ["bg.stop", { id: "7c5dcf5d" }],
      ["bg.respawn", { id: "7c5dcf5d" }],
      [
        "terminal.open",
        { cwd: "/work/app", command: ["claude", "attach", "7c5dcf5d"], cols: 80, rows: 24 },
      ],
    ]);
    const inTab = () => store.tabs.tabs.some((t) => t.router.current.name === "terminal");
    await settle(inTab);
    expect(inTab()).toBe(true);
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
    await settle(() => store.getState().notices.some((n) => n.reason === "bg_no_message_path"));
    expect(store.getState().notices.find((n) => n.reason === "bg_no_message_path")).toBeDefined();
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
    await settle(() => screen.queryByLabelText("Primeiro prompt") !== null);
    return ctx;
  }

  test("the form has the option only on a host with bg, and then starts the session in the background", async () => {
    const { daemon, store } = await newSession();
    const box = screen.queryByLabelText("Iniciar em segundo plano") as HTMLInputElement;
    expect(box).not.toBeNull();
    await act(async () => {
      fireEvent.change(screen.queryByLabelText("Primeiro prompt") as HTMLTextAreaElement, {
        target: { value: "limpe os logs" },
      });
      fireEvent.click(box);
    });
    await click("Criar sessão");
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
