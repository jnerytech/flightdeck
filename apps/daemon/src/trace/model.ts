import type { SessionTrace, TraceNode } from "@flightdeck/protocol";

export interface TraceInput {
  claudeSessionId: string;
  /** The session's transcript. */
  main: string;
  /** Each subagent's transcript (`<session>/subagents/agent-<id>.jsonl`), by its id. */
  subagents: Array<{ id: string; text: string }>;
  /** The cost of an assistant message, by its id; `null` when it is not priced. */
  costOf(messageId: string): number | null;
  /** How long a tool call really took, when the telemetry (phase 23) has it. */
  toolMs?(toolUseId: string): number | null;
}

type Json = Record<string, unknown>;

const obj = (value: unknown): Json =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};
const text = (value: unknown): string | null => (typeof value === "string" ? value : null);
const num = (value: unknown): number => (typeof value === "number" ? value : 0);

/** A summary is one short line: the input or the result is for recognising the call, not for reading. */
const SUMMARY_MAX = 120;
const cut = (value: string): string => {
  const flat = value.trim().replace(/\s+/g, " ");
  return flat.length > SUMMARY_MAX ? `${flat.slice(0, SUMMARY_MAX - 1)}…` : flat;
};

/** The input's most telling field, summarised. */
const INPUT_KEYS = [
  "file_path",
  "command",
  "pattern",
  "description",
  "prompt",
  "url",
  "path",
  "query",
];
function summariseInput(input: unknown): string | null {
  const fields = obj(input);
  for (const key of INPUT_KEYS) {
    const value = text(fields[key]);
    if (value) return cut(value);
  }
  return null;
}

/** A tool result's text, whether the content is a string or a list of blocks. */
function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => text(obj(block).text) ?? "")
    .filter(Boolean)
    .join("\n");
}

interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** A tool call, a thought or a prompt as the transcript says it, in order. */
type Event =
  | { kind: "prompt"; ts: number | null; text: string }
  | { kind: "message"; ts: number | null; messageId: string }
  | { kind: "thought"; ts: number | null; uuid: string; text: string }
  | {
      kind: "call";
      ts: number | null;
      id: string;
      name: string;
      input: unknown;
      lineUuid: string | null;
      messageId: string | null;
    };

interface Result {
  ts: number | null;
  text: string;
  error: boolean;
  agentId: string | null;
}

interface Parsed {
  events: Event[];
  results: Map<string, Result>;
  /** An assistant message's usage, once however many lines carry it. */
  messages: Map<string, Usage>;
  /** The message each event belongs to, for the cost of a turn. */
  firstTs: number | null;
  lastTs: number | null;
}

function timestamp(line: Json): number | null {
  const at = text(line.timestamp);
  const ms = at ? Date.parse(at) : Number.NaN;
  return Number.isNaN(ms) ? null : ms;
}

function lines(source: string): Json[] {
  const out: Json[] = [];
  for (const raw of source.split("\n")) {
    if (raw.trim() === "") continue;
    try {
      const value = JSON.parse(raw);
      if (value !== null && typeof value === "object" && !Array.isArray(value)) out.push(value);
    } catch {
      // Not JSON (a line cut in the middle of a write): nothing to read in it.
    }
  }
  return out;
}

