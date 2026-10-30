import { afterEach, describe, expect, test } from "bun:test";
import {
  assistantLine,
  summaryLine,
  userLine,
  writeTranscript,
} from "../../daemon/test/history-helpers.ts";
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

const HIT = 30;
const TOTAL = 120;

/** One host with a 120-message transcript; message 30 is the only one with "agulha". */
async function setup() {
  const d = makeDaemon(cleanups);
  const lines = Array.from({ length: TOTAL }, (_, i) => {
    const text = i === HIT ? `mensagem ${i} com agulha` : `mensagem ${i}`;
    const ts = new Date(Date.UTC(2026, 8, 1, 10, 0, i)).toISOString();
    const uuid = `m${i}`;
    return i % 2 === 0
      ? userLine({ uuid, text, cwd: d.project, ts })
      : assistantLine({ uuid, text, cwd: d.project, ts });
  });
  writeTranscript(d.historyRoot, "-p", "longa", lines);
  d.history.scan();
  const server = d.listen();
  const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "alfa", url: server.url, token: TOKEN });
  });
  await settle(() => store.getState().hosts[0]?.status === "online");
  return { store };
}

const scrolled: string[] = [];
HTMLElement.prototype.scrollIntoView = function (this: HTMLElement) {
  scrolled.push(this.dataset.uuid ?? "");
};

async function openHit() {
  await act(async () => {
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  });
  const input = screen.queryByLabelText("Buscar no histórico") as HTMLInputElement;
  await act(async () => {
    fireEvent.change(input, { target: { value: "agulha" } });
    fireEvent.submit(input);
  });
  await settle(() => screen.queryAllByText(/agulha/).length > 0);
  const hit = screen.queryByRole("list", { name: "Resultados da busca" })?.querySelector("button");
  expect(hit).not.toBeNull();
  await act(async () => {
    fireEvent.click(hit as HTMLElement);
  });
}

const shown = () =>
  [...document.querySelectorAll("[data-uuid]")].map((el) => (el as HTMLElement).dataset.uuid);

describe("leitor", () => {
  test("acerto da busca abre o transcript somente leitura no ponto do acerto", async () => {
    scrolled.length = 0;
    await setup();
    await openHit();
    const log = screen.queryByRole("log", { name: "Transcript" });
    expect(log).not.toBeNull();
    // The search dialog closed; the first page starts at the hit.
    expect(screen.queryByRole("dialog", { name: "Busca global" })).toBeNull();
    await settle(() => shown().length > 0);
    expect(shown()[0]).toBe(`m${HIT}`);
    expect(shown()).toHaveLength(50);
    expect(shown()).not.toContain("m0");
    // Scrolled to and marked.
    expect(scrolled).toEqual([`m${HIT}`]);
    const hitEl = document.querySelector(`[data-uuid="m${HIT}"]`);
    expect(hitEl?.getAttribute("aria-current")).toBe("true");
    // Same look as the chat: user and assistant bubbles, no message box.
    expect(hitEl?.className).toContain("bg-secondary");
    expect(document.querySelector('[data-uuid="m31"]')?.className).not.toContain("bg-secondary");
    expect(screen.queryByLabelText("Mensagem")).toBeNull();
    expect(screen.queryByText("alfa · p")).not.toBeNull();
  });

  test("transcript que não existe mais, ou host sem conexão, vira erro no banner sem quebrar", async () => {
    const { store } = await setup();
    const hostId = store.getState().hosts[0]?.id ?? "";
    const missing = await store.historyGet(hostId, "sumiu").catch(() => "rejeitou");
    expect(missing).toBeNull();
    expect(store.getState().error ?? "").toContain("not_found");
    const unknown = await store.historyGet("host-removido", "x").catch(() => "rejeitou");
    expect(unknown).toBeNull();
    expect(store.getState().error ?? "").toContain("offline");
  });

  test("rolar até o fim carrega a próxima página; Carregar anteriores traz o começo sem repetir", async () => {
    await setup();
    await openHit();
    await settle(() => shown().length === 50);
    expect(screen.queryByRole("log", { name: "Transcript" })).not.toBeNull();
    const log = screen.queryByRole("log", { name: "Transcript" }) as HTMLElement;
    // happy-dom has no layout: give the log a size and scroll it.
    Object.defineProperty(log, "clientHeight", { configurable: true, value: 200 });
    Object.defineProperty(log, "scrollHeight", { configurable: true, value: 1000 });
    log.scrollTop = 100;
    await act(async () => {
      fireEvent.scroll(log);
    });
    await act(() => Bun.sleep(50));
    expect(shown()).toHaveLength(50);

    log.scrollTop = 800;
    await act(async () => {
      fireEvent.scroll(log);
    });
    await settle(() => shown().length === TOTAL - HIT);
    expect(shown().at(-1)).toBe(`m${TOTAL - 1}`);

    const previous = screen.queryByRole("button", { name: "Carregar anteriores" });
    expect(previous).not.toBeNull();
    await act(async () => {
      fireEvent.click(previous as HTMLElement);
    });
    await settle(() => shown().length === TOTAL);
    expect(shown()).toEqual(Array.from({ length: TOTAL }, (_, i) => `m${i}`));
    expect(screen.queryByRole("button", { name: "Carregar anteriores" })).toBeNull();
  });

  test("uma linha de resumo (que não é mensagem) aparece como nota centralizada, sem balão", async () => {
    const d = makeDaemon(cleanups);
    writeTranscript(d.historyRoot, "-p", "com-resumo", [
      summaryLine("Resumo da conversa", "m0"),
      userLine({ uuid: "m0", text: "primeira", cwd: d.project }),
    ]);
    d.history.scan();
    const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
    render(<App store={store} />);
    await act(async () => {
      await store.addHost({ name: "alfa", url: d.listen().url, token: TOKEN });
    });
    await settle(() => store.getState().hosts[0]?.status === "online");
    const hostId = store.getState().hosts[0]?.id ?? "";
    await act(async () => {
      store.router.push({
        name: "reader",
        target: { hostId, claudeSessionId: "com-resumo" },
      });
    });
    const log = () => screen.queryByRole("log", { name: "Transcript" }) as HTMLElement;
    await settle(() => log() !== null && within(log()).queryByText("Resumo da conversa") !== null);
    const note = within(log()).queryByText("Resumo da conversa");
    expect(note).not.toBeNull();
    expect(note?.className ?? "").toContain("text-center");
    expect(note?.className ?? "").not.toContain("bg-secondary");
    expect(within(log()).queryByText("primeira")?.className ?? "").toContain("bg-secondary");
  });
});
