import { afterEach, describe, expect, test } from "bun:test";
import { userLine, writeTranscript } from "../../daemon/test/history-helpers.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** Waits for `check` without throwing, so the caller's `expect` reports the failure. */
async function settle(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await act(() => Bun.sleep(5));
}

/** A daemon with one transcript per entry of `messages` (`[uuid, text, ts]`). */
function historyHost(messages: Array<[string, string, string]>) {
  const d = makeDaemon(cleanups);
  for (const [uuid, text, ts] of messages) {
    writeTranscript(d.historyRoot, `-${uuid}`, `sess-${uuid}`, [
      userLine({ uuid, text, cwd: d.project, ts }),
    ]);
  }
  d.history.scan();
  return d.listen();
}

/** Answers `hello` and nothing else: a host that is online but never replies to a search. */
function silentHost(): string {
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: (req, srv) => (srv.upgrade(req) ? undefined : new Response("ws", { status: 426 })),
    websocket: {
      message(ws, raw) {
        const frame = JSON.parse(String(raw)) as { id: string; type: string };
        if (frame.type !== "hello") return;
        const data = { hostName: "mudo", daemonVersion: "0", protocolVersion: 1, allowedRoots: [] };
        ws.send(JSON.stringify({ type: "ack", id: frame.id, ok: true, data }));
      },
    },
  });
  cleanups.push(() => server.stop(true));
  return `ws://127.0.0.1:${server.port}/v1/ws`;
}

/** A URL where nothing listens. */
function deadUrl(): string {
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("") });
  const url = `ws://127.0.0.1:${server.port}/v1/ws`;
  server.stop(true);
  return url;
}

async function fleet(searchTimeoutMs = 3000) {
  const a = historyHost([
    ["a1", "o flamingo azul de setembro", "2026-09-01T10:00:00.000Z"],
    ["a2", "outro flamingo, agora no dia 10", "2026-09-10T10:00:00.000Z"],
  ]);
  const b = historyHost([["b1", "flamingo do host B", "2026-09-05T10:00:00.000Z"]]);
  const mem = memoryPlatform();
  const store = new AppStore(mem.platform, {
    searchTimeoutMs,
    baseDelayMs: 60_000,
    timeZone: "America/Sao_Paulo",
  });
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "alfa", url: a.url, token: TOKEN });
    await store.addHost({ name: "beta", url: b.url, token: TOKEN });
    await store.addHost({ name: "mudo", url: silentHost(), token: TOKEN });
    await store.addHost({ name: "desligado", url: deadUrl(), token: TOKEN });
  });
  await settle(() => store.getState().hosts.filter((h) => h.status === "online").length === 3);
  return store;
}

const openWithCtrlK = async () => {
  await act(async () => {
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  });
};

async function search(query: string) {
  const input = screen.queryByLabelText("Buscar no histórico") as HTMLInputElement | null;
  expect(input).not.toBeNull();
  await act(async () => {
    fireEvent.change(input as HTMLInputElement, { target: { value: query } });
    fireEvent.submit(input as HTMLInputElement);
  });
}

const resultTexts = () =>
  screen.queryByRole("list", { name: "Resultados da busca" })
    ? within(screen.queryByRole("list", { name: "Resultados da busca" }) as HTMLElement)
        .queryAllByRole("listitem")
        .map((li) => li.textContent ?? "")
    : [];

describe("busca-global", () => {
  test("Ctrl+K abre a busca; consulta os hosts online em paralelo e junta por data", async () => {
    const started = Date.now();
    await fleet(1500);
    await openWithCtrlK();
    expect(screen.queryByRole("dialog", { name: "Busca global" })).not.toBeNull();
    await search("flamingo");

    // The silent host is still being waited for: the others' hits are already merged by date.
    await settle(() => resultTexts().length === 3, 1000);
    expect(resultTexts().map((t) => t.split(" · ")[0])).toEqual(["alfa", "beta", "alfa"]);
    expect(resultTexts()[0]).toContain("outro flamingo, agora no dia 10");
    expect(screen.queryByText("mudo: buscando…")).not.toBeNull();
    expect(Date.now() - started).toBeLessThan(1500 + 2000);
    // An offline host is reported right away, never waited for.
    expect(screen.queryByText("desligado: sem resposta")).not.toBeNull();
    // Matches are highlighted.
    const marks = document.querySelectorAll("mark");
    expect([...marks].map((m) => m.textContent)).toEqual(["flamingo", "flamingo", "flamingo"]);

    // Past the timeout the silent host turns into "sem resposta" and the hits stay.
    await settle(() => screen.queryByText("mudo: sem resposta") !== null, 3000);
    expect(screen.queryByText("mudo: sem resposta")).not.toBeNull();
    expect(resultTexts()).toHaveLength(3);
  });

  test("cada acerto mostra host, pasta e data; Esc fecha; busca vazia não consulta", async () => {
    const store = await fleet(300);
    await openWithCtrlK();
    await search("   ");
    expect(store.getState().search).toBeNull();
    await search("azul");
    await settle(() => resultTexts().length === 1);
    expect(resultTexts()[0]?.startsWith("alfa · p")).toBe(true);
    // Local time, in the language of the app.
    expect(resultTexts()[0]).toMatch(/01\/09\/2026, \d{2}:\d{2}/);
    await act(async () => {
      fireEvent.keyDown(screen.queryByRole("dialog") as HTMLElement, { key: "Escape" });
    });
    expect(screen.queryByRole("dialog", { name: "Busca global" })).toBeNull();
    // The sidebar button opens it too.
    const button = screen.queryByRole("button", { name: "Buscar no histórico (Ctrl+K)" });
    expect(button).not.toBeNull();
    await act(async () => {
      fireEvent.click(button as HTMLElement);
    });
    expect(screen.queryByRole("dialog", { name: "Busca global" })).not.toBeNull();
  });

  test("uma busca nova descarta respostas atrasadas da anterior", async () => {
    const store = await fleet(300);
    await act(async () => {
      const first = store.searchHistory("flamingo");
      const second = store.searchHistory("azul");
      await Promise.all([first, second]);
    });
    expect(store.getState().search?.query).toBe("azul");
    expect(store.getState().search?.hits.map((h) => h.uuid)).toEqual(["a1"]);
  });
});
