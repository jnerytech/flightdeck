import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform, TOKEN } from "../fixtures.ts";
import { legacyDaemon } from "../legacy-daemon.ts";
import { settle } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { App } = await import("../../src/app/App.tsx");

setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const click = async (name: string | RegExp) => {
  // The session's views are tabs; everything else is a button.
  const button = screen.queryByRole("button", { name }) ?? screen.queryByRole("tab", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
};

/** The alert that says how a send went (the page may hold other alerts, such as a toast). */
const refusedResult = () =>
  screen.queryAllByRole("alert").find((el) => (el.textContent ?? "").includes("Recusada")) ?? null;

/** The terminal session c1 of a daemon, on its screen. */
async function open(features = ["messaging"]) {
  const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  const daemon = legacyDaemon(cleanups);
  daemon.features.push(...features);
  daemon.messaging.messages = [
    {
      id: "m1",
      fromSession: "s9",
      fromHost: "h",
      toSession: "c1",
      toHost: "h",
      text: "a revisão está pronta",
      status: "delivered",
      reason: null,
      createdAt: "2026-10-30T12:00:00.000Z",
      deliveredAt: "2026-10-30T12:00:01.000Z",
      teamId: null,
      kind: "session",
    },
  ];
  daemon.messaging.sessions = [
    {
      address: "h/s8",
      id: "s8",
      host: "h",
      name: "app · qa · 1",
      alias: "app-qa-1",
      aliases: ["app-qa-1"],
      persona: "qa",
      state: "idle",
      projectKey: "k",
      teamId: null,
      kind: "managed",
      receives: true,
      reason: null,
    },
    {
      address: "h/s9",
      id: "s9",
      host: "h",
      name: "app · revisor · 1",
      alias: "app-revisor-1",
      aliases: ["app-revisor-1"],
      persona: "revisor",
      state: "idle",
      projectKey: "k",
      teamId: null,
      kind: "managed",
      receives: true,
      reason: null,
    },
  ];
  render(<App store={store} />);
  const hostId = await act(() => store.roster.add({ name: "alfa", url: daemon.url, token: TOKEN }));
  await settle(() => store.getState().hosts[0]?.hostInfo != null);
  await act(async () => {
    store.router.push({ name: "external", host: hostId, claudeSessionId: "c1" });
  });
  return { store, daemon };
}

describe("sessao-mensagens-ui: the Mensagens tab of a session", () => {
  test("a session of a host with messaging has a Mensagens tab; without it, none", async () => {
    await open([]);
    expect(screen.queryByRole("tab", { name: "Mensagens" })).toBeNull();
    cleanup();
    await open();
    expect(screen.queryByRole("tab", { name: "Mensagens" })).not.toBeNull();
  });

  test("the tab lists this session's messages, sent and received", async () => {
    const { daemon } = await open();
    await click("Mensagens");
    const list = () => screen.queryByRole("list", { name: "Mensagens desta sessão" });
    await settle(() => (list()?.children.length ?? 0) === 1);
    expect(list()?.textContent).toContain("a revisão está pronta");
    expect(list()?.textContent).toContain("Recebida");
    // A new message of the session arrives while the tab is open.
    daemon.messaging.messages = [
      ...daemon.messaging.messages,
      { ...(daemon.messaging.messages[0] as object), id: "m7", text: "outra" },
    ];
    await act(async () => {
      daemon.push({ type: "messages.updated", message: daemon.messaging.messages[1] });
    });
    await settle(() => (list()?.children.length ?? 0) === 2);
    expect(list()?.children.length).toBe(2);
    expect(daemon.commands.find((c) => c.type === "messages.list")?.payload).toEqual({
      session: "c1",
    });
  });

  test("Mandar para outra sessão sends as this session to a session it may see, and says how it went", async () => {
    const { daemon } = await open();
    await click("Mensagens");
    await click("Mandar para outra sessão…");
    await settle(
      () => (screen.queryByLabelText("Para") as HTMLSelectElement | null)?.options.length === 2,
    );
    // The first session it may see is chosen; the user picks the other.
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Para"), { target: { value: "h/s9" } });
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Texto da mensagem"), {
        target: { value: "pode revisar?" },
      });
    });
    await click("Enviar");
    await settle(() => screen.queryByRole("status", { name: "Resultado do envio" }) !== null);
    expect(daemon.commands.find((c) => c.type === "messages.send")?.payload).toEqual({
      as: { session: "c1" },
      to: "h/s9",
      text: "pode revisar?",
    });
    expect(screen.queryByRole("status", { name: "Resultado do envio" })?.textContent).toContain(
      "Na fila",
    );
    daemon.messaging.send = { id: "m2", status: "refused", reason: "outro projeto" };
    // A sent text is gone from the box, so the next one is typed again.
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Texto da mensagem"), {
        target: { value: "e agora?" },
      });
    });
    await click("Enviar");
    // A refusal is announced at once (an alert); a delivered or queued send is a polite status.
    await settle(() => (refusedResult()?.textContent ?? "").includes("outro projeto"));
    expect(refusedResult()?.textContent).toContain("Recusada");
    expect(screen.queryByRole("status", { name: "Resultado do envio" })).toBeNull();
  });

  test("a sent message reads as sent, and Cancelar closes the form", async () => {
    const { daemon } = await open();
    daemon.messaging.messages = [
      { ...(daemon.messaging.messages[0] as object), id: "m5", fromSession: "c1", toSession: "s9" },
    ];
    await click("Mensagens");
    const list = () => screen.queryByRole("list", { name: "Mensagens desta sessão" });
    await settle(() => (list()?.children.length ?? 0) === 1);
    expect(list()?.textContent).toContain("Enviada");
    await click("Mandar para outra sessão…");
    await click("Cancelar");
    expect(screen.queryByLabelText("Texto da mensagem")).toBeNull();
  });
});

