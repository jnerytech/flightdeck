import { describe, expect, test } from "bun:test";
import { holdsRewriter } from "../lib/shots-holds.ts";

/**
 * #1414: the print of Start N's confirm shows the host's memory hold and a budget hold the same on
 * every machine. Its socket route rewrites the host's answers to `resources.get` (memory over the
 * hold, the hold on) and to `budget.list` (a host budget that holds new cards, at its limit).
 */
const ask = (id: string, type: string) => JSON.stringify({ id, type, payload: {} });
const ack = (id: string, data: object) => JSON.stringify({ type: "ack", id, ok: true, data });
const snapshot = { at: "x", memory: { totalBytes: 8000, freeBytes: 6000 }, memoryPauseAt: null };
const notify = { id: "b1", scope: "host", action: "notify", fraction: 0.1 };

describe("shots-holds", () => {
  test("the answer to resources.get reads 95% in use with the hold at 90%", () => {
    const rewriter = holdsRewriter();
    rewriter.fromApp(ask("r1", "resources.get"));
    const out = JSON.parse(rewriter.fromHost(ack("r1", snapshot)));
    expect([out.data.memory.totalBytes, out.data.memory.freeBytes, out.data.memoryPauseAt]).toEqual(
      [8000, 400, 0.9],
    );
  });

  test("the answer to budget.list keeps the host's budgets and adds one that holds, at its limit", () => {
    const rewriter = holdsRewriter();
    rewriter.fromApp(ask("r1", "budget.list"));
    const out = JSON.parse(rewriter.fromHost(ack("r1", { budgets: [notify] })));
    const added = out.data.budgets[1];
    expect([
      out.data.budgets.length,
      out.data.budgets[0].id,
      added.scope,
      added.action,
      added.fraction,
      added.projectKey,
    ]).toEqual([2, "b1", "host", "queue", 1, null]);
  });

  test("other answers, events and frames that are not JSON pass as they came", () => {
    const rewriter = holdsRewriter();
    rewriter.fromApp(ask("r1", "project.list"));
    rewriter.fromApp("not json");
    const other = ack("r1", snapshot);
    const event = JSON.stringify({ type: "board.updated", id: "r2" });
    expect([rewriter.fromHost(other), rewriter.fromHost(event), rewriter.fromHost("{")]).toEqual([
      other,
      event,
      "{",
    ]);
  });

  test("a refusal passes, and each request is rewritten once", () => {
    const rewriter = holdsRewriter(0.5, 0.4);
    rewriter.fromApp(ask("r1", "resources.get"));
    const refusal = JSON.stringify({ type: "ack", id: "r1", ok: false, error: { code: "x" } });
    rewriter.fromApp(ask("r2", "resources.get"));
    const first = JSON.parse(rewriter.fromHost(ack("r2", snapshot)));
    const again = ack("r2", snapshot);
    expect([
      rewriter.fromHost(refusal),
      first.data.memory.freeBytes,
      first.data.memoryPauseAt,
      rewriter.fromHost(again),
    ]).toEqual([refusal, 4000, 0.4, again]);
  });
});
