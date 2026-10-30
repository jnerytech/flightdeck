import { afterEach, describe, expect, test } from "bun:test";
import { appendFileSync } from "node:fs";
import { type HistoryChange, HistoryIndexer } from "../../daemon/src/history/indexer.ts";
import { EventStore } from "../../daemon/src/store/event-store.ts";
import { tempDir } from "../../daemon/test/helpers.ts";
import { userLine, writeTranscript } from "../../daemon/test/history-helpers.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { sidebarNav } from "./sidebar.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const sidebar = sidebarNav({ act, fireEvent, screen });
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** Timers the test runs by hand: nothing here waits on the real clock. */
function manualTimers() {
  const timeouts: Array<{ fn: () => void; ms: number }> = [];
  const intervals: Array<{ fn: () => void; ms: number }> = [];
  return {
    timeouts,
    intervals,
    setTimeout: (fn: () => void, ms: number) => {
      timeouts.push({ fn, ms });
      return timeouts.length as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout: () => {},
    setInterval: (fn: () => void, ms: number) => {
      intervals.push({ fn, ms });
      return intervals.length as unknown as ReturnType<typeof setInterval>;
    },
    clearInterval: () => {},
    /** Runs (and drops) every pending timeout. */
    flush() {
      for (const { fn } of timeouts.splice(0)) fn();
    },
  };
}

describe("ao-vivo: history.changed", () => {
  function setup(watchDebounceMs?: number) {
    const store = new EventStore(":memory:");
    const root = tempDir();
    const file = writeTranscript(root, "-p", "s1", [
      userLine({ uuid: "u1", text: "primeira", cwd: "/p", ts: "2026-10-29T10:00:00.000Z" }),
    ]);
    const timers = manualTimers();
    const watched: Array<() => void> = [];
    const indexer = new HistoryIndexer({
      db: store.db,
      roots: [root],
      timers,
      watch: (_root, onEvent) => {
        watched.push(onEvent);
        return { close: () => {} };
      },
      ...(watchDebounceMs ? { watchDebounceMs } : {}),
    });
    const changes: HistoryChange[] = [];
    indexer.onChange((change) => changes.push(change));
    indexer.start();
    cleanups.push(() => indexer.stop());
    timers.flush(); // boot pass, which also publishes the first indexing
    changes.length = 0;
    return { file, timers, watched, changes };
  }

  test("linha nova no transcript observado gera history.changed no intervalo configurado", () => {
    const { file, timers, watched, changes } = setup(300);
    appendFileSync(
      file,
      `${userLine({ uuid: "u2", text: "segunda", cwd: "/p", ts: "2026-10-29T10:01:00.000Z" })}\n`,
    );
    expect(watched).toHaveLength(1);
    watched[0]?.();
    watched[0]?.(); // a burst of file events is one pass
    expect(timers.timeouts.map((t) => t.ms)).toEqual([300]);
    expect(changes).toEqual([]);
    timers.flush();
    expect(changes.map((c) => [c.claudeSessionId, c.lastTs])).toEqual([
      ["s1", "2026-10-29T10:01:00.000Z"],
    ]);
  });

  test("os padrões cabem nos 2 s da spec, e a varredura periódica continua como reserva", () => {
    const { timers, watched } = setup();
    watched[0]?.();
    expect(timers.timeouts[0]?.ms ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(2_000);
    expect(timers.intervals.map((i) => i.ms)).toEqual([10_000]);
  });
});

describe("ao-vivo: o leitor", () => {
  test("acrescenta as mensagens novas sem recarregar a página", async () => {
    const d = makeDaemon(cleanups);
    const file = writeTranscript(d.historyRoot, "-p", "viva", [
      userLine({ uuid: "u1", text: "começo", cwd: d.project, ts: "2026-10-29T10:00:00.000Z" }),
    ]);
    d.history.scan();
    const server = d.listen();
    const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
    render(<App store={store} />);
    await act(async () => {
      await store.addHost({ name: "alfa", url: server.url, token: TOKEN });
    });
    const settle = async (check: () => boolean) => {
      const deadline = Date.now() + 3000;
      while (!check() && Date.now() < deadline) await act(() => Bun.sleep(10));
    };
    await settle(() => store.getState().hosts[0]?.status === "online");
    await sidebar.hostAction("Histórico");
    const firstRow = () =>
      screen.queryByRole("list", { name: "Sessões do histórico" })?.querySelector("button") ?? null;
    await settle(() => firstRow() !== null);
    const open = firstRow();
    expect(open).not.toBeNull();
    await act(async () => {
      fireEvent.click(open as HTMLElement);
    });
    await settle(() => document.querySelector('[data-uuid="u1"]') !== null);
    const first = document.querySelector('[data-uuid="u1"]');
    expect(first).not.toBeNull();

    appendFileSync(
      file,
      `${userLine({ uuid: "u2", text: "linha nova", cwd: d.project, ts: "2026-10-29T10:02:00.000Z" })}\n`,
    );
    d.history.scan();
    await settle(() => document.querySelector('[data-uuid="u2"]') !== null);
    expect(document.querySelector('[data-uuid="u2"]')?.textContent ?? "").toContain("linha nova");
    // Same element: appended, not reloaded.
    expect(document.querySelector('[data-uuid="u1"]')).toBe(first);
  });
});
