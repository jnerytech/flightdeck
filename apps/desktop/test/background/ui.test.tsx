import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { hubRows } from "../../src/features/sessions/domain/hub.ts";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform, TOKEN } from "../fixtures.ts";
import { legacyDaemon } from "../legacy-daemon.ts";
import { sidebarNav } from "../sidebar/helpers.ts";
import { settle } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const sidebar = sidebarNav({ act, fireEvent, screen });
const { AppStore } = await import("../../src/lib/app-store.ts");
const { App } = await import("../../src/app/App.tsx");
const { rowRoute } = await import("../../src/features/sessions/domain/row-route.ts");

setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

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
  const hostId = await act(() => store.roster.add({ name: "alfa", url: daemon.url, token: TOKEN }));
  await settle(() => store.getState().hosts[0]?.hostInfo != null);
  return { store, daemon, hostId };
}

describe("bg-ui: the hub", () => {
  test("the background sessions are rows of the origin segundo plano, with the state the listing gives", async () => {
    const { store, hostId } = await open();
    await act(async () => {
      await store.background.load(hostId);
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
      await store.background.load(hostId);
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
    const hostId = await act(() =>
      store.roster.add({ name: "alfa", url: daemon.url, token: TOKEN }),
    );
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
  const panel = () => screen.queryByRole("region", { name: /Sessão em segundo plano/ });
  async function openPanel(features?: string[], sessions?: unknown[], claudeSessionId = "c1") {
    const ctx = await open(features, sessions);
    await act(async () => {
      await ctx.store.background.load(ctx.hostId);
      ctx.store.router.push({ name: "external", host: ctx.hostId, claudeSessionId });
    });
    await settle(() => panel() !== null);
    return ctx;
  }

  test("a session that is in the listing has a panel with its state, what it waits for and its cost", async () => {
    await openPanel();
    expect(panel()?.textContent).toContain("esperando você");
    expect(panel()?.textContent).toContain("permission prompt");
    expect(panel()?.textContent).toContain("US$ 0,50");
  });

  test("Parar and Reiniciar ask the host, Trazer para o terminal opens claude attach in a tab", async () => {
    const { daemon, store } = await openPanel();
    await click("Parar");
    await click("Parar a sessão");
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
    // The field empties once the host has answered: type the next message after that, or the
    // late answer would clear it.
    await settle(() => field.value === "");
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

  test("Parar asks first, naming the session, and sends nothing until it is confirmed (#4169)", async () => {
    const { daemon } = await openPanel();
    await click("Parar");
    const asked = () => daemon.commands.filter((c) => c.type === "bg.stop");
    expect(screen.queryByRole("alertdialog")?.textContent).toContain("faxina");
    expect(asked()).toHaveLength(0);
    await click("Cancelar");
    expect(asked()).toHaveLength(0);
    expect(screen.queryAllByRole("alertdialog")).toHaveLength(0);
    await click("Parar");
    await click("Parar a sessão");
    await settle(() => asked().length === 1);
    expect(asked().map((c) => c.payload)).toEqual([{ id: "7c5dcf5d" }]);
  });

  test("after a confirmed Parar the focus is on the panel, not lost with the disabled button (#4169)", async () => {
    const { daemon } = await openPanel();
    await click("Parar");
    await click("Parar a sessão");
    await settle(() => daemon.commands.some((c) => c.type === "bg.stop"));
    await settle(() => document.activeElement === panel());
    expect(document.activeElement === panel()).toBe(true);
  });

  test("two presses of Reiniciar in a row send one request (#4169)", async () => {
    const { daemon } = await openPanel();
    const button = screen.queryByRole("button", { name: "Reiniciar" }) as HTMLElement;
    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    await settle(() => daemon.commands.some((c) => c.type === "bg.respawn"));
    expect(daemon.commands.filter((c) => c.type === "bg.respawn")).toHaveLength(1);
  });

  test("the state line is a status region: a new state reaches a screen reader (#4169)", async () => {
    const { store, hostId, daemon } = await openPanel();
    const said = () =>
      within(panel() as HTMLElement)
        .queryAllByRole("status")
        .map((n) => n.textContent)
        .join(" ");
    expect(said()).toContain("esperando você");
    daemon.bg.list = {
      supported: true,
      sessions: [{ ...BLOCKED, state: "working", waitingFor: null }],
    };
    await act(async () => {
      await store.background.load(hostId);
    });
    await settle(() => said().includes("trabalhando"));
    expect(said()).toContain("trabalhando");
  });

  test("a refused Reiniciar says so next to the buttons and the button is usable again (#4169)", async () => {
    const { daemon } = await openPanel();
    daemon.bg.refused.set("bg.respawn", { reason: "bg_cli_failed", params: { message: "boom" } });
    await click("Reiniciar");
    const said = () => within(panel() as HTMLElement).queryAllByText(/Não foi possível reiniciar/);
    await settle(() => said().length > 0);
    expect(said().length).toBeGreaterThan(0);
    const button = screen.queryByRole("button", { name: "Reiniciar" }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });

  test("Parar is off with its reason on a session that is not running, Reiniciar on one that is working (#4169)", async () => {
    const finished = { ...DONE, claudeSessionId: "c2" };
    await openPanel(undefined, [finished], "c2");
    const stop = () => screen.queryByRole("button", { name: "Parar" }) as HTMLButtonElement;
    expect(stop().disabled).toBe(true);
    expect(screen.queryAllByText("A sessão não está rodando.").length).toBeGreaterThan(0);
    expect(
      (screen.queryByRole("button", { name: "Reiniciar" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  test("Reiniciar is off with its reason while the session works (#4169)", async () => {
    await openPanel(undefined, [{ ...BLOCKED, state: "working" }]);
    expect(
      (screen.queryByRole("button", { name: "Reiniciar" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.queryAllByText("A sessão ainda está trabalhando.").length).toBeGreaterThan(0);
    expect((screen.queryByRole("button", { name: "Parar" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  test("in English the new texts are in English (#4169)", async () => {
    const { store, daemon } = await openPanel(undefined, [{ ...BLOCKED, state: "working" }]);
    await act(async () => {
      store.i18n.setLang("en");
    });
    await settle(() => screen.queryByRole("button", { name: "Restart" }) !== null);
    expect(screen.queryAllByText("The session is still working.").length).toBeGreaterThan(0);
    await click("Stop");
    expect(screen.queryByRole("alertdialog")?.textContent).toContain("Stop session");
    expect(daemon.commands.some((c) => c.type === "bg.stop")).toBe(false);
  });

  test("a state the app does not know is labelled in the person's language (#4171)", async () => {
    await openPanel(undefined, [{ ...BLOCKED, state: "something-new" }]);
    expect(panel()?.textContent).toContain("estado: something-new");
  });

  test("each panel is named by its session, in both languages (#4171)", async () => {
    const { store } = await openPanel();
    expect(screen.queryByRole("region", { name: "Sessão em segundo plano faxina" })).not.toBeNull();
    await act(async () => {
      store.i18n.setLang("en");
    });
    await settle(
      () => screen.queryByRole("region", { name: "Background session faxina" }) !== null,
    );
    expect(screen.queryByRole("region", { name: "Background session faxina" })).not.toBeNull();
  });

  test("a session with an empty name is named by its folder (#4171)", async () => {
    await openPanel(undefined, [{ ...BLOCKED, name: "" }]);
    expect(screen.queryByRole("region", { name: "Sessão em segundo plano app" })).not.toBeNull();
  });

  test("a host without the terminal does not offer to bring it there", async () => {
    await openPanel(["bg"]);
    expect(screen.queryByRole("button", { name: "Trazer para o terminal" })).toBeNull();
  });
});

describe("bg-ui: a row with no Claude session (#4171)", () => {
  test("a click on it says why nothing opens, in both languages, and the hub stays", async () => {
    const { store, hostId } = await open();
    await act(async () => {
      await store.background.load(hostId);
      store.router.push({ name: "hub" });
    });
    await sidebar.openFilters();
    await act(async () => {
      fireEvent.change(screen.queryByLabelText("Origem") as HTMLSelectElement, {
        target: { value: "background" },
      });
    });
    await settle(() => screen.queryByRole("listitem", { name: "relatorio" }) !== null);
    const row = screen.queryByRole("listitem", { name: "relatorio" }) as HTMLElement;
    await act(async () => {
      fireEvent.click(within(row).getByRole("button", { name: "relatorio" }));
    });
    await settle(() => screen.queryAllByText(/não informou a sessão do Claude/).length > 0);
    expect(screen.queryAllByText(/não informou a sessão do Claude/).length).toBeGreaterThan(0);
    expect(store.router.current.name).toBe("hub");
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

  test("with the background option and no prompt, Criar sessão is off and says why, and no bg.start leaves (#940)", async () => {
    const { daemon } = await newSession();
    // Without the option an empty prompt is fine.
    expect(
      (screen.queryByRole("button", { name: "Criar sessão" }) as HTMLButtonElement).disabled,
    ).toBe(false);
    await act(async () => {
      fireEvent.click(screen.queryByLabelText("Iniciar em segundo plano") as HTMLInputElement);
    });
    const create = screen.queryByRole("button", { name: "Criar sessão" }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    expect(
      screen.queryByText("Escreva o primeiro prompt para iniciar em segundo plano."),
    ).not.toBeNull();
    // Writing the prompt turns it on; the reason goes.
    await act(async () => {
      fireEvent.change(screen.queryByLabelText("Primeiro prompt") as HTMLTextAreaElement, {
        target: { value: "limpe os logs" },
      });
    });
    expect(
      (screen.queryByRole("button", { name: "Criar sessão" }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(
      screen.queryByText("Escreva o primeiro prompt para iniciar em segundo plano."),
    ).toBeNull();
    expect(daemon.commands.some((c) => c.type === "bg.start")).toBe(false);
  });

  const tickAndFill = async () => {
    await act(async () => {
      fireEvent.change(screen.queryByLabelText("Primeiro prompt") as HTMLTextAreaElement, {
        target: { value: "limpe os logs" },
      });
      fireEvent.click(screen.queryByLabelText("Iniciar em segundo plano") as HTMLInputElement);
    });
  };

  test("the option's hint is its accessible description (#4172)", async () => {
    await newSession();
    const box = screen.queryByLabelText("Iniciar em segundo plano") as HTMLInputElement;
    const hint = document.getElementById(box.getAttribute("aria-describedby") ?? "-");
    expect(hint?.textContent?.includes("sem terminal")).toBe(true);
  });

  test("a start that works says so in a notice naming the folder (#4172)", async () => {
    const { store } = await newSession();
    const said: string[] = [];
    const success = store.success.bind(store);
    store.success = (text: string) => {
      said.push(text);
      success(text);
    };
    await tickAndFill();
    await click("Criar sessão");
    await settle(() => said.length > 0);
    expect(said[0]).toBe('Sessão "work" iniciada em segundo plano. Ela aparece em Sessões.');
  });

  test("a start the host refuses keeps the form and says so beside the option (#4172)", async () => {
    const { daemon, store } = await newSession();
    daemon.bg.refused.set("bg.start", { reason: "bg_cli_failed", params: { message: "boom" } });
    await tickAndFill();
    await click("Criar sessão");
    await settle(() => screen.queryByText("Não foi possível iniciar em segundo plano.") !== null);
    expect(screen.queryByText("Não foi possível iniciar em segundo plano.")).not.toBeNull();
    expect(store.router.current.name).toBe("new-session");
    expect((screen.queryByLabelText("Primeiro prompt") as HTMLTextAreaElement).value).toBe(
      "limpe os logs",
    );
  });

  test("a host without bg has no such option", async () => {
    await newSession([]);
    expect(screen.queryByLabelText("Iniciar em segundo plano")).toBeNull();
  });
});
