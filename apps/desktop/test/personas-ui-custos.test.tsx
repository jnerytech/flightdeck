import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { poll } from "../../daemon/test/helpers.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";

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
  while (!check() && Date.now() < deadline) await act(() => Bun.sleep(15));
}

/** 2026-10-15 12:00 UTC, as in custos-ui. */
const START = Date.UTC(2026, 9, 15, 12);
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function spend(d: ReturnType<typeof makeDaemon>, id: string, session: string, cost: number) {
  d.eventStore.db
    .query(
      `INSERT INTO usage_entries (message_id, claude_session_id, at, day, project_key, model, origin,
         speed, input, output, cache_read, cache_write_5m, cache_write_1h, cost_usd)
       VALUES (?, ?, '2026-10-15T12:00:00.000Z', '2026-10-15', 'kA', 'claude-opus-5-5', 'app',
         'standard', 10, 5, 0, 0, 0, ?)`,
    )
    .run(id, session, cost);
}

describe("personas-ui: costs", () => {
  test("Custos breaks the cost down by persona, by its name, and the rest as Sem persona", async () => {
    const d = makeDaemon(cleanups, { costs: true, personas: true });
    const { sessionId } = d.manager.create({ cwd: d.project, prompt: "oi", persona: { id: "qa" } });
    const claude = await poll(() => d.manager.get(sessionId).claudeSessionId);
    spend(d, "m1", claude ?? "", 3);
    spend(d, "m2", "s-terminal", 1);
    const store = new AppStore(memoryPlatform(false).platform, {
      baseDelayMs: 60_000,
      now: () => START,
      day: utcDay,
    });
    cleanups.push(() => store.dispose());
    render(<App store={store} />);
    await act(async () => {
      await store.addHost({ name: "alfa", url: d.listen().url, token: TOKEN });
    });
    await settle(() => store.getState().hosts[0]?.hostInfo?.features?.includes("costs") === true);
    const nav = screen.queryByRole("button", { name: "Custos" });
    await act(async () => {
      fireEvent.click(nav as HTMLElement);
    });
    const rows = () =>
      [
        ...(screen.queryByRole("region", { name: "Por persona" })?.querySelectorAll("tbody tr") ??
          []),
      ].map((r) => r.textContent);
    await settle(() => rows().length === 2 && rows()[0]?.includes("QA") === true);
    expect(rows()).toEqual(["QA / testesUS$ 3.00", "Sem personaUS$ 1.00"]);
  });
});
