import { describe, expect, test } from "bun:test";
import { SecretScanner } from "@flightdeck/protocol";
import { EventStore } from "../src/store/event-store.ts";
import { buildSummary, sessionCost } from "../src/summary/summary.ts";

const turns = (prompt: string, answer: string, question: string | null = null) =>
  buildSummary({
    main: [
      JSON.stringify({ type: "user", message: { role: "user", content: prompt } }),
      JSON.stringify({
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: answer }] },
      }),
    ].join("\n"),
    costUsd: null,
    pending: question === null ? null : { kind: "question", text: question },
    state: "idle",
    scanner: new SecretScanner(),
  });

describe("resumo-limites", () => {
  test("asked is cut at 280, done at 480 and the question at 280, with an ellipsis", () => {
    const summary = turns("a".repeat(400), "b".repeat(900), "c".repeat(400));
    expect(summary.asked).toBe(`${"a".repeat(279)}…`);
    expect(summary.done).toBe(`${"b".repeat(479)}…`);
    expect(summary.question).toBe(`${"c".repeat(279)}…`);
  });

  test("text within the limit is kept and its whitespace is collapsed to single spaces", () => {
    const summary = turns("fix\n\n  the   build", "done.\nAll green.");
    expect(summary.asked).toBe("fix the build");
    expect(summary.done).toBe("done. All green.");
  });

  test("a cut never splits an emoji", () => {
    const summary = turns("😀".repeat(300), "ok");
    expect(summary.asked).toBe(`${"😀".repeat(279)}…`);
  });

  test("a field that holds a secret is replaced and the secret is never in the summary", () => {
    const key = "sk-abcdefghijklmnopqrstuvwxyz0123";
    const summary = turns(
      `use ${key} please`,
      `I set token=${"x".repeat(12)} for you`,
      `Send ${key}?`,
    );
    expect(summary.asked).toBe("[secret hidden]");
    expect(summary.done).toBe("[secret hidden]");
    expect(summary.question).toBe("[secret hidden]");
    expect(JSON.stringify(summary)).not.toContain("abcdefghijklmnop");
  });

  test("a file path with a secret in it is hidden too", () => {
    const summary = buildSummary({
      main: JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              name: "Edit",
              input: { file_path: "/r/ghp_abcdefghijklmnopqrstuv.txt" },
            },
          ],
        },
      }),
      costUsd: null,
      pending: null,
      state: "idle",
      scanner: new SecretScanner(),
    });
    expect(summary.files).toEqual(["[secret hidden]"]);
  });

  test("cost is the sum of the session's usage entries, null without rows", () => {
    const db = new EventStore(":memory:").db;
    const add = (id: string, session: string, cost: number | null) =>
      db
        .query(
          `INSERT INTO usage_entries (message_id, claude_session_id, at, day, project_key, model, origin,
             speed, input, output, cache_read, cache_write_5m, cache_write_1h, cost_usd)
           VALUES (?, ?, '2026-11-01T12:00:00.000Z', '2026-11-01', 'p', 'm', 'terminal', 'standard', 1, 1, 0, 0, 0, ?)`,
        )
        .run(id, session, cost);
    add("m1", "s1", 0.25);
    add("m2", "s1", 0.5);
    add("m3", "s2", 9);
    expect(sessionCost(db, "s1")).toBe(0.75);
    expect(sessionCost(db, "nope")).toBeNull();
  });
});
