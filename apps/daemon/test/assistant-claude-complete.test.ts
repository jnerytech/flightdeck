import { afterEach, describe, expect, test } from "bun:test";
import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { FlightdeckError } from "../src/errors.ts";
import { ClaudeSdkRuntime, type QueryHandle } from "../src/runtime/claude-sdk-runtime.ts";
import { FakeRuntime } from "../src/runtime/fake-runtime.ts";
import type { CompleteOptions } from "../src/runtime/types.ts";
import { tempDir } from "./helpers.ts";

const usage = {
  input_tokens: 300,
  output_tokens: 20,
  cache_read_input_tokens: 5,
  cache_creation_input_tokens: 7,
};

/** A runtime whose `query` yields `messages` (or throws `fails`) and keeps what it was given. */
function runtime(messages: object[], fails?: Error) {
  const seen: Array<{ options: Options; prompt: unknown[] }> = [];
  const sdk = new ClaudeSdkRuntime({
    claudePath: "/nao/existe/claude",
    query: ({ prompt, options }) => {
      const entry = { options, prompt: [] as unknown[] };
      seen.push(entry);
      return {
        async *[Symbol.asyncIterator]() {
          for await (const message of prompt as AsyncIterable<unknown>) entry.prompt.push(message);
          if (fails) throw fails;
          for (const message of messages) yield message as SDKMessage;
        },
        interrupt: async () => {},
        close: () => {},
      } as QueryHandle;
    },
  });
  return { sdk, seen };
}

const options = (over: Partial<CompleteOptions> = {}): CompleteOptions => ({
  model: "claude-haiku-5-5",
  system: "Improve the text.",
  prompt: "<text>\nfix it\n</text>",
  cwd: tempDir(),
  effort: "low",
  thinking: "off",
  ...over,
});

async function reason(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return null;
  } catch (error) {
    return error instanceof FlightdeckError ? [error.reason, error.params ?? {}] : String(error);
  }
}

const saved = process.env.ANTHROPIC_API_KEY;
afterEach(() => {
  if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = saved;
});

