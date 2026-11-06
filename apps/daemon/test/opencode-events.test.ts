import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type AcpPromptResult,
  type AcpToolCall,
  type AcpUpdate,
  isChild,
  OpenCodeEvents,
} from "../src/runtime/opencode-events.ts";
import type { RuntimeEvent } from "../src/runtime/types.ts";

const FIXTURES = join(import.meta.dir, "fixtures", "opencode-acp");

interface Line {
  dir: "in" | "out";
  msg: {
    id?: number;
    method?: string;
    params?: { update?: AcpUpdate; toolCall?: AcpToolCall };
    result?: AcpPromptResult;
  };
}

/** The events of each prompt of a recorded session, replayed through one normalizer. */
function replay(file: string): RuntimeEvent[][] {
  const events = new OpenCodeEvents();
  const turns: RuntimeEvent[][] = [];
  const prompts = new Set<number>();
  let current: RuntimeEvent[] = [];
  const lines = readFileSync(join(FIXTURES, file), "utf8").trim().split("\n");
  for (const { dir, msg } of lines.map((l) => JSON.parse(l) as Line)) {
    if (dir === "out" && msg.method === "session/prompt") {
      prompts.add(msg.id as number);
      current = [];
    } else if (dir === "in" && msg.method === "session/update" && msg.params?.update) {
      current.push(...events.update(msg.params.update));
    } else if (
      dir === "in" &&
      msg.method === "session/request_permission" &&
      msg.params?.toolCall
    ) {
      current.push(...events.permissionRequest(msg.params.toolCall).events);
    } else if (dir === "in" && msg.result?.stopReason && prompts.has(msg.id as number)) {
      current.push(...events.promptEnded(msg.result, 100));
      turns.push(current);
    }
  }
  return turns;
}

