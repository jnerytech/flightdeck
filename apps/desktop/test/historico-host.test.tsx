import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { userLine, writeTranscript } from "../../daemon/test/history-helpers.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN, waitFor } from "./fixtures.ts";

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

const anHourAgo = () => new Date(Date.now() - 3_600_000);

/**
 * Three transcripts on one host: two finished an hour ago (one in another folder) and a fresh
 * one that belongs to a session the daemon manages.
 */
async function setup() {
  const d = makeDaemon(cleanups);
  const other = join(d.root, "outra");
  mkdirSync(other);
  const old = writeTranscript(d.historyRoot, "-p", "s-antiga", [
    userLine({
      uuid: "u1",
      text: "Revisar o build",
      cwd: d.project,
      ts: "2026-09-01T10:00:00.000Z",
    }),
  ]);
  const elsewhere = writeTranscript(d.historyRoot, "-outra", "s-outra", [
    userLine({ uuid: "u1", text: "Outra pasta", cwd: other, ts: "2026-09-05T14:00:00.000Z" }),
  ]);
  utimesSync(old, anHourAgo(), anHourAgo());
  utimesSync(elsewhere, anHourAgo(), anHourAgo());
  const { sessionId } = d.manager.create({ cwd: d.project, prompt: "oi" });
  const managed = await waitFor(() => d.manager.get(sessionId).claudeSessionId);
  writeTranscript(d.historyRoot, "-p", managed, [
    userLine({
      uuid: "u1",
      text: "Sessão do Flightdeck",
      cwd: d.project,
      ts: "2026-09-10T09:00:00.000Z",
    }),
  ]);
  d.history.scan();
  const server = d.listen();
  const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "alfa", url: server.url, token: TOKEN });
  });
  await settle(() => store.getState().hosts[0]?.status === "online");
  return { store, other };
}

const rows = () =>
  [
    ...(screen.queryByRole("list", { name: "Sessões do histórico" })?.querySelectorAll("li") ?? []),
  ].map((li) => li.textContent ?? "");

async function openHistory() {
  const button = screen.queryByRole("button", { name: "Histórico de alfa" });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
  await settle(() => rows().length > 0);
}

async function filter(fields: { pasta?: string; de?: string; ate?: string; origem?: string }) {
  const set = (label: string, value: string | undefined) => {
    const input = screen.queryByLabelText(label) as HTMLInputElement | null;
    expect(input).not.toBeNull();
    fireEvent.change(input as HTMLInputElement, { target: { value: value ?? "" } });
  };
  await act(async () => {
    set("Pasta", fields.pasta);
    set("De", fields.de);
    set("Até", fields.ate);
    set("Origem", fields.origem);
  });
  const apply = screen.queryByRole("button", { name: "Filtrar" });
  expect(apply).not.toBeNull();
  await act(async () => {
    fireEvent.click(apply as HTMLElement);
  });
  await act(() => Bun.sleep(50));
}

describe("historico-host", () => {
  test("lista as sessões do host com título, pasta, data, origem e o selo de possivelmente em uso", async () => {
    await setup();
    await openHistory();
    expect(rows()).toHaveLength(3);
    const [managed, elsewhere, old] = rows();
    expect(managed).toContain("Sessão do Flightdeck");
    expect(managed).toContain("Flightdeck");
    expect(managed).toContain("2026-09-10 09:00");
    expect(managed).toContain("possivelmente em uso");
    expect(elsewhere).toContain("Outra pasta");
    expect(elsewhere).toContain("outra");
    expect(elsewhere).toContain("externa");
    expect(elsewhere).not.toContain("possivelmente em uso");
    expect(old).toContain("Revisar o build");
    expect(old).toContain("2026-09-01 10:00");
    expect(old).not.toContain("possivelmente em uso");
  });

  test("filtros por pasta, período (dias inteiros) e origem", async () => {
    const { other } = await setup();
    await openHistory();
    await filter({ origem: "external" });
    expect(rows().map((r) => r.split(" · ")[0])).toEqual(["Outra pasta", "Revisar o build"]);
    await filter({ pasta: other });
    expect(rows().map((r) => r.split(" · ")[0])).toEqual(["Outra pasta"]);
    // From the 5th to the 5th: the whole day, so the 14:00 session stays.
    await filter({ de: "2026-09-05", ate: "2026-09-05" });
    expect(rows().map((r) => r.split(" · ")[0])).toEqual(["Outra pasta"]);
    await filter({ origem: "flightdeck" });
    expect(rows().map((r) => r.split(" · ")[0])).toEqual(["Sessão do Flightdeck"]);
    await filter({});
    expect(rows()).toHaveLength(3);
  });

  test("clicar numa sessão abre o leitor desde o começo", async () => {
    await setup();
    await openHistory();
    const first = screen
      .queryByRole("list", { name: "Sessões do histórico" })
      ?.querySelector("button");
    expect(first).not.toBeNull();
    await act(async () => {
      fireEvent.click(first as HTMLElement);
    });
    await settle(() => document.querySelectorAll("[data-uuid]").length > 0);
    expect(screen.queryByRole("log", { name: "Transcript" })).not.toBeNull();
    expect(document.querySelector("[aria-current]")).toBeNull();
    expect(screen.queryByRole("list", { name: "Sessões do histórico" })).toBeNull();
  });

  test("host sem conexão: a lista vira erro no banner", async () => {
    const { store } = await setup();
    const result = await store.historyList("host-removido", {}).catch(() => "rejeitou");
    expect(result).toBeNull();
    expect(store.getState().error ?? "").toContain("offline");
  });
});
