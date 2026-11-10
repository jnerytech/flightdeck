// The trace of a session: the tree of its turns, tool calls and subagents, with time, cost and tokens (issue #1600: moved from index.ts).
import { z } from "zod";
import { cmd } from "./command.ts";

/** Phase 25: a node of a session's trace: a turn, a tool call, a subagent or a thought. */
export interface TraceNode {
  /** Stable inside a trace: `turn:2`, `tool:<tool_use_id>`, `agent:<id>`, `thought:<uuid>`. */
  id: string;
  kind: "turn" | "tool" | "subagent" | "thinking";
  /** The tool, the subagent type, or `turn`/`thinking`. */
  name: string;
  /** For a turn, 1, 2, 3...: the number the checkpoints of phase 12 use. */
  n: number | null;
  /** The prompt of a turn, or the description of a subagent; text the export leaves out. */
  label: string | null;
  /** The tool's input and result, summarised; text the export leaves out. */
  input: string | null;
  result: string | null;
  /** Epoch ms of the start; `null` when the transcript line has no timestamp. */
  startMs: number | null;
  durationMs: number | null;
  /** The messages' cost under this node, subagents included; `null` when none is priced. */
  costUsd: number | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  error: boolean;
  children: TraceNode[];
}

export const TraceNode: z.ZodType<TraceNode> = z.lazy(() =>
  z.object({
    id: z.string(),
    kind: z.enum(["turn", "tool", "subagent", "thinking"]),
    name: z.string(),
    n: z.number().int().nullable(),
    label: z.string().nullable(),
    input: z.string().nullable(),
    result: z.string().nullable(),
    startMs: z.number().nullable(),
    durationMs: z.number().nullable(),
    costUsd: z.number().nullable(),
    inputTokens: z.number(),
    outputTokens: z.number(),
    cacheReadTokens: z.number(),
    cacheWriteTokens: z.number(),
    error: z.boolean(),
    children: z.array(TraceNode),
  }),
);

export const SessionTrace = z.object({
  claudeSessionId: z.string(),
  turns: z.array(TraceNode),
  costUsd: z.number().nullable(),
  durationMs: z.number().nullable(),
  /** The turn or subagent that cost most, and the tool call or subagent that took longest. */
  costliest: z.string().nullable(),
  slowest: z.string().nullable(),
});
export type SessionTrace = z.infer<typeof SessionTrace>;

/** The trace as a file to attach to a bug: structure and numbers, content only when asked. */
export const TraceExport = z.object({
  filename: z.string(),
  json: z.string(),
  /** Fields of the content that were replaced because a secret was found in them. */
  redacted: z.number().int(),
});
export type TraceExport = z.infer<typeof TraceExport>;

export const TraceSessionInfo = z.object({
  sessionId: z.string(),
  claudeSessionId: z.string().nullable(),
  name: z.string().nullable(),
  kind: z.enum(["run", "fix"]),
  startedAt: z.string(),
  costUsd: z.number().nullable(),
  checkpoints: z.number().int(),
});

/** The trace commands; index.ts spreads them into `Command`. */
export const traceCommands = [
  // Phase 25: the trace of a session, built from its transcript and its subagents'.
  cmd("trace.get", z.object({ claudeSessionId: z.string().min(1) })),
  cmd(
    "trace.export",
    z.object({ claudeSessionId: z.string().min(1), includeContent: z.boolean().optional() }),
  ),
] as const;

/** The `data` of each trace command's ack; `CommandResults` extends it. */
export interface TraceResults {
  "trace.get": SessionTrace;
  "trace.export": TraceExport;
}
