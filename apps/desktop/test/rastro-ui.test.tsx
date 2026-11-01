import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform, TOKEN } from "./fixtures.ts";
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

const node = (over: Record<string, unknown>) => ({
  n: null,
  label: null,
  input: null,
  result: null,
  startMs: 0,
  durationMs: null,
  costUsd: null,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  error: false,
  children: [],
  ...over,
});

const TRACE = {
  claudeSessionId: "c1",
  costUsd: 0.87,
  durationMs: 90_000,
  costliest: "turn:1",
  slowest: "agent:a2",
  turns: [
    node({
      id: "turn:1",
      kind: "turn",
      name: "turn",
      n: 1,
      label: "Arrume o build",
      durationMs: 41_000,
      costUsd: 0.73,
      inputTokens: 3170,
      outputTokens: 230,
      children: [
        node({ id: "thought:a-1", kind: "thinking", name: "thinking", result: "vejamos o erro" }),
        node({
          id: "tool:toolu_1",
          kind: "tool",
          name: "Read",
          input: "src/a.ts",
          durationMs: 1_000,
        }),
        node({
          id: "tool:toolu_2",
          kind: "tool",
          name: "Bash",
          input: "bun test",
          result: "3 testes falharam",
          durationMs: 10_000,
          error: true,
        }),
        node({
          id: "agent:a1",
          kind: "subagent",
          name: "Explore",
          label: "Procurar o erro",
          durationMs: 23_000,
          costUsd: 0.37,
          children: [
            node({ id: "tool:toolu_s", kind: "tool", name: "Grep", durationMs: 2_000 }),
            node({
              id: "agent:a3",
              kind: "subagent",
              name: "general-purpose",
              label: "Ler mais",
              durationMs: 8_000,
              costUsd: 0.04,
              children: [
                node({ id: "tool:toolu_r", kind: "tool", name: "Read", durationMs: 3_000 }),
              ],
            }),
          ],
        }),
      ],
    }),
    node({
      id: "turn:2",
      kind: "turn",
      name: "turn",
      n: 2,
      label: "Agora o lint",
      durationMs: 30_000,
      costUsd: 0.14,
      children: [
        node({
          id: "agent:a2",
          kind: "subagent",
          name: "agent",
          label: "Rodar o lint",
          durationMs: 28_000,
          costUsd: 0.08,
          children: [node({ id: "tool:toolu_b", kind: "tool", name: "Bash", durationMs: 16_000 })],
        }),
      ],
    }),
  ],
};

