import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { legacyDaemon } from "./legacy-daemon.ts";

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
  while (!check() && Date.now() < deadline) await act(() => Bun.sleep(10));
}

const click = async (name: string | RegExp) => {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
};

const item = (over: Record<string, unknown>) => ({
  kind: "tool",
  at: 0,
  toolName: null,
  durationMs: null,
  costUsd: null,
  success: null,
  error: null,
  decision: null,
  source: null,
  waitMs: null,
  ...over,
});

const PROMPTS = [
  {
    promptId: "p-1",
    startedAt: Date.UTC(2026, 10, 1, 12, 0, 0),
    endedAt: Date.UTC(2026, 10, 1, 12, 0, 13),
    costUsd: 0.03,
    waitMs: 7_000,
    items: [
      item({ kind: "api", durationMs: 800, costUsd: 0.01 }),
      item({ kind: "tool", toolName: "Read", durationMs: 150, success: true }),
      item({
        kind: "permission",
        toolName: "Bash",
        decision: "accept",
        source: "user_temporary",
        waitMs: 7_000,
      }),
      item({
        kind: "tool",
        toolName: "Bash",
        durationMs: 2_900,
        success: false,
        error: "ShellError",
      }),
      item({ kind: "error", error: "529", durationMs: 90 }),
    ],
  },
  {
    promptId: null,
    startedAt: Date.UTC(2026, 10, 1, 12, 1, 0),
    endedAt: Date.UTC(2026, 10, 1, 12, 1, 1),
    costUsd: 0,
    waitMs: 0,
    items: [item({ kind: "tool", toolName: "Edit", durationMs: 40, success: true })],
  },
];

/** The terminal session c1 of a daemon, on its screen. */
async function open(features = ["telemetry"], prompts: unknown[] = PROMPTS) {
  const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  const daemon = legacyDaemon(cleanups);
  daemon.features.push(...features);
  daemon.telemetry.session = { prompts };
  render(<App store={store} />);
  const hostId = await act(() => store.addHost({ name: "alfa", url: daemon.url, token: TOKEN }));
  await settle(() => store.getState().hosts[0]?.hostInfo != null);
  await act(async () => {
    store.router.push({ name: "external", host: hostId, claudeSessionId: "c1" });
  });
  return { store, daemon };
}

const timeline = () => screen.queryByRole("region", { name: "Linha do tempo da sessão" });

describe("tempo-ui: the Tempo tab of a session", () => {
  test("a session of a host with telemetry has a Tempo tab; without it, none", async () => {
    await open([]);
    expect(screen.queryByRole("button", { name: "Tempo" })).toBeNull();
    cleanup();
    await open();
    expect(screen.queryByRole("button", { name: "Tempo" })).not.toBeNull();
  });

  test("it shows each prompt with its steps: tools with their time, the permission wait, API calls and errors", async () => {
    const { daemon } = await open();
    await click("Tempo");
    await settle(() => timeline() !== null && (timeline()?.textContent ?? "").includes("Edit"));
    const text = timeline()?.textContent ?? "";
    expect(daemon.commands.find((c) => c.type === "telemetry.session")?.payload).toEqual({
      claudeSessionId: "c1",
    });
    const prompts = within(timeline() as HTMLElement).getAllByRole("listitem", {
      name: /^Prompt \d/,
    });
    expect(prompts.map((p) => p.getAttribute("aria-label"))).toEqual(["Prompt 1", "Prompt 2"]);
    expect(text).toContain("US$ 0.03");
    expect(text).toContain("esperou 7 s por você");
    expect(text).toContain("Read · 150 ms");
    expect(text).toContain("Bash · 2.9 s");
    expect(text).toContain("falhou (ShellError)");
    expect(text).toContain("Permissão para Bash: permitida por você");
    expect(text).toContain("Erro de API 529");
    expect(text).toContain("Pedido à API · 800 ms");
    // A prompt nobody waited on says nothing about waiting.
    expect(prompts[1]?.textContent).not.toContain("esperou");
  });

  test("the bars are proportional to the longest step of the prompt", async () => {
    await open();
    await click("Tempo");
    await settle(() => (timeline()?.textContent ?? "").includes("Edit"));
    const bars = [...(timeline()?.querySelectorAll("[data-bar]") ?? [])].map((b) =>
      Number.parseFloat((b as HTMLElement).style.width),
    );
    // Prompt 1: 800, 150, (permission has none), 2900, 90 ms of 2900; prompt 2: 40 of 40.
    expect(bars.map((w) => Math.round(w))).toEqual([28, 5, 100, 3, 100]);
  });

  test("odd steps read plainly: a tool that failed with no reason, a long one, a permission a hook denied, an API error with no status", async () => {
    await open(
      ["telemetry"],
      [
        {
          promptId: "p-9",
          startedAt: 0,
          endedAt: 90_000,
          costUsd: 0,
          waitMs: 0,
          items: [
            item({ kind: "tool", toolName: "Grep", durationMs: 90_000, success: false }),
            item({ kind: "permission", toolName: "Bash", decision: "reject", source: "hook" }),
            item({ kind: "permission", toolName: "Edit", decision: "accept", source: "config" }),
            item({
              kind: "permission",
              toolName: "Read",
              decision: "accept",
              source: "classifier",
            }),
            item({ kind: "error" }),
          ],
        },
      ],
    );
    await click("Tempo");
    await settle(() => (timeline()?.textContent ?? "").includes("Grep"));
    const text = timeline()?.textContent ?? "";
    expect(text).toContain("Grep · 1 min · falhou");
    expect(text).toContain("Permissão para Bash: negada por um hook");
    expect(text).toContain("Permissão para Edit: permitida pelas configurações");
    expect(text).toContain("Permissão para Read: permitida");
    expect(text).toContain("Erro de API");
  });

  test("a session with no timing data says how it gets some", async () => {
    await open(["telemetry"], []);
    await click("Tempo");
    await settle(() => screen.queryByText(/Sem dados de tempo/) !== null);
    expect(screen.queryByText(/flightdeckd claude/)).not.toBeNull();
  });
});

