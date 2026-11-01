import { describe, expect, test } from "bun:test";
import { TraceNode } from "../src/index.ts";

const node = (id: string, children: unknown[] = []) => ({
  id,
  kind: "tool",
  name: "Bash",
  n: 1,
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
  children,
});

describe("TraceNode: a node of the session trace", () => {
  test("accepts a node with nested children", () => {
    const parsed = TraceNode.parse(node("a", [node("b", [node("c")])]));
    expect(parsed.children[0]?.children[0]?.id).toBe("c");
  });

  test("refuses a child that is not a node", () => {
    expect(TraceNode.safeParse(node("a", [{ id: "b" }])).success).toBe(false);
  });
});
