import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import { QuotaHistory } from "../../daemon/src/quota/history.ts";
import type { QuotaReading } from "../../daemon/src/runtime/types.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { workflowDaemon } from "./workflow-fixtures.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

// Real git under the in-process daemon: more than the default 5 s.
setDefaultTimeout(30_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function settle(check: () => boolean, timeoutMs = 6000): Promise<void> {
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

/** Times shown as UTC HH:MM, so the test does not depend on the machine's time zone. */
const utcTime = (iso: string) => new Date(iso).toISOString().slice(11, 16);
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 1, 12);
const RESET = T0 + 300 * MIN;

type Daemon = ReturnType<typeof makeDaemon>;
let seq = 0;
function spend(
  d: Pick<Daemon, "eventStore">,
  key: string,
  at: number,
  cost: number,
  session = "s",
) {
  d.eventStore.db
    .query(
      `INSERT INTO usage_entries (message_id, claude_session_id, at, day, project_key, model, origin,
         speed, input, output, cache_read, cache_write_5m, cache_write_1h, cost_usd)
       VALUES (?, ?, ?, ?, ?, 'claude-opus-5-5', 'terminal', 'standard', 1, 1, 0, 0, 0, ?)`,
    )
    .run(`q${++seq}`, session, new Date(at).toISOString(), utcDay(at), key, cost);
}

const five = (utilization: number): QuotaReading => ({
  window: "five_hour",
  utilization,
  status: "allowed",
  resetsAt: RESET,
});

/** A host with costs and quota samples on a manual clock, and the app on it an hour later. */
async function online(steadyWeek = false) {
  let now = T0;
  let history: QuotaHistory | null = null;
  const d = makeDaemon(cleanups, {
    costs: true,
    quotaHistory: (db) => {
      history = new QuotaHistory({ db, now: () => now });
      return history;
    },
  });
  const sample = (at: number, ...readings: QuotaReading[]) => {
    now = at;
    history?.sample(readings);
  };
  sample(T0, five(0.2), { ...five(0.1), window: "seven_day", resetsAt: T0 + 3 * 1440 * MIN });
  const week = { ...five(0.1), window: "seven_day", resetsAt: T0 + 3 * 1440 * MIN };
  sample(T0 + 30 * MIN, five(0.3), ...(steadyWeek ? [week] : []));
  sample(T0 + 60 * MIN, five(0.4), ...(steadyWeek ? [week] : []));
  spend(d, "kA", T0 + 10 * MIN, 3);
  spend(d, "kB", T0 + 20 * MIN, 1);
  const server = d.listen();
  const mem = memoryPlatform(false);
  const store = new AppStore(mem.platform, {
    baseDelayMs: 60_000,
    now: () => T0 + 60 * MIN,
    formatTime: utcTime,
    day: utcDay,
  });
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "alfa", url: server.url, token: TOKEN });
  });
  await settle(() => store.getState().hosts[0]?.hostInfo !== null);
  return { d, store };
}

const region = (name: string) => screen.queryByRole("region", { name });

