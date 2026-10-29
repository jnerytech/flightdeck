import { afterEach, describe, expect, test } from "bun:test";
import { utimesSync } from "node:fs";
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

async function settle(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await act(() => Bun.sleep(5));
}

const ID = "66666666-6666-4666-8666-666666666666";

/**
 * A host whose history has one transcript about "girafa". `stale` makes the file an hour old
 * (not maybeActive); `cwd` overrides its folder.
 */
async function setup(opts: { stale: boolean; cwd?: string }) {
  const d = makeDaemon(cleanups);
  const path = writeTranscript(d.historyRoot, "-p", ID, [
    userLine({ uuid: "u1", text: "falando da girafa", cwd: opts.cwd ?? d.project }),
  ]);
  if (opts.stale) {
    const old = new Date(Date.now() - 3_600_000);
    utimesSync(path, old, old);
  }
  d.history.scan();
  const server = d.listen();
  const mem = memoryPlatform();
  const copied: string[] = [];
  let copyFails = false;
  mem.platform.copyText = async (text) => {
    if (copyFails) throw new Error("área de transferência indisponível");
    copied.push(text);
  };
  const store = new AppStore(mem.platform, { baseDelayMs: 60_000 });
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "alfa", url: server.url, token: TOKEN });
  });
  await settle(() => store.getState().hosts[0]?.status === "online");
  // Open the transcript from the global search.
  await act(async () => {
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  });
  const input = screen.queryByLabelText("Buscar no histórico") as HTMLInputElement;
  await act(async () => {
    fireEvent.change(input, { target: { value: "girafa" } });
    fireEvent.submit(input);
  });
  // The Sessões screen behind it also lists the transcript: wait for the search's own results.
  const results = () =>
    screen.queryByRole("list", { name: "Resultados da busca" })?.querySelector("button") ?? null;
  await settle(() => results() !== null);
  const hit = results();
  await act(async () => {
    fireEvent.click(hit as HTMLElement);
  });
  await settle(() => screen.queryByRole("button", { name: "Continuar no Flightdeck" }) !== null);
  return { store, runtime: d.runtime, copied, failCopy: () => (copyFails = true) };
}

const click = async (name: string) => {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
};

describe("continuar", () => {
  test("Continuar no Flightdeck cria a sessão gerenciada e abre a conversa", async () => {
    const { store, runtime } = await setup({ stale: true });
    await click("Continuar no Flightdeck");
    await settle(() => runtime.starts.length === 1);
    expect(runtime.starts.map((s) => s.resume)).toEqual([ID]);
    // No confirmation for a session nobody is using.
    expect(screen.queryByText(/pode estar em uso/)).toBeNull();
    await settle(() => screen.queryByLabelText("Mensagem") !== null);
    expect(screen.queryByLabelText("Mensagem")).not.toBeNull();
    expect(screen.queryByRole("log", { name: "Transcript" })).toBeNull();
    expect(store.getState().selected?.sessionId).toBeString();
  });

  test("sessão possivelmente em uso pede confirmação antes de mandar force: true", async () => {
    const { runtime } = await setup({ stale: false });
    expect(screen.queryByText("possivelmente em uso")).not.toBeNull();
    await click("Continuar no Flightdeck");
    expect(screen.queryByText(/pode estar em uso em outro lugar/)).not.toBeNull();
    await act(() => Bun.sleep(30));
    expect(runtime.starts).toEqual([]);

    await click("Cancelar");
    expect(screen.queryByText(/pode estar em uso em outro lugar/)).toBeNull();
    await act(() => Bun.sleep(30));
    expect(runtime.starts).toEqual([]);

    await click("Continuar no Flightdeck");
    await click("Continuar mesmo assim");
    // Without force the daemon would have refused: this start proves force: true was sent.
    await settle(() => runtime.starts.length === 1);
    expect(runtime.starts.map((s) => s.resume)).toEqual([ID]);
  });

  test("Copiar comando copia claude --resume <id>; falha na cópia vai para o banner", async () => {
    const { copied, failCopy } = await setup({ stale: true });
    await click("Copiar comando");
    expect(copied).toEqual([`claude --resume ${ID}`]);
    expect(screen.queryByText("Comando copiado")).not.toBeNull();
    failCopy();
    await click("Copiar comando");
    expect(screen.queryByRole("alert")?.textContent ?? "").toContain(
      "área de transferência indisponível",
    );
  });

  test("recusa do daemon (pasta fora de allowedRoots) aparece no banner e o leitor fica", async () => {
    const { runtime } = await setup({ stale: true, cwd: "/fora/dos/roots" });
    await click("Continuar no Flightdeck");
    await settle(() => screen.queryByRole("alert") !== null);
    expect(screen.queryByRole("alert")?.textContent ?? "").toContain("forbidden_cwd");
    expect(runtime.starts).toEqual([]);
    expect(screen.queryByRole("log", { name: "Transcript" })).not.toBeNull();
  });
});