describe("assistant-claude-complete", () => {
  test("one turn, no settings, no session, no tools, a string system prompt, strict MCP, a budget, the signal and the executable", async () => {
    const { sdk, seen } = runtime([
      { type: "result", subtype: "success", is_error: false, result: "Fixed.", usage },
    ]);
    const controller = new AbortController();
    const opts = options({ signal: controller.signal });
    await sdk.complete(opts);
    const given: Partial<Options> = seen[0]?.options ?? {};
    expect({
      model: given.model,
      cwd: given.cwd,
      maxTurns: given.maxTurns,
      settingSources: given.settingSources,
      persistSession: given.persistSession,
      tools: given.tools,
      systemPrompt: given.systemPrompt,
      strictMcpConfig: given.strictMcpConfig,
      maxBudgetUsd: given.maxBudgetUsd,
      effort: given.effort,
      thinking: given.thinking,
      path: given.pathToClaudeCodeExecutable,
    }).toEqual({
      model: "claude-haiku-5-5",
      cwd: opts.cwd,
      maxTurns: 1,
      settingSources: [],
      persistSession: false,
      tools: [],
      systemPrompt: "Improve the text.",
      strictMcpConfig: true,
      maxBudgetUsd: 0.25,
      effort: "low",
      thinking: { type: "disabled" },
      path: "/nao/existe/claude",
    });
    expect(seen[0]?.prompt).toEqual([
      {
        type: "user",
        parent_tool_use_id: null,
        message: { role: "user", content: "<text>\nfix it\n</text>" },
      },
    ]);
    expect(given.abortController?.signal.aborted).toBe(false);
    controller.abort();
    expect(given.abortController?.signal.aborted).toBe(true);
  });

  test("the plan, not a key: the env drops the API key unless allowed, and turns auto memory off", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-not-a-real-key";
    const { sdk, seen } = runtime([
      { type: "result", subtype: "success", is_error: false, result: "x", usage },
    ]);
    await sdk.complete(options());
    await sdk.complete(options({ allowApiKey: true }));
    const env = (i: number) => seen[i]?.options.env ?? {};
    expect([
      env(0).ANTHROPIC_API_KEY,
      env(0).CLAUDE_CODE_DISABLE_AUTO_MEMORY,
      env(0).FLIGHTDECK_MANAGED,
      env(1).ANTHROPIC_API_KEY,
    ]).toEqual([undefined, "1", "1", "sk-ant-not-a-real-key"]);
  });

  test("thinking is off only for a model known to take it; otherwise adaptive", async () => {
    const { sdk, seen } = runtime([
      { type: "result", subtype: "success", is_error: false, result: "x", usage },
    ]);
    await sdk.complete(options({ model: "claude-sonnet-5-5", thinking: "off" }));
    await sdk.complete(options({ model: "claude-haiku-5-5", thinking: "adaptive" }));
    expect(seen.map((s) => s.options.thinking)).toEqual([
      { type: "adaptive" },
      { type: "adaptive" },
    ]);
  });

  test("the answer: the result's text, else the assistant's text blocks, and the tokens it used", async () => {
    const { sdk } = runtime([
      { type: "result", subtype: "success", is_error: false, result: "Fixed the login.", usage },
    ]);
    expect(await sdk.complete(options())).toEqual({
      text: "Fixed the login.",
      subtype: "success",
      tokens: {
        model: "claude-haiku-5-5",
        speed: "standard",
        input: 300,
        output: 20,
        cacheRead: 5,
        cacheWrite5m: 7,
        cacheWrite1h: 0,
      },
    });
    const blocks = runtime([
      {
        type: "assistant",
        message: { content: [{ type: "text", text: "Line one" }, { type: "tool_use" }] },
      },
      { type: "assistant", message: { content: [{ type: "text", text: "Line two" }] } },
      { type: "result", subtype: "success", is_error: false, result: "", usage },
    ]);
    expect((await blocks.sdk.complete(options())).text).toBe("Line one\nLine two");
  });

  test("each failure has its reason: a cut answer, no login, no answer, a broken process, a cancel", async () => {
    const cases: Array<[object[], Error | undefined, unknown]> = [
      [
        [{ type: "result", subtype: "error_max_turns", is_error: true, usage }],
        undefined,
        ["assistant_truncated", {}],
      ],
      [
        [{ type: "result", subtype: "error_max_budget_usd", is_error: true, usage }],
        undefined,
        ["assistant_truncated", {}],
      ],
      [
        [
          {
            type: "result",
            subtype: "success",
            is_error: true,
            result: "Not logged in · Please run /login",
            usage,
          },
        ],
        undefined,
        ["assistant_host_unavailable", { detail: "Not logged in · Please run /login" }],
      ],
      [
        [{ type: "result", subtype: "error_during_execution", is_error: true, usage }],
        undefined,
        ["assistant_host_unavailable", { detail: "error_during_execution" }],
      ],
      [[], undefined, ["assistant_host_unavailable", { detail: "no answer" }]],
      [
        [],
        new Error("spawn claude ENOENT"),
        ["assistant_host_unavailable", { detail: "spawn claude ENOENT" }],
      ],
    ];
    for (const [messages, fails, expected] of cases) {
      expect(await reason(runtime(messages, fails).sdk.complete(options()))).toEqual(expected);
    }
    const controller = new AbortController();
    controller.abort();
    const aborted = runtime([], new Error("aborted"));
    expect(await reason(aborted.sdk.complete(options({ signal: controller.signal })))).toEqual([
      "assistant_cancelled",
      {},
    ]);
  });

  test("the fake runtime answers deterministically, keeps its calls, and takes a scripted answer", async () => {
    const fake = new FakeRuntime();
    const field = await fake.complete(options({ prompt: "<text>\nfix the login bug\n</text>" }));
    const commit = await fake.complete(
      options({
        system: "Task: write a commit message for the changes in <diff>.",
        prompt: "<text>\n</text>",
      }),
    );
    expect([field.text, commit.text, fake.completeCalls.length]).toEqual([
      "improved: fix the login bug",
      "feat(fake): describe the change",
      2,
    ]);
    expect(field.tokens).toMatchObject({ model: "claude-haiku-5-5", input: 100, output: 20 });
    const scripted = new FakeRuntime({
      complete: () => ({ text: "scripted", subtype: "success" }),
    });
    expect((await scripted.complete(options())).text).toBe("scripted");
  });
});
