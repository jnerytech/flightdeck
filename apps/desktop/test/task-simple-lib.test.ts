import { describe, expect, test } from "bun:test";
import { emptySession, type SessionState } from "../src/lib/session-state.ts";
import { lastSummary, pendingQuestion, recentTools, taskState } from "../src/lib/simple-task.ts";

const session = (over: Partial<SessionState> = {}): SessionState => ({
  ...emptySession(),
  ...over,
});
const result = (isError = false) => ({
  kind: "result" as const,
  seq: 9,
  subtype: isError ? "error" : "success",
  isError,
  durationMs: 1000,
});

describe("task-simple-lib: where a task is", () => {
  test("Given each status, Then the task is working, waiting, done, stopped or failed", () => {
    expect(taskState(session({ status: "running" }))).toBe("working");
    expect(taskState(session({ status: "starting" }))).toBe("working");
    expect(taskState(session({ status: "awaiting_permission" }))).toBe("waiting");
    expect(taskState(session({ status: "idle", items: [result()] }))).toBe("done");
    expect(taskState(session({ status: "idle" }))).toBe("working");
    expect(taskState(session({ status: "ended", items: [result()] }))).toBe("stopped");
    expect(taskState(session({ status: "error" }))).toBe("failed");
    expect(taskState(session({ status: "idle", items: [result(true)] }))).toBe("failed");
  });

  test("Given a finished task, Then the summary is the last thing Claude said, as text", () => {
    const s = session({
      items: [
        { kind: "assistant", seq: 1, blocks: [{ type: "text", text: "first" }] },
        {
          kind: "assistant",
          seq: 2,
          blocks: [
            { type: "text", text: "The report is ready." },
            { type: "tool_use", id: "t", name: "Write", input: {} },
            { type: "text", text: "It has three parts." },
          ],
        },
      ],
    });
    expect(lastSummary(s)).toBe("The report is ready.\n\nIt has three parts.");
    expect(lastSummary(session())).toBe("");
  });

  test("Given a conversation, Then the recent tools are those since the person's last message", () => {
    const call = (id: string, name: string) => ({ type: "tool_use" as const, id, name, input: {} });
    const s = session({
      items: [
        { kind: "assistant", seq: 1, blocks: [call("a", "Read")] },
        { kind: "user", seq: 2, text: "more" },
        { kind: "assistant", seq: 3, blocks: [call("b", "Grep"), call("c", "Write")] },
      ],
    });
    expect(recentTools(s).map((t) => t.name)).toEqual(["Grep", "Write"]);
  });

  test("Given a request waiting, Then the question is its plain wording; one without it is worded here", () => {
    const plain = {
      kind: "run" as const,
      sentence: {
        en: "Run a step on this computer",
        "pt-BR": "Executar uma etapa neste computador",
      },
      consequence: {
        en: "It may change files on this computer.",
        "pt-BR": "Isso pode mudar arquivos neste computador.",
      },
      reversible: true,
      outcome: "ask" as const,
      hold: false,
    };
    const asked = (extra: object) =>
      session({
        pending: ["r1"],
        items: [
          {
            kind: "permission",
            seq: 1,
            requestId: "r1",
            toolName: "Bash",
            input: { command: "a && b" },
            ...extra,
          },
        ],
      });
    expect(pendingQuestion(asked({ plain }))).toEqual({ requestId: "r1", plain });
    const worded = pendingQuestion(asked({ risk: "high" }));
    expect(worded?.plain.sentence.en).toBe("Run a step on this computer");
    expect(worded?.plain.hold).toBe(true);
    expect(pendingQuestion(session())).toBeNull();
  });
});
