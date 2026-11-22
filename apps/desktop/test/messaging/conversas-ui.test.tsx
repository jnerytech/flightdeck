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

const message = (over: Record<string, unknown>) => ({
  id: "m1",
  fromSession: "s1",
  fromHost: "h",
  toSession: "s2",
  toHost: "h",
  text: "pode revisar o login?",
  status: "delivered",
  reason: null,
  createdAt: "2026-10-30T12:00:00.000Z",
  deliveredAt: "2026-10-30T12:00:01.000Z",
  teamId: null,
  kind: "session",
  ...over,
});

/** The app on a daemon that announces messaging, with two messages, on Conversas. */
async function open(features = ["messaging"], seeded = true) {
  const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  const daemon = legacyDaemon(cleanups);
  daemon.features.push(...features);
  daemon.messaging.messages = !seeded
    ? []
    : [
        message({}),
        message({
          id: "m2",
          status: "refused",
          reason: "laço: o par está pausado",
          text: "de novo",
          createdAt: "2026-10-30T12:05:00.000Z",
          deliveredAt: null,
          teamId: "t1",
        }),
      ];
  render(<App store={store} />);
  await act(() => store.roster.add({ name: "alfa", url: daemon.url, token: TOKEN }));
  await settle(() => store.getState().hosts[0]?.hostInfo != null);
  const list = () => screen.queryByRole("list", { name: "Mensagens entre sessões" });
  return { store, daemon, list };
}

describe("conversas-ui: the messages between sessions", () => {
  test("Conversas is in the sidebar only when a host has messaging", async () => {
    await open([]);
    expect(screen.queryByRole("button", { name: "Conversas" })).toBeNull();
    cleanup();
    await open();
    expect(screen.queryByRole("button", { name: "Conversas" })).not.toBeNull();
  });

  test("the timeline lists the messages newest first, with the host, the state and why one was refused", async () => {
    const { list } = await open();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Conversas" }));
    });
    await settle(() => (list()?.children.length ?? 0) === 2);
    const [newest, oldest] = [...(list()?.children ?? [])].map((li) => li.textContent ?? "");
    expect(newest).toContain("de novo");
    expect(newest).toContain("Recusada");
    expect(newest).toContain("laço: o par está pausado");
    expect(oldest).toContain("pode revisar o login?");
    expect(oldest).toContain("Entregue");
    expect(oldest).toContain("alfa");
  });

  test("with no messages, the screen says where they come from and links to Times", async () => {
    const { store } = await open(["messaging"], false);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Conversas" }));
    });
    await settle(() => screen.queryByText("Nenhuma mensagem") !== null);
    expect(
      screen.queryByText(
        "As mensagens entre sessões aparecem aqui quando o envio entre elas está ligado, por exemplo num time.",
      ),
    ).not.toBeNull();
    const link = screen.queryByRole("button", { name: "Abrir Times" });
    expect(link).not.toBeNull();
    await act(async () => {
      fireEvent.click(link as HTMLElement);
    });
    expect(store.router.current).toEqual({ name: "teams" });
  });

  test("the filters narrow by state and by team", async () => {
    const { list } = await open();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Conversas" }));
    });
    await settle(() => (list()?.children.length ?? 0) === 2);
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Estado"), { target: { value: "refused" } });
    });
    expect(list()?.children.length).toBe(1);
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Estado"), { target: { value: "" } });
      fireEvent.change(screen.getByLabelText("Filtrar mensagens"), { target: { value: "t1" } });
    });
    expect(list()?.children.length).toBe(1);
    expect(list()?.textContent).toContain("de novo");
  });

  test("a messages.updated frame refreshes the timeline", async () => {
    const { daemon, list } = await open();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Conversas" }));
    });
    await settle(() => (list()?.children.length ?? 0) === 2);
    daemon.messaging.messages = [
      ...daemon.messaging.messages,
      message({ id: "m3", text: "nova", createdAt: "2026-10-30T12:10:00.000Z" }),
    ];
    await act(async () => {
      daemon.push({ type: "messages.updated", message: message({ id: "m3", text: "nova" }) });
    });
    await settle(() => (list()?.children.length ?? 0) === 3);
    expect(list()?.children.length).toBe(3);
  });

  test("Abrir a sessão opens the message's recipient", async () => {
    const { store, daemon, list } = await open();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Conversas" }));
    });
    await settle(() => (list()?.children.length ?? 0) === 2);
    const oldest = list()?.children[1] as HTMLElement;
    await act(async () => {
      fireEvent.click(within(oldest).getByRole("button", { name: /^Abrir a sessão/ }));
    });
    expect(store.router.current).toMatchObject({ name: "external", claudeSessionId: "s2" });
    // A recipient that is a managed session of the host opens as one.
    await act(async () => {
      daemon.push({
        type: "event",
        sessionId: "s1",
        seq: 1,
        ts: "2026-10-30T12:00:00.000Z",
        event: {
          type: "session.summary",
          sessionId: "s1",
          name: "a1",
          cwd: "/p",
          status: "idle",
          pendingPermissions: [],
          updatedAt: "2026-10-30T12:00:00.000Z",
        },
      });
    });
    await settle(() => store.getState().hosts[0]?.sessions.length === 1);
    daemon.messaging.messages = [message({ id: "m9", toSession: "s1" })];
    await act(async () => {
      daemon.push({ type: "messages.updated", message: message({ id: "m9", toSession: "s1" }) });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Conversas" }));
    });
    await settle(() => (list()?.children.length ?? 0) === 1);
    await act(async () => {
      fireEvent.click(
        within(list()?.children[0] as HTMLElement).getByRole("button", {
          name: /^Abrir a sessão/,
        }),
      );
    });
    expect(store.router.current).toMatchObject({ name: "session", id: "s1" });
  });
});

