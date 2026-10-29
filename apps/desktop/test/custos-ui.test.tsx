import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { userLine, writeTranscript } from "../../daemon/test/history-helpers.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { legacyDaemon } from "./legacy-daemon.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(20_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function settle(check: () => boolean, timeoutMs = 4000): Promise<void> {
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

const choose = async (label: string, value: string) => {
  const field = screen.queryByLabelText(label) as HTMLInputElement | HTMLSelectElement | null;
  expect(field).not.toBeNull();
  await act(async () => {
    fireEvent.change(field as HTMLElement, { target: { value } });
  });
};

/** 2026-10-15 12:00 UTC; days counted in UTC so the test does not depend on the machine. */
const START = Date.UTC(2026, 9, 15, 12);
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

type Daemon = ReturnType<typeof makeDaemon>;
let seq = 0;
function spend(
  d: Daemon,
  e: {
    day: string;
    key: string;
    model?: string;
    origin?: string;
    cost: number | null;
    session?: string;
    cacheRead?: number;
  },
) {
  d.eventStore.db
    .query(
      `INSERT INTO usage_entries (message_id, claude_session_id, at, day, project_key, model, origin,
         speed, input, output, cache_read, cache_write_5m, cache_write_1h, cost_usd)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'standard', 10, 5, ?, 0, 0, ?)`,
    )
    .run(
      `m${++seq}`,
      e.session ?? "s-term",
      `${e.day}T12:00:00.000Z`,
      e.day,
      e.key,
      e.model ?? "claude-opus-5-5",
      e.origin ?? "terminal",
      e.cacheRead ?? 0,
      e.cost,
    );
}

/** A daemon with costs and entries over October and the end of September, and the app on it. */
async function online(features?: string[]) {
  const d = makeDaemon(cleanups, { costs: true });
  spend(d, { day: "2026-10-15", key: "kA", cost: 1.5, cacheRead: 1_000_000 });
  spend(d, { day: "2026-10-15", key: "kB", model: "claude-sonnet-5-5", origin: "app", cost: 0.5 });
  spend(d, { day: "2026-10-14", key: "kA", origin: "card", cost: 2 });
  spend(d, { day: "2026-10-01", key: "kA", cost: 4 });
  spend(d, { day: "2026-09-30", key: "kA", cost: 8 });
  const server = d.listen(0, undefined, features);
  const mem = memoryPlatform(false);
  const store = new AppStore(mem.platform, { baseDelayMs: 60_000, now: () => START, day: utcDay });
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "alfa", url: server.url, token: TOKEN });
  });
  await settle(() => store.getState().hosts[0]?.hostInfo !== null);
  return { d, mem, store };
}

const text = (label: string) => screen.queryByLabelText(label)?.textContent ?? "";
const region = (name: string) => screen.queryByRole("region", { name });

