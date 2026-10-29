import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Quota } from "../../daemon/src/quota/quota.ts";
import { git } from "../../daemon/test/board-helpers.ts";
import { manualTime } from "../../daemon/test/time-helpers.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { legacyDaemon } from "./legacy-daemon.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

// Real git under the in-process daemon: more than the default 5 s.
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

/** Times shown as UTC HH:MM, so the test does not depend on the machine's time zone. */
const utcTime = (iso: string) => new Date(iso).toISOString().slice(11, 16);
const START = Date.UTC(2026, 9, 1, 12, 0, 0);
const MINUTE = 60_000;

/** A host whose quota runs on a manual clock, and the app online on it, 12 minutes later. */
async function online(language = "pt-BR") {
  const time = manualTime(START);
  const quota = new Quota({ pauseAt: 0.9, now: time.now, timers: time.timers });
  const d = makeDaemon(cleanups, { quota });
  const server = d.listen();
  const mem = memoryPlatform(false, language);
  const store = new AppStore(mem.platform, {
    baseDelayMs: 60_000,
    now: () => time.now() + 12 * MINUTE,
    formatTime: utcTime,
  });
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "alfa", url: server.url, token: TOKEN });
  });
  await settle(() => store.getState().hosts[0]?.status === "online");
  return { ...d, ...mem, time, quota, store };
}

const card = () => screen.queryByRole("region", { name: "Cota de alfa" });
const bar = (label: string) => card()?.querySelector(`[data-window="${label}"]`) ?? null;
const inBar = (label: string, text: string) => within(bar(label) as HTMLElement).queryByText(text);