function parse(source: string): Parsed {
  const parsed: Parsed = {
    events: [],
    results: new Map(),
    messages: new Map(),
    firstTs: null,
    lastTs: null,
  };
  for (const line of lines(source)) {
    if (line.type !== "user" && line.type !== "assistant") continue;
    const ts = timestamp(line);
    if (ts !== null) {
      parsed.firstTs = Math.min(parsed.firstTs ?? ts, ts);
      parsed.lastTs = Math.max(parsed.lastTs ?? ts, ts);
    }
    const message = obj(line.message);
    const content = message.content;
    const blocks = Array.isArray(content) ? content.map(obj) : [];
    if (line.type === "user") {
      const prompt =
        typeof content === "string"
          ? content
          : blocks
              .filter((b) => b.type === "text")
              .map((b) => text(b.text) ?? "")
              .join("\n");
      for (const block of blocks) {
        const id = text(block.tool_use_id);
        if (block.type === "tool_result" && id) {
          parsed.results.set(id, {
            ts,
            text: resultText(block.content),
            error: block.is_error === true,
            agentId: text(obj(line.toolUseResult).agentId),
          });
        }
      }
      const onlyResults = blocks.length > 0 && blocks.every((b) => b.type === "tool_result");
      if (prompt.trim() !== "" && !onlyResults && line.isSidechain !== true) {
        parsed.events.push({ kind: "prompt", ts, text: prompt });
      }
      continue;
    }
    const messageId = text(message.id);
    const usage = obj(message.usage);
    if (messageId && !parsed.messages.has(messageId)) {
      parsed.messages.set(messageId, {
        input: num(usage.input_tokens),
        output: num(usage.output_tokens),
        cacheRead: num(usage.cache_read_input_tokens),
        cacheWrite: num(usage.cache_creation_input_tokens),
      });
    }
    if (messageId) parsed.events.push({ kind: "message", ts, messageId });
    for (const block of blocks) {
      if (block.type === "thinking" && text(block.thinking)) {
        parsed.events.push({
          kind: "thought",
          ts,
          uuid: text(line.uuid) ?? String(parsed.events.length),
          text: text(block.thinking) as string,
        });
      } else if (block.type === "tool_use" && text(block.id)) {
        parsed.events.push({
          kind: "call",
          ts,
          id: text(block.id) as string,
          name: text(block.name) ?? "tool",
          input: block.input,
          lineUuid: text(line.uuid),
          messageId,
        });
      }
    }
  }
  return parsed;
}

const SUBAGENT_TOOLS = new Set(["Task", "Agent"]);
const MAX_DEPTH = 8;

class Builder {
  private readonly files = new Map<string, Parsed & { firstParent: string | null }>();
  private readonly used = new Set<string>();

  constructor(private readonly input: TraceInput) {
    for (const sub of input.subagents) {
      const first = lines(sub.text)[0];
      this.files.set(sub.id, { ...parse(sub.text), firstParent: text(first?.parentUuid) });
    }
  }

  private cost(messages: Iterable<string>): number | null {
    let total: number | null = null;
    for (const id of messages) {
      const cost = this.input.costOf(id);
      if (cost !== null) total = (total ?? 0) + cost;
    }
    return total;
  }

  /** The file of the subagent a call started: by the agent id of its result, else by the parent line. */
  private subagentOf(call: Extract<Event, { kind: "call" }>, result: Result | undefined) {
    const byId = result?.agentId && !this.used.has(result.agentId) ? result.agentId : null;
    if (byId && this.files.has(byId)) return byId;
    for (const [id, file] of this.files) {
      if (!this.used.has(id) && call.lineUuid && file.firstParent === call.lineUuid) return id;
    }
    return null;
  }

  /** The nodes for a stretch of events; `own` collects the messages those events belong to. */
  private nodes(events: Event[], from: Parsed, own: Set<string>, depth: number): TraceNode[] {
    const out: TraceNode[] = [];
    for (const event of events) {
      if (event.kind === "message") {
        own.add(event.messageId);
      } else if (event.kind === "thought") {
        out.push({
          ...blank(`thought:${event.uuid}`, "thinking", "thinking"),
          result: cut(event.text),
          startMs: event.ts,
        });
      } else if (event.kind === "call") {
        out.push(this.call(event, from, depth));
      }
    }
    return out;
  }

  private call(call: Extract<Event, { kind: "call" }>, from: Parsed, depth: number): TraceNode {
    const result = from.results.get(call.id);
    const measured = this.input.toolMs?.(call.id) ?? null;
    const span = result?.ts != null && call.ts != null ? Math.max(0, result.ts - call.ts) : null;
    const base: TraceNode = {
      ...blank(`tool:${call.id}`, "tool", call.name),
      input: summariseInput(call.input),
      result: result ? cut(result.text) : null,
      startMs: call.ts,
      durationMs: measured ?? span,
      error: result?.error === true,
    };
    const agent =
      SUBAGENT_TOOLS.has(call.name) && depth < MAX_DEPTH ? this.subagentOf(call, result) : null;
    if (!agent) return base;
    this.used.add(agent);
    const file = this.files.get(agent) as Parsed;
    const own = new Set<string>();
    const children = this.nodes(file.events, file, own, depth + 1);
    const fields = obj(call.input);
    return this.sum(
      {
        ...base,
        id: `agent:${agent}`,
        kind: "subagent",
        name: text(fields.subagent_type) ?? "agent",
        label: text(fields.description),
        children,
      },
      own,
      file,
    );
  }