describe("tempo-ui: Custos", () => {
  async function costs(telemetry: boolean) {
    const d = makeDaemon(cleanups, { costs: true, telemetry });
    const db = d.eventStore.db;
    db.query(
      `INSERT INTO usage_entries (message_id, claude_session_id, at, day, project_key, model, origin,
         speed, input, output, cache_read, cache_write_5m, cache_write_1h, cost_usd)
       VALUES ('m1', 's-1', ?, ?, 'kA', 'claude-opus-5-5', 'terminal', 'standard', 1, 1, 0, 0, 0, 1)`,
    ).run(new Date().toISOString(), new Date().toISOString().slice(0, 10));
    d.telemetry?.add([
      {
        name: "tool_result",
        timeMs: 1_000,
        sessionId: "s-1",
        promptId: null,
        attrs: { tool_use_id: "a", tool_name: "Bash", duration_ms: 3_000 },
      },
      {
        name: "tool_decision",
        timeMs: 9_000,
        sessionId: "s-1",
        promptId: null,
        attrs: {
          tool_use_id: "a",
          tool_name: "Bash",
          decision: "accept",
          source: "user_temporary",
        },
      },
      {
        name: "api_request",
        timeMs: 2_000,
        sessionId: "s-1",
        promptId: null,
        attrs: { request_id: "r1", cost_usd: 5 },
      },
    ]);
    const server = d.listen();
    const store = new AppStore(memoryPlatform(false).platform, { baseDelayMs: 60_000 });
    cleanups.push(() => store.dispose());
    render(<App store={store} />);
    await act(async () => {
      await store.addHost({ name: "alfa", url: server.url, token: TOKEN });
    });
    await settle(() => store.getState().hosts[0]?.hostInfo !== null);
    await click("Custos");
    return d;
  }
  const region = (name: string) => screen.queryByRole("region", { name });

  test("per project: the time spent waiting for permission and the slowest tools", async () => {
    await costs(true);
    await settle(() => region("Tempo por projeto") !== null);
    const text = region("Tempo por projeto")?.textContent ?? "";
    expect(text).toContain("kA");
    expect(text).toContain("esperou 7 s por você");
    expect(text).toContain("Bash");
    expect(text).toContain("3.0 s");
  });

  test("the Custos page gives each of its children a key of its own (React warns about two with the host's id)", async () => {
    const errors: string[] = [];
    const real = console.error;
    console.error = (...args: unknown[]) => void errors.push(args.map(String).join(" "));
    try {
      await costs(true);
      await settle(() => region("Tempo por projeto") !== null);
    } finally {
      console.error = real;
    }
    expect(errors.filter((line) => line.includes("same key"))).toEqual([]);
  });

  test("a session whose telemetry cost is far from the transcripts' is flagged", async () => {
    await costs(true);
    await settle(() => screen.queryByText(/o custo da telemetria difere/) !== null);
    const notice = screen.queryByText(/o custo da telemetria difere/)?.textContent ?? "";
    expect(notice).toContain("s-1 (transcripts US$ 1.00, telemetria US$ 5.00)");
  });

  test("a host without telemetry shows no such panel", async () => {
    await costs(false);
    await settle(() => screen.queryByText("Custo estimado") !== null);
    expect(region("Tempo por projeto")).toBeNull();
  });
});
