import { describe, expect, test } from "bun:test";
import type { Options, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  ClaudeSdkRuntime,
  normalizeSdkMessage,
  type QueryFn,
  resolveClaudePath,
} from "../src/runtime/claude-sdk-runtime.ts";
import type { CanUseToolFn } from "../src/runtime/types.ts";

// Synthetic SDK messages: only the fields the normalizer reads matter.
const sdk = (msg: Record<string, unknown>) => msg as unknown as SDKMessage;

describe("ClaudeSdkRuntime", () => {
  test("system/init vira session.init", () => {
    expect(
      normalizeSdkMessage(
        sdk({
          type: "system",
          subtype: "init",
          session_id: "abc",
          model: "opus",
          tools: ["Read", "Bash"],
        }),
      ),
    ).toEqual([
      { type: "session.init", claudeSessionId: "abc", model: "opus", tools: ["Read", "Bash"] },
    ]);
  });

  test("text_delta do agente principal vira message.delta; de subagente é ignorado", () => {
    const delta = (parent: string | null) =>
      sdk({
        type: "stream_event",
        parent_tool_use_id: parent,
        event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "oi" } },
      });
    expect(normalizeSdkMessage(delta(null))).toEqual([{ type: "message.delta", text: "oi" }]);
    expect(normalizeSdkMessage(delta("toolu_1"))).toEqual([]);
  });

  test("assistant mantém texto e tool_use e descarta thinking", () => {
    const msg = sdk({
      type: "assistant",
      parent_tool_use_id: null,
      message: {
        content: [
          { type: "thinking", thinking: "hmm" },
          { type: "text", text: "Vou ler" },
          { type: "tool_use", id: "toolu_1", name: "Read", input: { file_path: "a.ts" } },
        ],
      },
    });
    expect(normalizeSdkMessage(msg)).toEqual([
      {
        type: "message.assistant",
        blocks: [
          { type: "text", text: "Vou ler" },
          { type: "tool_use", id: "toolu_1", name: "Read", input: { file_path: "a.ts" } },
        ],
      },
    ]);
    const onlyThinking = sdk({
      type: "assistant",
      parent_tool_use_id: null,
      message: { content: [{ type: "thinking", thinking: "x" }] },
    });
    expect(normalizeSdkMessage(onlyThinking)).toEqual([]);
  });

  test("tool_result do usuário vira tool.result resumido", () => {
    const long = "x".repeat(10_000);
    const msg = sdk({
      type: "user",
      parent_tool_use_id: null,
      message: {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "toolu_1", content: "ok" },
          {
            type: "tool_result",
            tool_use_id: "toolu_2",
            is_error: true,
            content: [{ type: "text", text: long }],
          },
        ],
      },
    });
    const events = normalizeSdkMessage(msg);
    expect(events[0]).toEqual({
      type: "tool.result",
      toolUseId: "toolu_1",
      content: "ok",
      isError: false,
    });
    expect(events[1]).toMatchObject({ type: "tool.result", toolUseId: "toolu_2", isError: true });
    expect(events[1]?.type === "tool.result" && events[1].content.length).toBeLessThan(5000);
  });

  test("result vira turn.result com custo e usage", () => {
    const msg = sdk({
      type: "result",
      subtype: "success",
      is_error: false,
      duration_ms: 1200,
      total_cost_usd: 0.01,
      usage: {
        input_tokens: 5,
        output_tokens: 7,
        cache_read_input_tokens: 3,
        cache_creation_input_tokens: 0,
      },
    });
    expect(normalizeSdkMessage(msg)).toEqual([
      {
        type: "turn.result",
        subtype: "success",
        isError: false,
        durationMs: 1200,
        costUsd: 0.01,
        usage: {
          inputTokens: 5,
          outputTokens: 7,
          cacheReadInputTokens: 3,
          cacheCreationInputTokens: 0,
        },
      },
    ]);
  });

  test("mensagens irrelevantes são ignoradas", () => {
    expect(normalizeSdkMessage(sdk({ type: "system", subtype: "status" }))).toEqual([]);
    expect(normalizeSdkMessage(sdk({ type: "rate_limit_event" }))).toEqual([]);
  });

  test("start passa as opções da spec ao query e liga send, canUseTool, interrupt e close", async () => {
    let captured: { prompt: AsyncIterable<SDKUserMessage>; options: Options } | undefined;
    const calls: string[] = [];
    let finish: () => void = () => {};
    const queryFn: QueryFn = (params) => {
      captured = params as typeof captured;
      const done = new Promise<void>((resolve) => {
        finish = resolve;
      });
      return {
        async *[Symbol.asyncIterator]() {
          yield sdk({ type: "system", subtype: "init", session_id: "s1", model: "m", tools: [] });
          await done;
        },
        interrupt: async () => {
          calls.push("interrupt");
        },
        close: () => {
          calls.push("close");
          finish();
        },
      };
    };

    const decisions: Parameters<CanUseToolFn>[] = [];
    const runtime = new ClaudeSdkRuntime({ query: queryFn, claudePath: "/bin/claude" });
    const run = runtime.start({
      cwd: "/proj",
      resume: "claude-1",
      permissionMode: "default",
      model: "opus",
      env: { PATH: "/bin" },
      canUseTool: async (...args) => {
        decisions.push(args);
        return args[0] === "Bash" ? { behavior: "deny", message: "não" } : { behavior: "allow" };
      },
    });

    const iterator = run.events[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toMatchObject({
      type: "session.init",
      claudeSessionId: "s1",
    });

    const options = captured?.options as Options;
    expect(options.cwd).toBe("/proj");
    expect(options.resume).toBe("claude-1");
    expect(options.permissionMode).toBe("default");
    expect(options.model).toBe("opus");
    expect(options.includePartialMessages).toBe(true);
    expect(options.settingSources).toEqual(["user", "project", "local"]);
    expect(options.systemPrompt).toEqual({ type: "preset", preset: "claude_code" });
    expect(options.env).toEqual({ PATH: "/bin", FLIGHTDECK_MANAGED: "1" });
    expect(options.pathToClaudeCodeExecutable).toBe("/bin/claude");

    const signal = new AbortController().signal;
    const allow = await options.canUseTool?.(
      "Write",
      { a: 1 },
      { signal, toolUseID: "t1", requestId: "r1" },
    );
    expect(allow).toEqual({ behavior: "allow", updatedInput: { a: 1 } });
    const deny = await options.canUseTool?.(
      "Bash",
      {},
      { signal, toolUseID: "t2", requestId: "r2" },
    );
    expect(deny).toEqual({ behavior: "deny", message: "não" });
    expect(decisions[0]?.[2].toolUseId).toBe("t1");

    run.send("olá");
    const prompt = captured?.prompt[Symbol.asyncIterator]();
    const first = await prompt?.next();
    expect(first?.value).toMatchObject({
      type: "user",
      parent_tool_use_id: null,
      message: { role: "user", content: "olá" },
    });

    await run.interrupt();
    await run.close();
    expect(calls).toEqual(["interrupt", "close"]);
    expect((await iterator.next()).done).toBe(true);
  });

  test("subagente e conteúdos atípicos de tool_result", () => {
    expect(
      normalizeSdkMessage(
        sdk({ type: "assistant", parent_tool_use_id: "t", message: { content: [] } }),
      ),
    ).toEqual([]);
    expect(
      normalizeSdkMessage(sdk({ type: "user", parent_tool_use_id: "t", message: { content: [] } })),
    ).toEqual([]);
    expect(
      normalizeSdkMessage(
        sdk({ type: "user", parent_tool_use_id: null, message: { content: "texto" } }),
      ),
    ).toEqual([]);
    const user = (content: unknown) =>
      sdk({
        type: "user",
        parent_tool_use_id: null,
        message: {
          content: [
            { type: "text", text: "x" },
            { type: "tool_result", tool_use_id: "a", content },
          ],
        },
      });
    expect(normalizeSdkMessage(user(undefined))[0]).toMatchObject({ content: "" });
    expect(normalizeSdkMessage(user({ k: 1 }))[0]).toMatchObject({ content: '{"k":1}' });
    expect(normalizeSdkMessage(user([{ type: "image" }, { type: "text" }, {}]))[0]).toMatchObject({
      content: ["[image]", "", "[bloco]"].join("\n"),
    });
    const otherStream = sdk({
      type: "stream_event",
      parent_tool_use_id: null,
      event: { type: "message_start" },
    });
    expect(normalizeSdkMessage(otherStream)).toEqual([]);
  });

  test("resolveClaudePath: configurado, binário compilado e execução normal", () => {
    const which = (bin: string) => `/usr/bin/${bin}`;
    expect(resolveClaudePath("/x/claude", { main: "/src/main.ts", which })).toBe("/x/claude");
    expect(resolveClaudePath(undefined, { main: "/$bunfs/root/flightdeckd", which })).toBe(
      "/usr/bin/claude",
    );
    expect(
      resolveClaudePath(undefined, { main: "B:/~BUN/root/f.exe", which: () => null }),
    ).toBeUndefined();
    expect(resolveClaudePath(undefined, { main: "/src/main.ts", which })).toBeUndefined();
    expect(resolveClaudePath()).toBeUndefined();
  });

  test("falha do SDK propaga pelo stream de eventos; opções mínimas sem resume/model", async () => {
    let options: Options | undefined;
    const runtime = new ClaudeSdkRuntime({
      query: (params) => {
        options = params.options;
        return {
          // biome-ignore lint/correctness/useYield: the stream fails before yielding
          async *[Symbol.asyncIterator]() {
            throw new Error("cli morreu");
          },
          interrupt: async () => undefined,
          close: () => {},
        };
      },
    });
    const run = runtime.start({
      cwd: "/p",
      permissionMode: "acceptEdits",
      env: {},
      canUseTool: async () => ({ behavior: "allow", updatedInput: { b: 2 } }),
    });
    expect(run.events[Symbol.asyncIterator]().next()).rejects.toThrow("cli morreu");
    expect(options?.resume).toBeUndefined();
    expect(options?.model).toBeUndefined();
    expect(options?.pathToClaudeCodeExecutable).toBeUndefined();
    const signal = new AbortController().signal;
    expect(
      await options?.canUseTool?.("Write", { a: 1 }, { signal, toolUseID: "t", requestId: "r" }),
    ).toEqual({
      behavior: "allow",
      updatedInput: { b: 2 },
    });
  });
});
