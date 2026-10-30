import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
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
  const hostId = await act(() => store.addHost({ name: "alfa", url: daemon.url, token: TOKEN }));
  await settle(() => store.getState().hosts[0]?.hostInfo != null);
  await act(async () => {
    store.router.push({ name: "external", host: hostId, claudeSessionId: "c1" });
  });
  return { store, daemon };
}

describe("sessao-mensagens-ui: the Mensagens tab of a session", () => {
  test("a session of a host with messaging has a Mensagens tab; without it, none", async () => {
    await open([]);
    expect(screen.queryByRole("button", { name: "Mensagens" })).toBeNull();
    cleanup();
    await open();
    expect(screen.queryByRole("button", { name: "Mensagens" })).not.toBeNull();
  });

  test("the tab lists this session's messages, sent and received", async () => {
    const { daemon } = await open();
    await click("Mensagens");
    const list = () => screen.queryByRole("list", { name: "Mensagens desta sessão" });
    await settle(() => (list()?.children.length ?? 0) === 1);
    expect(list()?.textContent).toContain("a revisão está pronta");
    expect(daemon.commands.find((c) => c.type === "messages.list")?.payload).toEqual({
      session: "c1",
    });
  });

  test("Mandar para outra sessão sends as this session to a session it may see, and says how it went", async () => {
    const { daemon } = await open();
    await click("Mensagens");
    await click("Mandar para outra sessão…");
    await settle(
      () => (screen.queryByLabelText("Para") as HTMLSelectElement | null)?.options.length === 1,
    );
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
    await click("Enviar");
    await settle(() =>
      (screen.queryByRole("status", { name: "Resultado do envio" })?.textContent ?? "").includes(
        "outro projeto",
      ),
    );
    expect(screen.queryByRole("status", { name: "Resultado do envio" })?.textContent).toContain(
      "Recusada",
    );
  });
});