async function open(features = ["trace"], session: unknown = TRACE) {
  const mem = memoryPlatform();
  const store = new AppStore(mem.platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  const daemon = legacyDaemon(cleanups);
  daemon.features.push(...features);
  daemon.trace.session = session as typeof daemon.trace.session;
  daemon.trace.files = {
    files: [{ path: "src/a.ts", change: "modified" }],
    insertions: 3,
    deletions: 1,
  };
  render(<App store={store} />);
  const hostId = await act(() => store.addHost({ name: "alfa", url: daemon.url, token: TOKEN }));
  await settle(() => store.getState().hosts[0]?.hostInfo != null);
  await act(async () => {
    store.router.push({ name: "external", host: hostId, claudeSessionId: "c1" });
  });
  return { store, daemon, mem };
}

const region = () => screen.queryByRole("region", { name: "Rastro da sessão" });
const at = (id: string) => region()?.querySelector(`[data-node="${id}"]`) as HTMLElement | null;
const openTrace = async () => {
  await click("Rastro");
  await settle(() => at("turn:1") !== null);
};

describe("rastro-ui: the Rastro tab of a session", () => {
  test("a host that announces trace has the tab; without it, none", async () => {
    await open([]);
    expect(screen.queryByRole("button", { name: "Rastro" })).toBeNull();
    cleanup();
    await open();
    expect(screen.queryByRole("button", { name: "Rastro" })).not.toBeNull();
  });

  test("a session with nothing to trace says so", async () => {
    await open(["trace"], { ...TRACE, turns: [], costUsd: null, durationMs: null });
    await click("Rastro");
    await settle(
      () => screen.queryByText("Esta sessão ainda não tem nada para rastrear.") !== null,
    );
    expect(screen.queryByText("Esta sessão ainda não tem nada para rastrear.")).not.toBeNull();
  });

  test("the tree nests turn, tools and subagents, with time, cost and tokens per node", async () => {
    const { daemon } = await open();
    await openTrace();
    expect(daemon.commands.find((c) => c.type === "trace.get")?.payload).toEqual({
      claudeSessionId: "c1",
    });
    expect(at("turn:1")?.textContent).toContain("Arrume o build");
    expect(at("turn:1")?.textContent).toContain("US$ 0.73");
    expect(at("turn:1")?.textContent).toContain("3170");
    expect(at("tool:toolu_2")?.textContent).toContain("Bash");
    expect(at("tool:toolu_2")?.textContent).toContain("10.0 s");
    expect(at("tool:toolu_2")?.textContent).toContain("3 testes falharam");
    // A subagent hangs from the turn, and its own subagent from it.
    expect(at("turn:1")?.querySelector('[data-node="agent:a1"]')).not.toBeNull();
    expect(at("agent:a1")?.querySelector('[data-node="agent:a3"]')).not.toBeNull();
    expect(at("agent:a3")?.querySelector('[data-node="tool:toolu_r"]')).not.toBeNull();
    expect(at("agent:a1")?.textContent).toContain("Explore");
    expect(at("agent:a1")?.textContent).toContain("Procurar o erro");
    expect(at("thought:a-1")?.textContent).toContain("vejamos o erro");
  });

  test("the costliest and the slowest are marked, once each, and the bars follow the time", async () => {
    await open();
    await openTrace();
    const text = region()?.textContent ?? "";
    expect(text.match(/mais caro/g)).toHaveLength(1);
    expect(text.match(/mais lento/g)).toHaveLength(1);
    expect(at("turn:1")?.querySelector("[data-highlight='costliest']")).not.toBeNull();
    expect(at("agent:a2")?.querySelector("[data-highlight='slowest']")).not.toBeNull();
    const width = (id: string) => {
      const bar = at(id)?.querySelector(":scope > [data-bar]") as HTMLElement | null;
      return Number.parseFloat(bar?.style.width ?? "");
    };
    // Against the longest call of the turn: Bash 10 s of the 23 s subagent.
    expect(Math.round(width("tool:toolu_2"))).toBe(43);
    expect(Math.round(width("agent:a1"))).toBe(100);
  });

  test("filtering by a tool keeps the calls to it and the turns and subagents they sit in", async () => {
    await open();
    await openTrace();
    const filter = screen.queryByLabelText("Ferramenta") as HTMLSelectElement;
    expect([...filter.options].map((o) => o.value)).toEqual(["", "Bash", "Grep", "Read"]);
    await act(async () => {
      fireEvent.change(filter, { target: { value: "Bash" } });
    });
    expect(at("tool:toolu_2")).not.toBeNull();
    expect(at("tool:toolu_b")).not.toBeNull();
    expect(at("agent:a2")).not.toBeNull();
    expect(at("tool:toolu_1")).toBeNull();
    expect(at("agent:a1")).toBeNull();
    await act(async () => {
      fireEvent.change(filter, { target: { value: "" } });
    });
    expect(at("tool:toolu_1")).not.toBeNull();
  });
});

describe("replay: step by step", () => {
  const replay = () => screen.queryByRole("region", { name: "Replay da sessão" });
  const steps = () => replay()?.textContent ?? "";

  test("it walks the calls in order, one at a time, with the controls", async () => {
    await open();
    await openTrace();
    await click("Replay");
    await settle(() => replay() !== null);
    expect(steps()).toContain("Passo 1 de 11");
    expect(steps()).toContain("Arrume o build");
    await click("Próximo");
    expect(steps()).toContain("Passo 2 de 11");
    expect(steps()).toContain("vejamos o erro");
    await click("Próximo");
    await click("Próximo");
    expect(steps()).toContain("Bash");
    expect(steps()).toContain("bun test");
    expect(steps()).toContain("3 testes falharam");
    await click("Anterior");
    expect(steps()).toContain("Passo 3 de 11");
    expect(steps()).toContain("src/a.ts");
  });

  test("a step of a turn with a checkpoint shows the files that turn changed", async () => {
    const { daemon } = await open(["trace", "checkpoints"]);
    await openTrace();
    await click("Replay");
    await settle(() => steps().includes("src/a.ts"));
    expect(steps()).toContain("src/a.ts");
    expect(steps()).toContain("modificado");
    expect(steps()).toContain("+3");
    expect(daemon.commands.find((c) => c.type === "snapshots.files")?.payload).toEqual({
      claudeSessionId: "c1",
      n: 1,
    });
  });

  test("a turn whose files the host cannot give is shown without them, and no error is raised", async () => {
    const { daemon, store } = await open(["trace", "checkpoints"]);
    daemon.refuse.set("snapshots.files", "sem snapshot deste turno");
    await openTrace();
    await click("Replay");
    await settle(() => daemon.commands.some((c) => c.type === "snapshots.files"));
    await act(() => Bun.sleep(50));
    expect(steps()).toContain("Passo 1 de 11");
    expect(store.getState().notices).toEqual([]);
  });

  test("play moves on by itself at the chosen speed and pause stops it; at the end it stops", async () => {
    await open();
    await openTrace();
    await click("Replay");
    await act(async () => {
      fireEvent.change(screen.queryByLabelText("Velocidade") as HTMLSelectElement, {
        target: { value: "4" },
      });
    });
    await click("Tocar");
    await settle(() => !steps().includes("Passo 1 de"), 3000);
    expect(steps()).not.toContain("Passo 1 de");
    await click("Pausar");
    const frozen = steps();
    await act(() => Bun.sleep(700));
    expect(steps()).toBe(frozen);
    await click("Tocar");
    await settle(() => steps().includes("Passo 10 de 11"), 6000);
    expect(steps()).toContain("Passo 10 de 11");
    await settle(() => screen.queryByRole("button", { name: "Tocar" }) !== null);
    expect(screen.queryByRole("button", { name: "Tocar" })).not.toBeNull();
  });
});

describe("rastro-export: from the tab", () => {
  test("Exportar rastro saves the file with the structure only, and with the content when asked", async () => {
    const { daemon, mem } = await open();
    daemon.trace.export = { filename: "trace-c1.json", json: '{"a":1}', redacted: 0 };
    await openTrace();
    await click("Exportar rastro");
    await settle(() => mem.saved.length === 1);
    expect(mem.saved[0]).toEqual({ name: "trace-c1.json", text: '{"a":1}' });
    expect(daemon.commands.filter((c) => c.type === "trace.export").at(-1)?.payload).toEqual({
      claudeSessionId: "c1",
      includeContent: false,
    });
    daemon.trace.export = { filename: "trace-c1.json", json: '{"b":2}', redacted: 2 };
    await act(async () => {
      fireEvent.click(screen.queryByLabelText("Incluir conteúdo") as HTMLElement);
    });
    expect(screen.queryByText(/varredura de segredos/)).not.toBeNull();
    await click("Exportar rastro");
    await settle(() => mem.saved.length === 2);
    expect(daemon.commands.filter((c) => c.type === "trace.export").at(-1)?.payload).toEqual({
      claudeSessionId: "c1",
      includeContent: true,
    });
    await settle(() => screen.queryByText(/2 campos ocultados/) !== null);
    expect(screen.queryByText(/2 campos ocultados/)).not.toBeNull();
  });
});