  /** Cost and tokens of a node: its own messages and its subagents'. */
  private sum(node: TraceNode, own: Set<string>, from: Parsed): TraceNode {
    const total = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    for (const id of own) {
      const usage = from.messages.get(id);
      if (!usage) continue;
      total.input += usage.input;
      total.output += usage.output;
      total.cacheRead += usage.cacheRead;
      total.cacheWrite += usage.cacheWrite;
    }
    let cost = this.cost(own);
    for (const child of node.children) {
      if (child.kind !== "subagent") continue;
      total.input += child.inputTokens;
      total.output += child.outputTokens;
      total.cacheRead += child.cacheReadTokens;
      total.cacheWrite += child.cacheWriteTokens;
      if (child.costUsd !== null) cost = (cost ?? 0) + child.costUsd;
    }
    return {
      ...node,
      costUsd: cost,
      inputTokens: total.input,
      outputTokens: total.output,
      cacheReadTokens: total.cacheRead,
      cacheWriteTokens: total.cacheWrite,
    };
  }

  turns(): TraceNode[] {
    const main = parse(this.input.main);
    const groups: Array<{ prompt: Extract<Event, { kind: "prompt" }>; events: Event[] }> = [];
    for (const event of main.events) {
      if (event.kind === "prompt") groups.push({ prompt: event, events: [] });
      else groups.at(-1)?.events.push(event);
    }
    return groups.map((group, i) => {
      const own = new Set<string>();
      const children = this.nodes(group.events, main, own, 0);
      const end = main.events.filter((e) => e.ts !== null).map((e) => e.ts as number);
      const next = groups[i + 1]?.prompt.ts ?? Number.POSITIVE_INFINITY;
      const start = group.prompt.ts;
      const within = end.filter((ts) => start !== null && ts >= start && ts < next);
      // The turn ends with its last result too, which is not an event of its own.
      const results = [...main.results.values()]
        .map((r) => r.ts)
        .filter((ts): ts is number => ts !== null && start !== null && ts >= start && ts < next);
      const last = Math.max(...within, ...results, start ?? Number.NEGATIVE_INFINITY);
      return this.sum(
        {
          ...blank(`turn:${i + 1}`, "turn", "turn"),
          n: i + 1,
          label: cut(group.prompt.text),
          startMs: start,
          durationMs: start === null || !Number.isFinite(last) ? null : last - start,
          children,
        },
        own,
        main,
      );
    });
  }
}

function blank(id: string, kind: TraceNode["kind"], name: string): TraceNode {
  return {
    id,
    kind,
    name,
    n: null,
    label: null,
    input: null,
    result: null,
    startMs: null,
    durationMs: null,
    costUsd: null,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    error: false,
    children: [],
  };
}

function walk(nodes: TraceNode[], visit: (node: TraceNode) => void): void {
  for (const node of nodes) {
    visit(node);
    walk(node.children, visit);
  }
}

/**
 * The trace of a session: its turns, each with the tool calls, thoughts and subagents under it,
 * and what they cost and took. The transcript format is not a contract: a line or a field this
 * does not know is skipped.
 */
export function buildTrace(input: TraceInput): SessionTrace {
  const turns = new Builder(input).turns();
  let costliest: TraceNode | null = null;
  let slowest: TraceNode | null = null;
  walk(turns, (node) => {
    if ((node.kind === "turn" || node.kind === "subagent") && node.costUsd !== null) {
      if (!costliest || node.costUsd > (costliest.costUsd ?? 0)) costliest = node;
    }
    if ((node.kind === "tool" || node.kind === "subagent") && node.durationMs !== null) {
      if (!slowest || node.durationMs > (slowest.durationMs ?? 0)) slowest = node;
    }
  });
  const costs = turns.map((t) => t.costUsd).filter((c): c is number => c !== null);
  const main = parse(input.main);
  return {
    claudeSessionId: input.claudeSessionId,
    turns,
    costUsd: costs.length > 0 ? costs.reduce((a, b) => a + b, 0) : null,
    durationMs: main.firstTs !== null && main.lastTs !== null ? main.lastTs - main.firstTs : null,
    costliest: (costliest as TraceNode | null)?.id ?? null,
    slowest: (slowest as TraceNode | null)?.id ?? null,
  };
}