describe("opencode-events", () => {
  test("a write: its card once with the full input, its result, the reply's delta and text, then the turn with the session's cost", () => {
    const [write] = replay("tools.jsonl");
    expect(write).toEqual([
      {
        type: "message.assistant",
        blocks: [
          {
            type: "tool_use",
            id: "toolu_0131jFVENttXcmgAk2uLPfrP",
            name: "Write",
            input: { file_path: "/work/project/notes.txt", content: "hi there\n" },
          },
        ],
      },
      {
        type: "tool.result",
        toolUseId: "toolu_0131jFVENttXcmgAk2uLPfrP",
        content: "Created file successfully: notes.txt",
        isError: false,
      },
      { type: "message.delta", text: "done." },
      { type: "message.assistant", blocks: [{ type: "text", text: "done." }] },
      {
        type: "turn.result",
        subtype: "success",
        isError: false,
        durationMs: 100,
        costUsd: 0.03723967500000001,
        usage: {
          inputTokens: 6,
          outputTokens: 145,
          cacheReadInputTokens: 13574,
          cacheCreationInputTokens: 13734,
        },
      },
    ]);
  });

  test("an edit's result keeps its text block and leaves the diff out; reads, globs and greps get their cards too", () => {
    const turns = replay("tools.jsonl");
    const results = (turn: RuntimeEvent[] | undefined) =>
      (turn ?? []).flatMap((e) => (e.type === "tool.result" ? [e.content] : []));
    expect(results(turns[1])).toEqual(["Edited notes.txt (1 replacement)"]);
    const cards = (turns[2] ?? []).flatMap((e) =>
      e.type === "message.assistant"
        ? e.blocks.flatMap((b) => (b.type === "tool_use" ? [b.name] : []))
        : [],
    );
    expect(cards).toEqual(["Read", "Glob", "Grep"]);
    expect(results(turns[2]).length).toBe(3);
  });

  test("a rejected call fails and the turn ends cancelled, as an error during execution", () => {
    const turns = replay("tools.jsonl");
    const last = turns[4] ?? [];
    expect(last.find((e) => e.type === "tool.result")).toEqual({
      type: "tool.result",
      toolUseId: "toolu_01FVdw7mqhrKUoH5EswQwGad",
      content: "The user declined this tool call",
      isError: true,
    });
    const end = last.at(-1) as Extract<RuntimeEvent, { type: "turn.result" }> | undefined;
    expect([end?.subtype, end?.isError, end?.costUsd]).toEqual([
      "error_during_execution",
      true,
      0.05501367500000001,
    ]);
  });

  test("a child session's calls, results and text are left out; the parent's subagent call is shown", () => {
    const [turn] = replay("child.jsonl");
    const kinds = (turn ?? []).map((e) =>
      e.type === "message.assistant"
        ? `assistant:${e.blocks.map((b) => (b.type === "tool_use" ? b.name : b.text)).join(",")}`
        : e.type === "tool.result"
          ? `result:${e.toolUseId.slice(-6)}`
          : e.type === "message.delta"
            ? `delta:${e.text}`
            : e.type,
    );
    expect(kinds).toEqual([
      "assistant:opencode:subagent",
      "result:JooGRj",
      "delta:done",
      "assistant:done",
      "turn.result",
    ]);
    expect(isChild({ toolCallId: "ses_child:toolu_1" })).toBe(true);
    expect(
      isChild({ toolCallId: "toolu_1", _meta: { "opencode/child-session": { id: "c" } } }),
    ).toBe(true);
    expect(isChild({ toolCallId: "toolu_1", _meta: null })).toBe(false);
  });

  test("a permission request shows the card when no update did, once, and says whether it is a child's", () => {
    const events = new OpenCodeEvents();
    events.update({
      sessionUpdate: "tool_call",
      toolCallId: "t1",
      name: "shell",
      status: "pending",
      rawInput: { cwd: "/w" },
    });
    const first = events.permissionRequest({
      toolCallId: "t1",
      name: "shell",
      rawInput: { command: "ls", cwd: "/w" },
    });
    expect(first.child).toBe(false);
    expect(first.tool).toEqual({ name: "Bash", input: { command: "ls", cwd: "/w" } });
    expect(first.events).toEqual([
      {
        type: "message.assistant",
        blocks: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls", cwd: "/w" } }],
      },
    ]);
    expect(
      events.update({
        sessionUpdate: "tool_call_update",
        toolCallId: "t1",
        status: "in_progress",
        rawInput: { command: "ls", cwd: "/w" },
      }),
    ).toEqual([]);
    const child = events.permissionRequest({
      toolCallId: "ses_c:t2",
      name: "shell",
      rawInput: { command: "x" },
    });
    expect([child.child, child.events]).toEqual([true, []]);
  });

  test("session.init once per run, with the session id and model and no slash commands", () => {
    const events = new OpenCodeEvents();
    expect(events.init("ses_1", "anthropic/claude-sonnet-5-5")).toEqual([
      {
        type: "session.init",
        claudeSessionId: "ses_1",
        model: "anthropic/claude-sonnet-5-5",
        tools: [],
      },
    ]);
    expect(events.init("ses_1", "anthropic/claude-sonnet-5-5")).toEqual([]);
  });

  test("text without a messageId joins the current message; a new messageId closes the previous one", () => {
    const events = new OpenCodeEvents();
    const chunk = (text: string, messageId?: string): AcpUpdate => ({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text },
      ...(messageId ? { messageId } : {}),
    });
    expect(events.update(chunk("a", "m1"))).toEqual([{ type: "message.delta", text: "a" }]);
    events.update(chunk("b"));
    expect(events.update(chunk("c", "m2"))).toEqual([
      { type: "message.assistant", blocks: [{ type: "text", text: "ab" }] },
      { type: "message.delta", text: "c" },
    ]);
  });

  test("thoughts, plans, commands, info and retry notices give nothing; a result with only a diff gets a short text", () => {
    const events = new OpenCodeEvents();
    for (const kind of [
      "agent_thought_chunk",
      "plan",
      "available_commands_update",
      "session_info_update",
      "config_option_update",
      "current_mode_update",
    ]) {
      expect(events.update({ sessionUpdate: kind, content: { type: "text", text: "x" } })).toEqual(
        [],
      );
    }
    events.update({
      sessionUpdate: "tool_call",
      toolCallId: "e1",
      name: "edit",
      status: "pending",
      rawInput: {},
    });
    expect(
      events.update({
        sessionUpdate: "tool_call_update",
        toolCallId: "e1",
        status: "completed",
        content: [{ type: "diff", path: "/w/a.ts", oldText: "a", newText: "b" }],
      }),
    ).toEqual([
      {
        type: "message.assistant",
        blocks: [{ type: "tool_use", id: "e1", name: "Edit", input: {} }],
      },
      { type: "tool.result", toolUseId: "e1", content: "[diff /w/a.ts]", isError: false },
    ]);
  });

  test("a long result is cut like Claude's; a turn with no usage_update has no cost; other stop reasons are errors", () => {
    const events = new OpenCodeEvents();
    events.update({
      sessionUpdate: "tool_call",
      toolCallId: "s1",
      name: "shell",
      status: "pending",
      rawInput: {},
    });
    const [, result] = events.update({
      sessionUpdate: "tool_call_update",
      toolCallId: "s1",
      status: "completed",
      rawInput: { command: "yes" },
      content: [{ type: "content", content: { type: "text", text: "y".repeat(4010) } }],
    });
    expect((result as { content?: string } | undefined)?.content).toBe(
      `${"y".repeat(4000)}… [10 caracteres omitidos]`,
    );
    const [turn] = events.promptEnded(
      { stopReason: "max_tokens", usage: { inputTokens: 1, outputTokens: 2 } },
      7,
    );
    expect(turn).toEqual({
      type: "turn.result",
      subtype: "max_tokens",
      isError: true,
      durationMs: 7,
      usage: { inputTokens: 1, outputTokens: 2 },
    });
  });

  test("a failed prompt ends the turn with an error and says why", () => {
    const events = new OpenCodeEvents();
    events.update({
      sessionUpdate: "agent_message_chunk",
      messageId: "m",
      content: { type: "text", text: "hm" },
    });
    expect(events.promptFailed("auth_required", 5)).toEqual([
      { type: "message.assistant", blocks: [{ type: "text", text: "hm" }] },
      { type: "turn.result", subtype: "error", isError: true, durationMs: 5 },
      { type: "session.error", code: "runtime", message: "auth_required" },
    ]);
  });
});
