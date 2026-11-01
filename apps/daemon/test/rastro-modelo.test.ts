import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { TraceNode } from "@flightdeck/protocol";
import { buildTrace } from "../src/trace/model.ts";

const DIR = join(import.meta.dir, "fixtures/trace");
const SESSION = "bbbbbbbb-0000-4000-8000-000000000025";

const COSTS: Record<string, number> = {
  msg_A: 0.1,
  msg_B: 0.2,
  msg_C: 0.05,
  msg_D: 0.01,
  msg_S1: 0.3,
  msg_S2: 0.02,
  msg_S3: 0.01,
  msg_R1: 0.04,
  msg_E: 0.06,
  msg_T1: 0.08,
};

function trace(extra: { toolMs?: (id: string) => number | null; dropSubagents?: boolean } = {}) {
  const subagents = readdirSync(join(DIR, "subagents")).map((name) => ({
    id: name.replace(/^agent-|\.jsonl$/g, ""),
    text: readFileSync(join(DIR, "subagents", name), "utf8"),
  }));
  return buildTrace({
    claudeSessionId: SESSION,
    main: readFileSync(join(DIR, "main.jsonl"), "utf8"),
    subagents: extra.dropSubagents ? [] : subagents,
    costOf: (id) => COSTS[id] ?? null,
    ...(extra.toolMs ? { toolMs: extra.toolMs } : {}),
  });
}

const brief = (node: TraceNode) => [node.id, node.kind, node.name];
const find = (nodes: TraceNode[], id: string): TraceNode | undefined => {
  for (const node of nodes) {
    if (node.id === id) return node;
    const inside = find(node.children, id);
    if (inside) return inside;
  }
  return undefined;
};

describe("rastro-modelo: the turns, tools and thoughts", () => {
  test("a turn per prompt, with the tools and the thought under it in order, and what the transcript says of each", () => {
    const { turns } = trace();
    expect(turns.map((t) => [t.id, t.n, t.label])).toEqual([
      ["turn:1", 1, "Arrume o build"],
      ["turn:2", 2, "Agora o lint"],
    ]);
    const first = turns[0] as TraceNode;
    expect(first.children.map(brief)).toEqual([
      ["thought:a-1", "thinking", "thinking"],
      ["tool:toolu_1", "tool", "Read"],
      ["tool:toolu_2", "tool", "Bash"],
      ["agent:a1", "subagent", "Explore"],
    ]);
    const [thought, read, bash] = first.children as TraceNode[];
    expect(thought).toMatchObject({ result: "vejamos o erro", durationMs: null });
    expect(read).toMatchObject({
      input: "src/a.ts",
      result: "conteudo do arquivo",
      durationMs: 1_000,
      error: false,
    });
    expect(bash).toMatchObject({
      input: "bun test",
      result: "3 testes falharam",
      durationMs: 10_000,
      error: true,
    });
    expect(first.startMs).toBe(Date.UTC(2026, 10, 1, 12, 0, 0));
    expect(first.durationMs).toBe(41_000);
  });

  test("a line or a field it does not know, and a line that is not JSON, change nothing", () => {
    expect(trace().turns).toHaveLength(2);
    const empty = buildTrace({ claudeSessionId: "x", main: "", subagents: [], costOf: () => null });
    expect(empty).toEqual({
      claudeSessionId: "x",
      turns: [],
      costUsd: null,
      durationMs: null,
      costliest: null,
      slowest: null,
    });
  });

  test("a tool call's time comes from the telemetry when it has it", () => {
    const { turns } = trace({ toolMs: (id) => (id === "toolu_2" ? 9_500 : null) });
    expect(find(turns, "tool:toolu_2")?.durationMs).toBe(9_500);
    expect(find(turns, "tool:toolu_1")?.durationMs).toBe(1_000);
  });
});

describe("rastro-modelo: the subagents", () => {
  test("a subagent hangs from the call that started it, with its tools, and a subagent of its own", () => {
    const { turns } = trace();
    const a1 = find(turns, "agent:a1") as TraceNode;
    expect(a1).toMatchObject({
      kind: "subagent",
      name: "Explore",
      label: "Procurar o erro",
      durationMs: 23_000,
    });
    expect(a1.children.map(brief)).toEqual([
      ["tool:toolu_s", "tool", "Grep"],
      ["agent:a3", "subagent", "general-purpose"],
    ]);
    expect(find(turns, "tool:toolu_s")?.durationMs).toBe(2_000);
    const a3 = find(turns, "agent:a3") as TraceNode;
    expect(a3.durationMs).toBe(8_000);
    expect(a3.children.map(brief)).toEqual([["tool:toolu_r", "tool", "Read"]]);
    expect(find(turns, "tool:toolu_r")?.durationMs).toBe(3_000);
  });

  test("a subagent whose call names no agent id is found by the parent line of its transcript", () => {
    const { turns } = trace();
    const a2 = find(turns, "agent:a2") as TraceNode;
    expect(a2).toMatchObject({
      kind: "subagent",
      name: "agent",
      label: "Rodar o lint",
      durationMs: 28_000,
    });
    expect(a2.children.map(brief)).toEqual([["tool:toolu_b", "tool", "Bash"]]);
  });

  test("without the subagent's file the call stays a tool call", () => {
    const { turns } = trace({ dropSubagents: true });
    expect(find(turns, "tool:toolu_3")).toMatchObject({ kind: "tool", name: "Task" });
    expect(find(turns, "agent:a1")).toBeUndefined();
  });
});

describe("rastro-modelo: cost, tokens and what stands out", () => {
  test("a node's cost and tokens include its subagents, and a message counts once however many lines it has", () => {
    const { turns, costUsd } = trace();
    const [one, two] = turns as TraceNode[];
    expect(one?.costUsd).toBeCloseTo(0.73, 10);
    expect(two?.costUsd).toBeCloseTo(0.14, 10);
    expect(costUsd).toBeCloseTo(0.87, 10);
    const a1 = find(turns, "agent:a1") as TraceNode;
    expect(a1.costUsd).toBeCloseTo(0.37, 10);
    expect(a1).toMatchObject({ inputTokens: 2_810, outputTokens: 125 });
    expect(find(turns, "agent:a3")?.costUsd).toBeCloseTo(0.04, 10);
    expect(one).toMatchObject({ inputTokens: 3_170, outputTokens: 230, cacheReadTokens: 1_000 });
    // A tool call has no cost of its own.
    expect(find(turns, "tool:toolu_1")?.costUsd).toBeNull();
  });

  test("the costliest turn or subagent and the slowest call are named, and the session's time is first line to last", () => {
    const result = trace();
    expect(result.costliest).toBe("turn:1");
    expect(result.slowest).toBe("agent:a2");
    expect(result.durationMs).toBe(90_000);
  });
});
