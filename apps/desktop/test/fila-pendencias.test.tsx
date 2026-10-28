import { afterEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN, waitFor } from "./fixtures.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const {
  act,
  cleanup,
  fireEvent,
  render,
  within,
  waitFor: rtlWaitFor,
} = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore, needsYou, sessionKey } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** Waits for `check` without throwing, so the caller's `expect` reports the failure. */
async function settle(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await Bun.sleep(5);
}

/** Two fake daemons, each with a session waiting for permission, created outside the app. */
async function fleet() {
  const a = makeDaemon(cleanups);
  const b = makeDaemon(cleanups);
  const serverA = a.listen();
  const serverB = b.listen();
  const first = a.manager.create({ cwd: a.project, prompt: "[tool]", name: "s-a" });
  await waitFor(() => a.manager.get(first.sessionId).status === "awaiting_permission");
  await Bun.sleep(5);
  const second = b.manager.create({ cwd: b.project, prompt: "[tool]", name: "s-b" });
  await waitFor(() => b.manager.get(second.sessionId).status === "awaiting_permission");
  const mem = memoryPlatform(false);
  const store = new AppStore(mem.platform, { baseDelayMs: 10 });
  cleanups.push(() => store.dispose());
  const hostA = await store.addHost({ name: "pc", url: serverA.url, token: TOKEN });
  const hostB = await store.addHost({ name: "pi", url: serverB.url, token: TOKEN });
  await settle(() => needsYou(store.getState()).length === 2);
  expect(needsYou(store.getState())).toHaveLength(2);
  return { a, b, serverA, serverB, first, second, store, hostA, hostB, ...mem };
}

describe("fila-pendencias", () => {
  test("barra lateral vem dos resumos, sem abrir cada sessão", async () => {
    const { store, hostA, hostB, first, second } = await fleet();
    const host = (id: string) => store.getState().hosts.find((h) => h.id === id);
    expect(host(hostA)?.sessions.map((s) => [s.id, s.name, s.status])).toEqual([
      [first.sessionId, "s-a", "awaiting_permission"],
    ]);
    expect(host(hostB)?.sessions[0]?.id).toBe(second.sessionId);
    expect(Object.keys(store.getState().sessions)).toEqual([]);
  });

  test("fila única com os pedidos de todos os hosts, do mais antigo ao mais novo", async () => {
    const { store, hostA, hostB, first, second } = await fleet();
    expect(
      needsYou(store.getState()).map((p) => [
        p.hostId,
        p.hostName,
        p.sessionId,
        p.sessionName,
        p.toolName,
      ]),
    ).toEqual([
      [hostA, "pc", first.sessionId, "s-a", "Write"],
      [hostB, "pi", second.sessionId, "s-b", "Write"],
    ]);
  });

  test("responder pela fila aprova no host certo e a fila e a bandeja acompanham", async () => {
    const { store, win, b, second } = await fleet();
    expect(win.document.title).toBe("(2) Flightdeck");
    const [, fromPi] = needsYou(store.getState());
    await store.respondTo(fromPi?.hostId ?? "", fromPi?.requestId ?? "", "allow");
    await waitFor(() => b.manager.get(second.sessionId).status === "idle", "pi ocioso");
    await waitFor(() => needsYou(store.getState()).length === 1, "fila com um pedido");
    await waitFor(() => win.document.title === "(1) Flightdeck", "título da bandeja");
  });

  test("notificações ao vivo trazem o nome do host; o estado inicial não notifica", async () => {
    const { a, store, hostA, notifications, first } = await fleet();
    expect(notifications).toEqual([]);
    const fresh = a.manager.create({ cwd: a.project, prompt: "[tool]", name: "nova" });
    await waitFor(() => notifications.length === 1, "notificação do pedido novo");
    expect(notifications[0]).toEqual({
      title: "pc · nova: esperando você",
      body: "Permitir Write?",
    });
    const request = needsYou(store.getState()).find((p) => p.sessionId === fresh.sessionId);
    await store.respondTo(hostA, request?.requestId ?? "", "allow");
    await waitFor(() => notifications.length === 2, "notificação de fim de turno");
    expect(notifications[1]).toEqual({ title: "pc · nova: turno concluído", body: "ociosa" });
    expect(first.sessionId).not.toBe(fresh.sessionId);
  });

  test("clicar no pedido da fila abre a sessão no card de aprovação", async () => {
    const { store, first, hostA } = await fleet();
    render(<App store={store} />);
    await rtlWaitFor(() => expect(screen.queryByText("Precisa de você (2)")).not.toBeNull());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "pc · s-a: Write" }));
    });
    expect(store.getState().selected).toEqual({ hostId: hostA, sessionId: first.sessionId });
    await rtlWaitFor(
      () => expect(screen.queryByRole("button", { name: "Permitir" })).not.toBeNull(),
      {
        timeout: 3000,
      },
    );
    expect(store.getState().sessions[sessionKey(hostA, first.sessionId)]?.pending.length).toBe(1);
  });

  test("host que caiu aparece como reconectando", async () => {
    const { store, serverA } = await fleet();
    render(<App store={store} />);
    await serverA.stop();
    await rtlWaitFor(() => expect(screen.queryByLabelText("pc: reconectando")).not.toBeNull(), {
      timeout: 3000,
    });
  });

  test("responder pela fila um pedido que já não existe mostra o erro", async () => {
    const { store, hostA } = await fleet();
    await store.respondTo(hostA, "pedido-inexistente", "allow").catch(() => {});
    expect(store.getState().error ?? "").toContain("not_found");
  });
});
