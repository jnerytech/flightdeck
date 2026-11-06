import { describe, expect, test } from "bun:test";
import { MAX_TOOL_BYTES, toolDetail } from "../src/history/tool-detail.ts";

/**
 * Issue #606: the transcript reader opens a tool row to its full input and its result. The daemon
 * reads the session's own transcript on open and pairs the call with its result by tool_use_id.
 */
const json = (value: unknown) => JSON.stringify(value);
const call = (uuid: string, content: unknown[]) =>
  json({ type: "assistant", uuid, message: { role: "assistant", content } });
const answer = (uuid: string, id: string, content: unknown, isError = false) =>
  json({
    type: "user",
    uuid,
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }],
    },
  });

async function* lines(...all: string[]): AsyncGenerator<string> {
  for (const line of all) yield line;
}

const TRANSCRIPT = [
  call("a1", [
    { type: "text", text: "Looking around." },
    {
      type: "tool_use",
      id: "t1",
      name: "Bash",
      input: { command: "ls -la /srv && grep -n x a.ts" },
    },
    { type: "tool_use", id: "t2", name: "Read", input: { file_path: "/srv/a.ts" } },
  ]),
  "not json at all",
  // Names the call's id but is not JSON: read past, not mistaken for its result.
  'broken {"tool_use_id":"t1"',
  answer("u1", "t2", [
    { type: "text", text: "line one" },
    { type: "image" },
    { type: "text", text: "line two" },
  ]),
  answer("u2", "t1", "total 0", false),
  call("a2", [{ type: "tool_use", id: "t3", name: "Grep", input: { pattern: "TODO" } }]),
  answer("u3", "t3", "grep: bad pattern", true),
  call("a3", [{ type: "tool_use", id: "t4", name: "Bash", input: { command: "sleep 100" } }]),
];

describe("tool-detail: a tool call of a stored transcript, paired with its result (#606)", () => {
  test("the call at an index of a message gets its whole input and the result with its id", async () => {
    expect(await toolDetail(lines(...TRANSCRIPT), "a1", 0)).toEqual({
      name: "Bash",
      input: { command: "ls -la /srv && grep -n x a.ts" },
      result: { content: "total 0", isError: false },
      truncated: false,
    });
    expect(await toolDetail(lines(...TRANSCRIPT), "a1", 1)).toEqual({
      name: "Read",
      input: { file_path: "/srv/a.ts" },
      result: { content: "line one\n[image]\nline two", isError: false },
      truncated: false,
    });
  });

  test("an error result stays an error; a call with no result yet has none", async () => {
    expect((await toolDetail(lines(...TRANSCRIPT), "a2", 0))?.result).toEqual({
      content: "grep: bad pattern",
      isError: true,
    });
    expect((await toolDetail(lines(...TRANSCRIPT), "a3", 0))?.result).toBeNull();
  });

  test("an unknown message or index is nothing", async () => {
    expect([
      await toolDetail(lines(...TRANSCRIPT), "nope", 0),
      await toolDetail(lines(...TRANSCRIPT), "a1", 2),
    ]).toEqual([null, null]);
  });

  test("a big input or result is cut to the cap and says so", async () => {
    const big = "x".repeat(MAX_TOOL_BYTES + 100);
    const detail = await toolDetail(
      lines(
        call("b1", [{ type: "tool_use", id: "t9", name: "Write", input: { content: big } }]),
        answer("b2", "t9", big),
      ),
      "b1",
      0,
    );
    expect([
      detail?.truncated,
      typeof detail?.input === "string" && Buffer.byteLength(detail.input) <= MAX_TOOL_BYTES,
      Buffer.byteLength(detail?.result?.content ?? "") <= MAX_TOOL_BYTES,
      (detail?.result?.content ?? "").length > 0,
    ]).toEqual([true, true, true, true]);
  });
});
