import { describe, expect, test } from "bun:test";
import { ExternalPermissions } from "../src/central/external-permissions.ts";

type Asked = { sessionKey: string; toolName: string; cwd: string };

/** A hook payload held by an ExternalPermissions whose auto-approver only writes down what it was asked. */
async function asked(payload: Record<string, unknown>): Promise<Asked> {
  const seen: Asked[] = [];
  const permissions = new ExternalPermissions({
    auto: {
      decide: async (request) => {
        seen.push({
          sessionKey: request.sessionKey,
          toolName: request.toolName,
          cwd: request.cwd,
        });
        return null;
      },
    },
  });
  await permissions.hold(payload, new AbortController().signal);
  return seen[0] as Asked;
}

describe("external permissions: the text fields of a hook payload", () => {
  test("a tool name, folder and session id that are text are read as they came", async () => {
    expect(await asked({ tool_name: "Bash", cwd: "/p", session_id: "s1" })).toEqual({
      sessionKey: "s1",
      toolName: "Bash",
      cwd: "/p",
    });
  });

  test("a field that is missing or is not text reads as empty, never as [object Object]", async () => {
    expect(await asked({ tool_name: { nested: true }, cwd: ["/p"], session_id: 7 })).toEqual({
      sessionKey: "",
      toolName: "",
      cwd: "",
    });
    expect(await asked({})).toEqual({ sessionKey: "", toolName: "", cwd: "" });
  });
});