describe("sessao-mensagens-ui: a paused pair (#4086)", () => {
  const refused = (id: string, toSession: string, text: string) => ({
    ...({
      fromSession: "c1",
      fromHost: "h",
      toHost: "h",
      status: "refused",
      reason: "o par está pausado",
      createdAt: "2026-10-30T12:05:00.000Z",
      deliveredAt: null,
      teamId: null,
      kind: "session",
    } as const),
    id,
    toSession,
    text,
  });
  const RULES = "Abrir as regras de mensagens";

  test("a refused message of a paused pair links to the messages rules; another refusal does not", async () => {
    const { store, daemon } = await open();
    daemon.messaging.messages = [refused("m5", "s9", "de novo"), refused("m6", "s8", "outra")];
    await click("Mensagens");
    const list = () => screen.queryByRole("list", { name: "Mensagens desta sessão" });
    await settle(() => (list()?.children.length ?? 0) === 2);
    await act(async () => {
      daemon.push({
        type: "messaging.alert",
        kind: "loop",
        from: "h/c1",
        to: "h/s9",
        message: "laço entre h/c1 e h/s9: o par foi pausado",
        at: "2026-10-30T12:06:00.000Z",
      });
    });
    await settle(() => store.getState().loopAlerts.length === 1);
    const rows = [...(list()?.children ?? [])] as HTMLElement[];
    const paused = rows.find((li) => li.textContent?.includes("de novo")) as HTMLElement;
    const other = rows.find((li) => li.textContent?.includes("outra")) as HTMLElement;
    expect(within(other).queryAllByRole("button", { name: RULES })).toHaveLength(0);
    const link = within(paused).queryByRole("button", { name: RULES });
    expect(link).not.toBeNull();
    await act(async () => {
      fireEvent.click(link as HTMLElement);
    });
    expect(store.router.current).toEqual({ name: "settings", section: "messaging" });
  });
});

describe("sessao-mensagens-ui: a refusal reads in the app's language and its result follows the form (#4083, #4087)", () => {
  const fillAndSend = async (text: string) => {
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Texto da mensagem"), { target: { value: text } });
    });
    await click("Enviar");
  };
  const openForm = async () => {
    await click("Mensagens");
    await click("Mandar para outra sessão…");
    await settle(
      () => (screen.queryByLabelText("Para") as HTMLSelectElement | null)?.options.length === 2,
    );
  };

  test("a refused send shows the reason in Portuguese, and a refused row of the list too", async () => {
    const { daemon } = await open();
    daemon.messaging.send = {
      id: "m2",
      status: "refused",
      reason: "limit of 3 per hour per session",
      reasonKey: "messaging_limit_session",
      reasonParams: { limit: 3 },
    };
    daemon.messaging.messages = [
      {
        ...(daemon.messaging.messages[0] as object),
        id: "m8",
        status: "refused",
        reason: "the sessions are not in the same project or the same team",
        reasonKey: "messaging_no_route",
        text: "linha recusada",
      },
    ];
    await openForm();
    await fillAndSend("oi");
    await settle(() => refusedResult() !== null);
    const alert = refusedResult()?.textContent ?? "";
    expect(alert.includes("O limite de 3 mensagens por hora desta sessão foi atingido.")).toBe(
      true,
    );
    expect(alert.includes("limit of 3 per hour")).toBe(false);
    const list = screen.queryByRole("list", { name: "Mensagens desta sessão" });
    await settle(() => (list?.textContent ?? "").includes("não são do mesmo projeto"));
    expect((list?.textContent ?? "").includes("the sessions are not in the same project")).toBe(
      false,
    );
  });

  test("the result of a send goes away when the text or the recipient changes", async () => {
    const { daemon } = await open();
    daemon.messaging.send = { id: "m2", status: "refused", reason: "outro projeto" };
    await openForm();
    await fillAndSend("oi");
    await settle(() => refusedResult() !== null);
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Texto da mensagem"), { target: { value: "oi!" } });
    });
    expect(refusedResult()).toBeNull();
    await fillAndSend("oi!");
    await settle(() => refusedResult() !== null);
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Para"), { target: { value: "h/s9" } });
    });
    expect(refusedResult()).toBeNull();
  });
});