describe("cota-ui-historico", () => {
  test("gráfico das janelas de 5 horas e 7 dias com projeção e quem consumiu", async () => {
    await online(true);
    await click("Custos");
    await settle(() => region("Janela de 5 horas")?.querySelector("[data-sample]") != null);
    expect(region("Janela de 5 horas")?.querySelectorAll("[data-sample]").length).toBe(3);
    expect(region("Janela de 5 horas")?.textContent).toContain(
      "no ritmo atual, a janela de 5 h esgota às 16:00",
    );
    // A steady week does not run out before it resets.
    expect(region("Janela de 7 dias")?.querySelectorAll("[data-sample]").length).toBe(3);
    expect(region("Janela de 7 dias")?.textContent).toContain("não esgota antes de 12:00");
    const consumers = region("Quem consumiu a janela de 5 horas");
    expect([...(consumers?.querySelectorAll("li") ?? [])].map((li) => li.textContent)).toEqual([
      "kA: 75% (US$ 3.00)",
      "kB: 25% (US$ 1.00)",
    ]);
    expect(consumers?.textContent).toContain("atribuição aproximada");
  });

  test("as barras da cota trazem a projeção no tooltip", async () => {
    const { d } = await online();
    await act(async () => {
      d.quota.record([five(0.4)]);
    });
    const bar = (window: string) =>
      region("Cota de alfa")?.querySelector(`[data-window="${window}"]`)?.getAttribute("title") ??
      "";
    await settle(() => bar("five_hour") !== "");
    expect(bar("five_hour")).toBe("no ritmo atual, a janela de 5 h esgota às 16:00");
    // A single reading of the week: nothing to project yet.
    expect(bar("seven_day")).toBe("poucas leituras para projetar");
  });

  test("custo estimado na linha da sessão, no detalhe, no card e na execução do workflow", async () => {
    const d = await workflowDaemon(
      cleanups,
      {
        wf: 'steps:\n  - id: plan\n    agent: { prompt: "plano" }\n  - id: ok\n    gate: { message: "Seguir?" }\n',
      },
      ["wf"],
      { costs: true },
    );
    // `project` is the board's project here; the plain folder is `<root>/p`.
    const managed = d.manager.create({ cwd: join(d.root, "p"), prompt: "oi" });
    await settle(() => d.manager.get(managed.sessionId).claudeSessionId !== null);
    spend(d, "kA", T0, 1.25, d.manager.get(managed.sessionId).claudeSessionId as string);
    const card = d.board.createCard(d.project.id, { title: "Somar", description: "x" });
    await d.board.startCard(card.id, { workflow: "wf" });
    const runId = d.board.getCard(card.id).workflowRunId ?? "";
    await settle(() => d.board.workflows.getRun(runId).status === "waiting");
    const step = d.board.workflows.getRun(runId).steps[0]?.sessionId ?? "";
    spend(d, "kA", T0, 2, d.manager.get(step).claudeSessionId as string);
    const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
    render(<App store={store} />);
    await act(async () => {
      await store.addHost({ name: "alfa", url: d.server.url, token: TOKEN });
    });
    await settle(() => store.getState().hosts[0]?.hostInfo !== null);
    await click("Abrir Sessões");
    const cost = (label: string) => screen.queryByLabelText(label)?.textContent ?? "";
    await settle(() => cost("Custo de p") !== "");
    expect(cost("Custo de p")).toBe("US$ 1.25");
    const row = screen.queryByRole("listitem", { name: "p" })?.querySelector("button") ?? null;
    expect(row).not.toBeNull();
    await act(async () => {
      fireEvent.click(row as HTMLElement);
    });
    await settle(() => cost("Custo da sessão") !== "");
    expect(cost("Custo da sessão")).toBe("US$ 1.25");
    await click("Projetos de alfa");
    await settle(() => screen.queryByRole("button", { name: "Abrir board de repo" }) !== null);
    await click("Abrir board de repo");
    await settle(() => screen.queryByLabelText("Card Somar") !== null);
    const open = screen.queryByLabelText("Card Somar")?.querySelector("button") ?? null;
    await act(async () => {
      fireEvent.click(open as HTMLElement);
    });
    await settle(() => cost("Custo da execução") !== "");
    expect(cost("Custo do card")).toBe("US$ 2.00");
    expect(cost("Custo da execução")).toBe("US$ 2.00");
  });
  test("o custo aparece na sessão criada pelo + sem passar pela tela Sessões", async () => {
    const d = makeDaemon(cleanups, { costs: true });
    const server = d.listen();
    const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
    render(<App store={store} />);
    await act(async () => {
      await store.addHost({ name: "alfa", url: server.url, token: TOKEN });
    });
    await settle(() => store.getState().hosts[0]?.hostInfo !== null);
    // "+" leaves the Sessões screen, whose list never sees the new session.
    await click("Nova sessão em alfa");
    const hostId = store.getState().hosts[0]?.id ?? "";
    let sessionId = "";
    await act(async () => {
      sessionId = (await store.createSession(hostId, { cwd: d.project, prompt: "oi" })) ?? "";
    });
    await settle(() => d.manager.get(sessionId).status === "idle");
    spend(d, "kA", T0, 0.75, d.manager.get(sessionId).claudeSessionId as string);
    // The next turn ends with the entry already there.
    d.manager.send(sessionId, "mais");
    const cost = () => screen.queryByLabelText("Custo da sessão")?.textContent ?? "";
    await settle(() => cost() !== "");
    expect(cost()).toBe("US$ 0.75");
  });
});
