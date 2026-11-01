import { describe, expect, test } from "bun:test";
import { resolveAllowedCwd } from "../src/paths.ts";
import { newManager } from "./helpers.ts";

/** What a refusal carries: the code, the reason the app translates, its params and the log text. */
function refusal(fn: () => unknown) {
  try {
    fn();
    return null;
  } catch (error) {
    const { code, reason, params, message } = error as {
      code: string;
      reason?: string;
      params?: Record<string, string | number>;
      message: string;
    };
    return { code, reason, params, message };
  }
}

async function refusalOf(run: () => Promise<unknown>) {
  try {
    await run();
    return null;
  } catch (error) {
    const { code, reason, params, message } = error as {
      code: string;
      reason?: string;
      params?: Record<string, string | number>;
      message: string;
    };
    return { code, reason, params, message };
  }
}

describe("recusas-sessao: folders and sessions refuse with a reason the app translates", () => {
  test("a folder that does not exist, or lies outside allowedRoots, says which and where", () => {
    const { root } = newManager();
    expect(refusal(() => resolveAllowedCwd("/does/not/exist", [root]))).toMatchObject({
      code: "forbidden_cwd",
      reason: "cwd_missing",
      params: { cwd: "/does/not/exist" },
    });
    expect(refusal(() => resolveAllowedCwd("/tmp", [root]))).toMatchObject({
      code: "forbidden_cwd",
      reason: "cwd_outside_roots",
      params: { cwd: "/tmp" },
    });
  });

  test("an unknown session, a send to an ended one and a resume of a live one each have a reason", async () => {
    const { manager, project } = newManager();
    expect(refusal(() => manager.get("nope"))).toMatchObject({
      code: "not_found",
      reason: "session_not_found",
      params: { id: "nope" },
    });
    const { sessionId } = manager.create({ cwd: project, prompt: "oi" });
    expect(refusal(() => manager.resume(sessionId))).toMatchObject({
      code: "invalid_state",
      reason: "session_not_ended",
    });
    await manager.close(sessionId);
    expect(refusal(() => manager.send(sessionId, "mais"))).toMatchObject({
      code: "invalid_state",
      reason: "session_ended",
    });
  });

  test("the MCP controls of a session that is not running say so, for changing and for asking", async () => {
    const { manager } = newManager();
    expect(await refusalOf(() => manager.toggleMcpServer("nope", "x", true))).toMatchObject({
      code: "invalid_state",
      reason: "mcp_set_not_live",
    });
    expect(await refusalOf(() => manager.mcpStatus("nope"))).toMatchObject({
      code: "invalid_state",
      reason: "mcp_query_not_live",
    });
  });

  test("every message is English technical text, for logs and the CLI", async () => {
    const { manager, root } = newManager();
    const messages = [
      refusal(() => resolveAllowedCwd("/does/not/exist", [root]))?.message,
      refusal(() => resolveAllowedCwd("/tmp", [root]))?.message,
      refusal(() => manager.get("nope"))?.message,
      (await refusalOf(() => manager.mcpStatus("nope")))?.message,
    ];
    for (const message of messages) expect(message).not.toMatch(/[À-ú]|\b(não|sessão|diretório)\b/);
  });
});