describe("custos-ui", () => {
  test("tela Custos: período, totais, economia do cache, gráfico por dia empilhado por projeto, quebras e o aviso de estimativa", async () => {
    await online();
    await click("Custos");
    await settle(() => text("Custo estimado") === "US$ 4.00");
    expect(text("Custo estimado")).toBe("US$ 4.00");
    expect(text("Economia do cache")).toBe("US$ 3.80");
    expect(text("Tokens")).toBe("1000045");
    expect(
      screen.queryByText("equivalente em API, estimado; em assinatura, não é cobrado"),
    ).not.toBeNull();
    const chart = region("Custo por dia");
    expect(chart?.querySelectorAll("[data-day]").length).toBe(7);
    expect(
      [...(chart?.querySelectorAll("[role=img]") ?? [])].map((s) => s.getAttribute("aria-label")),
    ).toEqual([
      "2026-10-14 · kA: US$ 2.00",
      "2026-10-15 · kA: US$ 1.50",
      "2026-10-15 · kB: US$ 0.50",
    ]);
    const rows = (name: string) =>
      [...(region(name)?.querySelectorAll("tbody tr") ?? [])].map((r) => r.textContent);
    expect(rows("Por modelo")).toEqual(["claude-opus-5-5US$ 3.50", "claude-sonnet-5-5US$ 0.50"]);
    expect(rows("Por origem")).toEqual(["cardUS$ 2.00", "terminalUS$ 1.50", "appUS$ 0.50"]);
    expect(rows("Por projeto")).toEqual(["kAUS$ 3.50", "kBUS$ 0.50"]);
    const total = async (period: string, expected: string) => {
      await click(period);
      await settle(() => text("Custo estimado") === expected);
      return text("Custo estimado");
    };
    expect(await total("Hoje", "US$ 2.00")).toBe("US$ 2.00");
    expect(await total("Mês atual", "US$ 8.00")).toBe("US$ 8.00");
    expect(await total("30 dias", "US$ 16.00")).toBe("US$ 16.00");
    await click("Intervalo");
    await choose("De", "2026-10-01");
    await choose("Até", "2026-10-01");
    await settle(() => text("Custo estimado") === "US$ 4.00");
    expect(text("Custo estimado")).toBe("US$ 4.00");
  });

  test("filtros por projeto, modelo e origem", async () => {
    await online();
    await click("Custos");
    await settle(() => text("Custo estimado") === "US$ 4.00");
    await choose("Projeto", "kB");
    await settle(() => text("Custo estimado") === "US$ 0.50");
    expect(text("Custo estimado")).toBe("US$ 0.50");
    await choose("Projeto", "");
    await choose("Modelo", "claude-opus-5-5");
    await settle(() => text("Custo estimado") === "US$ 3.50");
    expect(text("Custo estimado")).toBe("US$ 3.50");
    await choose("Modelo", "");
    await choose("Origem", "card");
    await settle(() => text("Custo estimado") === "US$ 2.00");
    expect(text("Custo estimado")).toBe("US$ 2.00");
  });

  test("top sessões abrem a sessão; modelo sem preço e tabela desatualizada aparecem", async () => {
    const { d, store } = await online();
    const managed = d.manager.create({ cwd: d.project, prompt: "oi" });
    await settle(() => d.manager.get(managed.sessionId).claudeSessionId !== null);
    const claudeId = d.manager.get(managed.sessionId).claudeSessionId as string;
    spend(d, { day: "2026-10-15", key: "kA", cost: 9, session: claudeId });
    d.eventStore.db
      .query(
        "INSERT INTO events (session_id, seq, ts, type, payload) VALUES (?, 999, 'x', 'turn.result', ?)",
      )
      .run(managed.sessionId, JSON.stringify({ type: "turn.result", costUsd: 30 }));
    writeTranscript(d.historyRoot, "-p", "s-hist", [
      userLine({ uuid: "u1", text: "Lido do histórico", cwd: d.project }),
    ]);
    d.history.scan();
    spend(d, { day: "2026-10-15", key: "kA", cost: 5, session: "s-hist" });
    spend(d, { day: "2026-10-15", key: "kA", model: "claude-mystery-9", cost: null });
    await click("Custos");
    await settle(() => region("Top sessões")?.querySelector("button") !== null);
    expect(screen.queryByText("sem preço: claude-mystery-9")).not.toBeNull();
    expect(screen.queryByText(/tabela de preços pode estar desatualizada/)).not.toBeNull();
    const top = [...(region("Top sessões")?.querySelectorAll("button") ?? [])].map(
      (b) => b.textContent,
    );
    expect(top[0]).toContain("US$ 9.00");
    expect(top[1]).toContain("Lido do histórico");
    await act(async () => {
      fireEvent.click(region("Top sessões")?.querySelectorAll("button")[0] as HTMLElement);
    });
    expect(store.getState().selected).toEqual({
      hostId: store.getState().hosts[0]?.id ?? "",
      sessionId: managed.sessionId,
    });
    await click("Custos");
    await settle(() => region("Top sessões")?.querySelector("button") !== null);
    await act(async () => {
      fireEvent.click(region("Top sessões")?.querySelectorAll("button")[1] as HTMLElement);
    });
    // The reader loads the transcript after it opens.
    await settle(() => screen.queryAllByText(/Lido do histórico/).length > 0);
    expect(region("Custos")).toBeNull();
    expect(screen.queryAllByText(/Lido do histórico/).length).toBeGreaterThan(0);
  });

  test("Exportar CSV salva pelo diálogo do sistema; cancelar não reclama", async () => {
    const { mem, store } = await online();
    await click("Custos");
    await settle(() => text("Custo estimado") === "US$ 4.00");
    await click("Exportar CSV");
    await settle(() => mem.saved.length > 0);
    expect(mem.saved[0]?.name).toBe("flightdeck-custos-2026-10-09-a-2026-10-15.csv");
    expect(mem.saved[0]?.text.split("\n")[0]).toBe(
      "day,project_key,model,origin,input,output,cache_read,cache_write_5m,cache_write_1h,cost_usd",
    );
    mem.save.cancel = true;
    await click("Exportar CSV");
    await act(() => Bun.sleep(50));
    expect(mem.saved).toHaveLength(1);
    expect(store.getState().error).toBeNull();
  });

  test("o painel de uso do host passa a ler os custos quando o host anuncia costs", async () => {
    await online();
    await click("Abrir host alfa");
    await settle(() => region("Uso dos últimos 7 dias")?.querySelector("tbody tr") !== null);
    expect(
      [...(region("Uso dos últimos 7 dias")?.querySelectorAll("tbody tr") ?? [])].map(
        (r) => r.textContent,
      ),
    ).toEqual(["2026-10-15kAUS$ 1.501000015", "2026-10-15kBUS$ 0.5015", "2026-10-14kAUS$ 2.0015"]);
  });

  test("host sem costs: sem tela de custos e sem banner de erro", async () => {
    const legacy = legacyDaemon(cleanups);
    const mem = memoryPlatform(false);
    const store = new AppStore(mem.platform, {
      baseDelayMs: 60_000,
      now: () => START,
      day: utcDay,
    });
    render(<App store={store} />);
    await act(async () => {
      await store.addHost({ name: "velho", url: legacy.url, token: TOKEN });
    });
    await settle(() => store.getState().hosts[0]?.status === "online");
    await act(() => Bun.sleep(50));
    expect(screen.queryByRole("button", { name: "Custos" })).toBeNull();
    expect(legacy.asked.some((t) => t.startsWith("costs."))).toBe(false);
    expect(store.getState().error).toBeNull();
    // A phase 7 host (quota, no costs) keeps the usage panel of the SDK.
    cleanup();
    await online(["quota"]);
    await click("Abrir host alfa");
    expect(screen.queryByRole("button", { name: "Custos" })).toBeNull();
    expect(screen.queryByText(/Só sessões gerenciadas/)).not.toBeNull();
  });

  test("no app desktop, salvar usa o seletor de arquivos do WebView; sem seletor, o app avisa", async () => {
    const { tauriPlatform } = await import("../src/platform/tauri/index.ts");
    const mem = memoryPlatform(false);
    const writes: string[] = [];
    const desktop = tauriPlatform({
      localStorage: mem.win.localStorage,
      document: { hasFocus: () => false },
      navigator: { clipboard: { writeText: async () => {} } },
      showSaveFilePicker: async () => ({
        createWritable: async () => ({
          write: async (chunk: string) => {
            writes.push(chunk);
          },
          close: async () => {},
        }),
      }),
    });
    expect(await desktop.saveFile("a.csv", "x,y").catch(() => false)).toBe(true);
    expect(writes).toEqual(["x,y"]);
    const { showSaveFilePicker: _none, ...noPicker } = mem.win;
    const { createWebPlatform } = await import("../src/platform/web/index.ts");
    const store = new AppStore(createWebPlatform(noPicker), { now: () => START, day: utcDay });
    expect(await store.saveFile("a.csv", "x")).toBe(false);
    expect(store.getState().error).toBe("salvar arquivo indisponível nesta plataforma");
  });
  test("com dois hosts, a tela troca de host", async () => {
    const { store } = await online();
    const other = makeDaemon(cleanups, { costs: true });
    spend(other, { day: "2026-10-15", key: "kZ", cost: 7 });
    const second = other.listen();
    await act(async () => {
      await store.addHost({ name: "beta", url: second.url, token: TOKEN });
    });
    await settle(() => store.getState().hosts[1]?.hostInfo !== null);
    await click("Custos");
    await settle(() => text("Custo estimado") === "US$ 4.00");
    await choose("Host dos custos", store.getState().hosts[1]?.id ?? "");
    await settle(() => text("Custo estimado") === "US$ 7.00");
    expect(text("Custo estimado")).toBe("US$ 7.00");
  });

  test("sem dia injetado, hoje é o dia desta máquina", () => {
    const local = new AppStore(memoryPlatform(false).platform, { now: () => START });
    const today = (() => {
      try {
        return local.today();
      } catch {
        return "";
      }
    })();
    expect(today).toBe(new Date(START).toLocaleDateString("sv-SE"));
  });
});
