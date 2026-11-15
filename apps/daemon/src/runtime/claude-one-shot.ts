import { mkdir } from "node:fs/promises";
import type {
  Options,
  SDKMessage,
  SDKResultMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { AsyncQueue, buildChildEnv, FlightdeckError } from "../kernel/index.ts";
import { CompleteCutShort } from "./domain/complete-cut-short.ts";
import type { CompleteOptions, CompleteResult, JudgeOptions, JudgeResult } from "./types.ts";

/** The part of the SDK's `query` a one-shot call uses: a prompt in, the messages out. */
type OneShotQuery = (params: {
  prompt: AsyncIterable<SDKUserMessage>;
  options: Options;
}) => AsyncIterable<SDKMessage>;

/** What the automatic approval's query must answer (phase 13). */
const JUDGE_SCHEMA = {
  type: "object",
  properties: {
    decision: { type: "string", enum: ["allow", "ask"] },
    reason: { type: "string" },
  },
  required: ["decision", "reason"],
  additionalProperties: false,
};

/** Phase 40: the models that take `thinking: { type: "disabled" }` (the research's table). */
const THINKING_OFF_MODELS = new Set(["claude-haiku-5-5"]);

/** Phase 40: the assistant's one-shot is a safety net of this much; the costs use the tokens. */
const COMPLETE_BUDGET_USD = 0.25;

function hostUnavailable(detail: string): FlightdeckError {
  return new FlightdeckError(
    "invalid_state",
    `Claude Code on the host cannot answer: ${detail}`,
    "assistant_host_unavailable",
    { detail },
  );
}

/** The answer of a one-shot: its text and tokens, or the refusal its result stands for. */
function completeResult(
  model: string,
  message: SDKResultMessage,
  blocks: string[],
): CompleteResult {
  const { usage } = message;
  const tokens = {
    model,
    speed: "standard",
    input: usage.input_tokens,
    output: usage.output_tokens,
    cacheRead: usage.cache_read_input_tokens ?? 0,
    cacheWrite5m: usage.cache_creation_input_tokens ?? 0,
    cacheWrite1h: 0,
  };
  if (message.subtype === "error_max_turns" || message.subtype === "error_max_budget_usd") {
    throw new CompleteCutShort(message.subtype, tokens);
  }
  if (message.subtype !== "success") throw hostUnavailable(message.subtype);
  // A logged-out claude answers "success" with is_error and the reason as its result.
  if (message.is_error) throw hostUnavailable(message.result);
  return { text: message.result || blocks.join("\n"), subtype: message.subtype, tokens };
}

/** Reads the one-shot's messages up to its result; null when the stream ends without one. */
async function readAnswer(
  handle: AsyncIterable<SDKMessage>,
  model: string,
): Promise<CompleteResult | null> {
  const blocks: string[] = [];
  for await (const message of handle) {
    if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type === "text") blocks.push(block.text);
      }
    } else if (message.type === "result") {
      return completeResult(model, message, blocks);
    }
  }
  return null;
}

/** What a failed one-shot stands for: our own refusals pass, a cancel is a cancel, the rest is the host. */
function completeFailure(error: unknown, signal: AbortSignal | undefined): FlightdeckError {
  if (error instanceof FlightdeckError) return error;
  if (signal?.aborted)
    return new FlightdeckError("invalid_state", "cancelled", "assistant_cancelled");
  return hostUnavailable(error instanceof Error ? error.message : String(error));
}

/** An AbortController that follows a signal. */
function abortFrom(signal: AbortSignal): AbortController {
  const controller = new AbortController();
  signal.addEventListener("abort", () => controller.abort(), { once: true });
  return controller;
}

/** A prompt of one user message, already closed: the one-shot has nothing more to say. */
function singlePrompt(text: string): AsyncQueue<SDKUserMessage> {
  const prompt = new AsyncQueue<SDKUserMessage>();
  prompt.push({
    type: "user",
    parent_tool_use_id: null,
    message: { role: "user", content: text },
  });
  prompt.end();
  return prompt;
}