describe("conversas-ui: the timeline's states (#588)", () => {
  test("while the hosts answer it says it is loading, not that there are no messages", async () => {
    const { store } = await open();
    const real = store.hostCommand.bind(store);
    store.hostCommand = ((hostId: string, type: string, payload: unknown) =>
      type === "messages.list"
        ? new Promise(() => {})
        : real(hostId, type as never, payload as never)) as typeof store.hostCommand;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Conversas" }));
    });
    expect(screen.queryByRole("status", { name: "Carregando mensagens" })).not.toBeNull();
    expect(screen.queryByText("Nenhuma mensagem") === null).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
  });

  test("a filter that hides every message says so and keeps the Times link out", async () => {
    const { list } = await open();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Conversas" }));
    });
    await settle(() => (list()?.children.length ?? 0) === 2);
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Filtrar mensagens"), { target: { value: "zzz" } });
    });
    expect(screen.queryByText("Nenhuma mensagem corresponde ao filtro.")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Abrir Times" }) === null).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
    expect(list() === null).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
  });
});

describe("conversas-ui: the open button names its recipient (#4084)", () => {
  const goToList = async (list: () => HTMLElement | null, count: number) => {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Conversas" }));
    });
    await settle(() => (list()?.children.length ?? 0) === count);
  };

  test("each row's button carries its recipient, so two rows to different sessions differ", async () => {
    const { daemon, list } = await open();
    daemon.messaging.messages = [
      ...daemon.messaging.messages,
      message({ id: "m3", toSession: "s3", createdAt: "2026-10-30T12:10:00.000Z" }),
    ];
    await goToList(list, 3);
    expect(screen.queryByRole("button", { name: "Abrir a sessão de h/s3" })).not.toBeNull();
    expect(screen.queryAllByRole("button", { name: "Abrir a sessão de h/s2" })).toHaveLength(2);
  });

  test("a recipient on a host the app does not have is disabled and says why, and a press goes nowhere", async () => {
    const { store, daemon, list } = await open();
    daemon.messaging.messages = [message({ id: "m9", toHost: "fora", toSession: "s9" })];
    await goToList(list, 1);
    const button = screen.queryByRole("button", { name: "Abrir a sessão de fora/s9" });
    expect(button).not.toBeNull();
    expect((button as HTMLButtonElement).disabled).toBe(true);
    const why = document.getElementById(button?.getAttribute("aria-describedby") ?? "");
    expect(why?.textContent).toBe("Esse host não está conectado.");
    const before = JSON.stringify(store.router.current);
    await act(async () => {
      fireEvent.click(button as HTMLElement);
    });
    expect(JSON.stringify(store.router.current)).toBe(before);
  });
});

