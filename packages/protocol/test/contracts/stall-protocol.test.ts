import { describe, expect, test } from "bun:test";
import { SessionEvent, SessionSummary } from "../../src/index.ts";

const summary = {
  id: "s1",
  name: null,
  cwd: "/w",
  status: "running",
  permissionMode: "default",
  model: null,
  claudeSessionId: null,
  lastSeq: 3,
  createdAt: "2026-11-09T12:00:00.000Z",
  updatedAt: "2026-11-09T12:00:00.000Z",
} as const;

describe("stall protocol: a quiet session is told in its summary (issue #1478)", () => {
  test("a session summary carries when it went quiet and its last tool, and an old one has neither", () => {
    const quiet = SessionSummary.parse({
      ...summary,
      quietSince: "2026-11-09T12:05:00.000Z",
      quietTool: "Bash",
    });
    expect(quiet.quietSince).toBe("2026-11-09T12:05:00.000Z");
    expect(quiet.quietTool).toBe("Bash");
    const old = SessionSummary.parse(summary);
    expect(old.quietSince).toBeUndefined();
    expect(old.quietTool).toBeUndefined();
  });

  test("a listed session that called no tool is quiet with a null tool, and still parses", () => {
    // session.list sends `quietTool: null` for such a session (SessionManager.withQuiet).
    const quiet = SessionSummary.parse({
      ...summary,
      quietSince: "2026-11-09T12:05:00.000Z",
      quietTool: null,
    });
    expect(quiet.quietTool).toBeNull();
  });

  test("the live summary event carries the same, and the tool may be unknown", () => {
    const event = SessionEvent.parse({
      type: "session.summary",
      sessionId: "s1",
      name: null,
      cwd: "/w",
      status: "running",
      pendingPermissions: [],
      updatedAt: "2026-11-09T12:00:00.000Z",
      quietSince: "2026-11-09T12:05:00.000Z",
      quietTool: null,
    });
    expect(event.type === "session.summary" ? event.quietSince : undefined).toBe(
      "2026-11-09T12:05:00.000Z",
    );
    expect(event.type === "session.summary" ? event.quietTool : undefined).toBeNull();
  });
});
