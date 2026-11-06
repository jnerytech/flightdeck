import { describe, expect, test } from "bun:test";
import { toolLoader } from "../src/lib/history-tool.ts";

const DETAIL = { name: "Bash", input: { command: "ls" }, result: null, truncated: false };

/** A host request that records what it was asked and answers `answer`. */
function host(answer: unknown) {
  const asked: unknown[] = [];
  const request = (async (hostId: string, type: string, payload: unknown) => {
    asked.push([hostId, type, payload]);
    return answer;
  }) as never;
  return { asked, request };
}

describe("history-tool-lib: a stored tool row reads its call from a host that can (#606)", () => {
  test("a host without history.tool gives no loader", () => {
    const { request } = host({ ok: true, data: { tool: DETAIL } });
    expect(toolLoader(request, ["file.list"], "h1", "s1")("a1", 0)).toBeUndefined();
    expect(toolLoader(request, undefined, "h1", "s1")("a1", 0)).toBeUndefined();
  });

  test("a host with it reads the call by session, message and place, and a refusal is none", async () => {
    const ok = host({ ok: true, data: { tool: DETAIL } });
    const load = toolLoader(ok.request, ["history.tool"], "h1", "s1")("a1", 2);
    expect([await load?.(), ok.asked]).toEqual([
      DETAIL,
      [["h1", "history.tool", { claudeSessionId: "s1", uuid: "a1", index: 2 }]],
    ]);
    const refused = host({ ok: false, code: "not_found", message: "x" });
    expect(await toolLoader(refused.request, ["history.tool"], "h1", "s1")("a1", 0)?.()).toBeNull();
  });
});