/**
 * The short queries a session's runtime makes on the side (#1589): each is one turn, isolated, with
 * no tools and no session written. A session that lives across turns stays in the runtime; these
 * only choose what one question is asked with and read its answer.
 */
export class ClaudeOneShot {
  constructor(
    private readonly query: OneShotQuery,
    private readonly claudePath: string | undefined,
  ) {}

  /**
   * Phase 13: one short query, isolated: no settings (so no hooks), no session written, no tools,
   * one turn and a structured answer. Anything but a clear answer is a question for the user.
   */
  async judgePermission(opts: JudgeOptions): Promise<JudgeResult> {
    await mkdir(opts.cwd, { recursive: true });
    const handle = this.query({
      prompt: singlePrompt(opts.prompt),
      options: {
        model: opts.model,
        cwd: opts.cwd,
        maxTurns: 1,
        settingSources: [],
        // settingSources does not cover .mcp.json, and this runs in the session's folder.
        strictMcpConfig: true,
        persistSession: false,
        tools: [],
        env: { ...process.env, FLIGHTDECK_MANAGED: "1" },
        outputFormat: { type: "json_schema", schema: JUDGE_SCHEMA },
        ...(opts.signal ? { abortController: abortFrom(opts.signal) } : {}),
        ...(this.claudePath ? { pathToClaudeCodeExecutable: this.claudePath } : {}),
      },
    });
    for await (const message of handle) {
      if (message.type !== "result") continue;
      const usage = message.usage;
      const tokens = {
        model: opts.model,
        speed: "standard",
        input: usage.input_tokens,
        output: usage.output_tokens,
        cacheRead: usage.cache_read_input_tokens ?? 0,
        cacheWrite5m: usage.cache_creation_input_tokens ?? 0,
        cacheWrite1h: 0,
      };
      const answer = message.subtype === "success" ? message.structured_output : undefined;
      const { decision, reason } = (answer ?? {}) as { decision?: unknown; reason?: unknown };
      return decision === "allow" || decision === "ask" || decision === "deny"
        ? { decision, reason: typeof reason === "string" ? reason : "", tokens }
        : { decision: "ask", reason: `answer without a decision (${message.subtype})`, tokens };
    }
    return { decision: "ask", reason: "the query ended without a result" };
  }

  /**
   * Phase 40: the assistant's one-shot call, on the host's plan: one turn, no settings (so no
   * hooks), no session written, no tools, no MCP server but none, no auto memory, and an API key
   * only when the daemon allows one. The answer is plain text.
   */
  async complete(opts: CompleteOptions): Promise<CompleteResult> {
    await mkdir(opts.cwd, { recursive: true });
    try {
      const handle = this.query({
        prompt: singlePrompt(opts.prompt),
        options: this.completeOptions(opts),
      });
      const answer = await readAnswer(handle, opts.model);
      if (answer) return answer;
    } catch (error) {
      throw completeFailure(error, opts.signal);
    }
    throw hostUnavailable("no answer");
  }

  /** The options of the one-shot call: one turn, nothing from the folder, a budget, adaptive thinking. */
  private completeOptions(opts: CompleteOptions): Options {
    const off = opts.thinking === "off" && THINKING_OFF_MODELS.has(opts.model);
    return {
      model: opts.model,
      cwd: opts.cwd,
      maxTurns: 1,
      settingSources: [],
      persistSession: false,
      tools: [],
      systemPrompt: opts.system,
      strictMcpConfig: true,
      maxBudgetUsd: opts.budgetUsd ?? COMPLETE_BUDGET_USD,
      ...(opts.schema ? { outputFormat: { type: "json_schema", schema: opts.schema } } : {}),
      ...(opts.effort ? { effort: opts.effort } : {}),
      thinking: off ? { type: "disabled" } : { type: "adaptive" },
      env: {
        ...buildChildEnv(process.env, opts.allowApiKey === true),
        FLIGHTDECK_MANAGED: "1",
        CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
      },
      ...(opts.signal ? { abortController: abortFrom(opts.signal) } : {}),
      ...(this.claudePath ? { pathToClaudeCodeExecutable: this.claudePath } : {}),
    };
  }
}