describe("cota-ui", () => {
  test("barras de 5 horas e 7 dias com porcentagem, reinício e idade; vermelho a partir de pauseAt", async () => {
    const { quota } = await online();
    await act(async () => {
      quota.record([
        {
          window: "five_hour",
          utilization: 0.42,
          status: "allowed",
          resetsAt: START + 3 * 60 * MINUTE,
        },
        {
          window: "seven_day",
          utilization: 0.95,
          status: "allowed",
          resetsAt: START + 48 * 60 * MINUTE,
        },
      ]);
    });
    await settle(() => bar("five_hour") !== null);
    // One card per host, in a grid: the host's name, then each window with its bar.
    expect(within(card() as HTMLElement).queryByRole("heading", { name: "alfa" })).not.toBeNull();
    expect(card()?.parentElement?.className ?? "").toContain("grid");
    expect(inBar("five_hour", "5 horas")).not.toBeNull();
    expect(inBar("five_hour", "42%")).not.toBeNull();
    expect(inBar("five_hour", "reinicia às 15:00")).not.toBeNull();
    expect(inBar("five_hour", "lida há 12 min")).not.toBeNull();
    expect(inBar("seven_day", "7 dias")).not.toBeNull();
    expect(inBar("seven_day", "95%")).not.toBeNull();
    expect(inBar("seven_day", "reinicia às 12:00")).not.toBeNull();
    expect(bar("five_hour")?.getAttribute("data-hot")).toBe("false");
    expect(bar("seven_day")?.getAttribute("data-hot")).toBe("true");
    expect(inBar("five_hour", "42%")?.className).not.toContain("text-status-error");
    expect(inBar("seven_day", "95%")?.className).toContain("text-status-error");
    const meter = screen.queryByRole("meter", { name: "7 dias de alfa" });
    expect(meter?.getAttribute("aria-valuenow")).toBe("0.95");
    expect(meter?.getAttribute("aria-valuemax")).toBe("1");
    // Over pauseAt: new cards wait, manual sessions go on, and the app says so.
    expect(screen.queryByText(/cards novos esperam a cota; sessões manuais seguem/)).not.toBeNull();
  });

  test('host sem leitura mostra só "sem leitura ainda", sem barras vazias', async () => {
    await online();
    await settle(() => card() !== null);
    expect(within(card() as HTMLElement).queryByText("sem leitura ainda")).not.toBeNull();
    expect(within(card() as HTMLElement).queryByRole("heading", { name: "alfa" })).not.toBeNull();
    expect(within(card() as HTMLElement).queryAllByRole("meter")).toEqual([]);
    expect(bar("five_hour")).toBeNull();
  });

  test("em inglês, o painel de cota inteiro fala inglês, inclusive o aviso", async () => {
    const { quota } = await online("en-US");
    await act(async () => {
      quota.record([
        {
          window: "five_hour",
          utilization: 0.95,
          status: "allowed",
          resetsAt: START + 3 * 60 * MINUTE,
        },
      ]);
    });
    await settle(() => bar("five_hour") !== null);
    expect(inBar("five_hour", "5 hours")).not.toBeNull();
    expect(inBar("five_hour", "95%")).not.toBeNull();
    expect(inBar("five_hour", "resets at 15:00")).not.toBeNull();
    expect(inBar("five_hour", "read 12 min ago")).not.toBeNull();
    // The window with no reading says so, in English, without an empty bar.
    expect(within(card() as HTMLElement).queryByText("no reading yet")).not.toBeNull();
    expect(
      screen.queryByText(/over 90%: new cards wait for the quota; manual sessions go on/),
    ).not.toBeNull();
    expect(card()?.textContent ?? "").not.toMatch(/horas|reinicia|lida|leitura/);
  });

  test("cruzar o pauseAt notifica uma vez por janela", async () => {
    const { quota, notifications } = await online();
    const resets = START + 60 * MINUTE;
    const reading = (utilization: number, resetsAt = resets) => [
      { window: "five_hour", utilization, status: "allowed" as const, resetsAt },
    ];
    await act(async () => quota.record(reading(0.5)));
    await act(async () => quota.record(reading(0.92)));
    await act(async () => quota.record(reading(0.97)));
    await settle(() => notifications.length > 0);
    expect(notifications).toEqual([{ title: "Cota do plano", body: "alfa: 5 horas em 92%" }]);
    // A new window (another reset) may notify again.
    await act(async () => quota.record(reading(0.93, resets + 5 * 60 * MINUTE)));
    await settle(() => notifications.length > 1);
    expect(notifications.map((n) => n.body)).toEqual([
      "alfa: 5 horas em 92%",
      "alfa: 5 horas em 93%",
    ]);
  });

  test("painel de uso do host: últimos 7 dias, por dia e projeto", async () => {
    const { manager, project, store } = await online();
    const { sessionId } = manager.create({ cwd: project, prompt: "[cost:0.5]" });
    await settle(() => manager.get(sessionId).status === "idle");
    await click("Abrir host alfa");
    await settle(() =>
      (
        screen.queryByRole("region", { name: "Uso dos últimos 7 dias" })?.textContent ?? ""
      ).includes("US$"),
    );
    const panel = screen.queryByRole("region", { name: "Uso dos últimos 7 dias" });
    const rows = [...(panel?.querySelectorAll("tbody tr") ?? [])].map((tr) => tr.textContent ?? "");
    expect(rows).toHaveLength(1);
    expect(rows[0] ?? "").toContain(project);
    expect(rows[0] ?? "").toContain("US$ 0.50");
    expect(rows[0] ?? "").toContain("1 turno");
    expect(store.getState().hosts).toHaveLength(1);
  });

  test("card na fila pela cota mostra até quando espera", async () => {
    const { quota, board, root, store } = await online();
    const repo = join(root, "repo");
    mkdirSync(repo);
    git(repo, "init", "-q", "-b", "main");
    git(repo, "config", "commit.gpgsign", "false");
    writeFileSync(join(repo, "README.md"), "# repo\n");
    git(repo, "add", ".");
    git(repo, "commit", "-q", "-m", "inicial");
    const project = await board.addProject({ path: repo, promptTemplate: "" });
    quota.record([
      { window: "five_hour", utilization: 0.99, status: "allowed", resetsAt: START + 150 * MINUTE },
    ]);
    const card = board.createCard(project.id, { title: "Espera", description: "oi" });
    await board.startCard(card.id);
    await click("Projetos de alfa");
    await settle(() => screen.queryByRole("button", { name: "Abrir board de repo" }) !== null);
    await click("Abrir board de repo");
    await settle(() =>
      (screen.queryByLabelText("Card Espera")?.textContent ?? "").includes("cota"),
    );
    expect(screen.queryByLabelText("Card Espera")?.textContent ?? "").toContain(
      "aguardando cota até 14:30",
    );
    expect(store.getState().cards).toBeDefined();
  });

  test("sem reinício conhecido, o card só diz que aguarda a cota; a hora padrão é HH:MM local", async () => {
    const { quota, board, root } = await online();
    const repo = join(root, "repo");
    mkdirSync(repo);
    git(repo, "init", "-q", "-b", "main");
    git(repo, "config", "commit.gpgsign", "false");
    writeFileSync(join(repo, "README.md"), "# repo\n");
    git(repo, "add", ".");
    git(repo, "commit", "-q", "-m", "inicial");
    const project = await board.addProject({ path: repo, promptTemplate: "" });
    quota.record([{ window: "five_hour", utilization: 1, status: "rejected", resetsAt: null }]);
    const card = board.createCard(project.id, { title: "Sem hora", description: "oi" });
    await board.startCard(card.id);
    await click("Projetos de alfa");
    await settle(() => screen.queryByRole("button", { name: "Abrir board de repo" }) !== null);
    await click("Abrir board de repo");
    await settle(() =>
      (screen.queryByLabelText("Card Sem hora")?.textContent ?? "").includes("cota"),
    );
    expect(screen.queryByLabelText("Card Sem hora")?.textContent ?? "").toContain(
      "aguardando cota",
    );
    expect(screen.queryByLabelText("Card Sem hora")?.textContent ?? "").not.toContain("até");
    const plain = new AppStore(memoryPlatform().platform);
    const at = new Date(2026, 9, 1, 9, 5);
    expect(plain.formatTime(at.toISOString())).toBe("09:05");
  });

  test("host sem quota, ou da fase 6 sem features: sem barras nem painel de uso, e sem banner de erro", async () => {
    const d = makeDaemon(cleanups);
    const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
    render(<App store={store} />);
    await act(async () => {
      await store.addHost({
        name: "sem",
        url: d.listen(0, undefined, ["central", "workflows"]).url,
        token: TOKEN,
      });
      await store.addHost({ name: "velho", url: legacyDaemon(cleanups).url, token: TOKEN });
    });
    await settle(() =>
      store.getState().hosts.every((h) => h.status === "online" && h.hostInfo !== null),
    );
    await act(() => Bun.sleep(100));
    expect(screen.queryByRole("region", { name: "Cota de sem" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Cota de velho" })).toBeNull();
    for (const name of ["sem", "velho"]) {
      await click(`Abrir host ${name}`);
      await settle(() => screen.queryByRole("heading", { name }) !== null);
      await act(() => Bun.sleep(100));
      expect(screen.queryByRole("region", { name: "Uso dos últimos 7 dias" })).toBeNull();
    }
    expect(store.getState().error).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