describe("conversas-ui: a paused pair (#4086)", () => {
  const LOOP = {
    type: "messaging.alert",
    kind: "loop",
    from: "h/s1",
    to: "h/s2",
    message: "laço entre h/s1 e h/s2: o par foi pausado",
    at: "2026-10-30T12:06:00.000Z",
  };
  const RULES = "Abrir as regras de mensagens";

  async function withLoop(paused: boolean) {
    const opened = await open();
    opened.daemon.messaging.messages = [
      ...opened.daemon.messaging.messages,
      message({
        id: "m4",
        fromSession: "s3",
        toSession: "s4",
        status: "refused",
        reason: "limite de mensagens",
        text: "outra recusa",
        createdAt: "2026-10-30T12:07:00.000Z",
      }),
    ];
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Conversas" }));
    });
    await settle(() => (opened.list()?.children.length ?? 0) === 3);
    if (paused) {
      await act(async () => {
        opened.daemon.push(LOOP);
      });
      await settle(() => opened.store.getState().loopAlerts.length === 1);
    }
    return opened;
  }
  const rowOf = (list: () => HTMLElement | null, text: string) =>
    [...(list()?.children ?? [])].find((li) => li.textContent?.includes(text)) as HTMLElement;

  test("the page says which pair is paused and links to the messages rules", async () => {
    const { store } = await withLoop(true);
    const notice = screen.queryByText(/Estas sessões estão pausadas por um laço de mensagens/);
    expect(notice).not.toBeNull();
    expect(notice?.textContent).toContain("h/s1 e h/s2");
    const link = within(notice as HTMLElement).queryByRole("button", { name: RULES });
    expect(link).not.toBeNull();
    await act(async () => {
      fireEvent.click(link as HTMLElement);
    });
    expect(store.router.current).toEqual({ name: "settings", section: "messaging" });
  });

  test("a refused row of the paused pair has the link; a refusal of another pair does not", async () => {
    const { list } = await withLoop(true);
    expect(within(rowOf(list, "de novo")).queryByRole("button", { name: RULES })).not.toBeNull();
    expect(
      within(rowOf(list, "outra recusa")).queryAllByRole("button", { name: RULES }),
    ).toHaveLength(0);
    expect(
      within(rowOf(list, "pode revisar")).queryAllByRole("button", { name: RULES }),
    ).toHaveLength(0);
  });

  test("with no paused pair there is no notice and no link", async () => {
    await withLoop(false);
    expect(screen.queryAllByRole("button", { name: RULES })).toHaveLength(0);
    expect(screen.queryAllByText(/estão pausadas/)).toHaveLength(0);
  });
});

describe("conversas-ui: a refusal reads in the app's language (#4083)", () => {
  test("a refused message with a reason key shows its Portuguese text; one with none keeps the daemon's words", async () => {
    const { daemon, list } = await open();
    daemon.messaging.messages = [
      message({
        id: "m3",
        status: "refused",
        reason: "the sessions are not in the same project or the same team",
        reasonKey: "messaging_no_route",
        text: "com chave",
        createdAt: "2026-10-30T12:10:00.000Z",
      }),
      message({
        id: "m4",
        status: "refused",
        reason: "limit of 3 per hour per session",
        reasonKey: "messaging_limit_session",
        reasonParams: { limit: 3 },
        text: "com valor",
        createdAt: "2026-10-30T12:11:00.000Z",
      }),
      message({
        id: "m5",
        status: "refused",
        reason: "reason without a key",
        text: "sem chave",
        createdAt: "2026-10-30T12:12:00.000Z",
      }),
    ];
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Conversas" }));
    });
    await settle(() => (list()?.children.length ?? 0) === 3);
    const shown = list()?.textContent ?? "";
    expect(shown.includes("não são do mesmo projeto")).toBe(true);
    expect(shown.includes("O limite de 3 mensagens por hora desta sessão foi atingido.")).toBe(
      true,
    );
    expect(shown.includes("reason without a key")).toBe(true);
    expect(shown.includes("the sessions are not in the same project")).toBe(false);
    expect(shown.includes("limit of 3 per hour")).toBe(false);
  });
});
