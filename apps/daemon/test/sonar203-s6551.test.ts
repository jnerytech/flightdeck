import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { ProjectMemory } from "../src/memory/memory.ts";
import { RiskClassifier } from "../src/permissions/risk.ts";
import { ClaudeSdkRuntime, type QueryHandle } from "../src/runtime/claude-sdk-runtime.ts";
import { OpenCodeEvents } from "../src/runtime/opencode-events.ts";
import { tempDir } from "./helpers.ts";

/**
 * Sonar S6551 (#203): a value that is not text is never turned into "[object Object]" or its
 * pieces. Each place reads only a string, and anything else counts as empty, as the risk level
 * already did for a shell command.
 */
describe("S6551: what is not text counts as empty (#203)", () => {
  test("a shell command that is not text is no network call, as its risk level already reads it", () => {
    const risk = new RiskClassifier({ allowedRoots: [], home: "/home/u" });
    const odd = risk.classify("Bash", { command: ["curl https://example.com"] }, "/w");
    const empty = risk.classify("Bash", { command: "" }, "/w");
    expect([odd.network, odd.level]).toEqual([false, empty.level]);
    expect(risk.classify("Bash", { command: "curl https://example.com" }, "/w").network).toBe(true);
  });

  test("a tool result block whose path is not text shows its type alone", () => {
    const events = new OpenCodeEvents();
    events.update({
      sessionUpdate: "tool_call",
      toolCallId: "e1",
      name: "edit",
      status: "pending",
      rawInput: {},
    });
    const [, result] = events.update({
      sessionUpdate: "tool_call_update",
      toolCallId: "e1",
      status: "completed",
      rawInput: {},
      content: [{ type: "diff", path: { name: "a.ts" } }],
    });
    expect((result as { content?: string } | undefined)?.content).toBe("[diff]");
  });

  test("a judge's reason that is not text is an empty reason; its decision stands", async () => {
    const result = {
      type: "result",
      subtype: "success",
      structured_output: { decision: "deny", reason: { why: "rm -rf" } },
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
      modelUsage: {},
    } as unknown as SDKMessage;
    const runtime = new ClaudeSdkRuntime({
      query: () =>
        ({
          async *[Symbol.asyncIterator]() {
            yield result;
          },
          interrupt: async () => {},
          close: () => {},
        }) as QueryHandle,
    });
    const judged = await runtime.judgePermission({ model: "m", prompt: "p", cwd: tempDir() });
    expect([judged.decision, judged.reason]).toEqual(["deny", ""]);
  });

  test("a skill whose description is not text counts its name alone in the memory budget", async () => {
    const claudeDir = tempDir("fd-claude-");
    const repo = tempDir("fd-repo-");
    const skill = join(claudeDir, "skills", "s1", "SKILL.md");
    mkdirSync(join(skill, ".."), { recursive: true });
    writeFileSync(skill, "---\nname: s1\ndescription: 42\n---\nbody\n");
    const memory = new ProjectMemory({ claudeDir, clock: () => Date.UTC(2026, 10, 8, 12) });
    const skills = (await memory.budget(repo)).sources.filter((s) => s.kind === "skills");
    expect(skills.map((s) => s.bytes)).toEqual([Buffer.byteLength("s1: ")]);
  });
});
