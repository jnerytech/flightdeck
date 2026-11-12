import { describe, expect, test } from "bun:test";
import { holdsRewriter, holdsScript, installHolds } from "../../lib/shots/holds.ts";

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
  test("the answer to resources.get reads 95% in use, the hold at 90%, and holding", () => {
    const rewriter = holdsRewriter();
    rewriter.fromApp(ask("r1", "resources.get"));
    const out = JSON.parse(rewriter.fromHost(ack("r1", snapshot)));
    expect([
      out.data.memory.totalBytes,
      out.data.memory.freeBytes,
      out.data.memoryPauseAt,
      out.data.memoryHolding,
    ]).toEqual([8000, 400, 0.9, true]);
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

/** A socket that records what the app sends and lets the test play the host's frames. */
class FakeSocket {
  sent: string[] = [];
  listeners: Array<(event: { data: unknown }) => void> = [];
  send(data: string) {
    this.sent.push(data);
  }
  addEventListener(type: string, listener: (event: { data: unknown }) => void) {
    if (type === "message") this.listeners.push(listener);
  }
  play(data: unknown) {
    for (const listener of this.listeners) listener({ data });
  }
}

// Playwright's routeWebSocket never saw the app's sockets under Bun, so the print wraps the page's
// WebSocket from an init script instead: the rewriter goes in as its source.
describe("shots-holds: the page's WebSocket", () => {
  test("the rewriter's source stands alone, as an init script carries it", () => {
    // What the page runs: the source alone, with nothing of this module around it.
    const fromSource = (): unknown => {
      try {
        const make = new Function(`return (${holdsRewriter.toString()})`)();
        const made = make() as ReturnType<typeof holdsRewriter>;
        made.fromApp(ask("r1", "budget.list"));
        const out = JSON.parse(made.fromHost(ack("r1", { budgets: [] })));
        return [out.data.budgets.length, out.data.budgets[0].action];
      } catch (error) {
        return String(error);
      }
    };
    expect(fromSource()).toEqual([1, "queue"]);
  });

  test("the wrapped socket sends as it came and hands the app the rewritten answer", () => {
    const target = { WebSocket: FakeSocket as unknown as typeof WebSocket };
    installHolds(target, holdsRewriter);
    const socket = new target.WebSocket("ws://x") as unknown as FakeSocket;
    const got: unknown[] = [];
    socket.addEventListener("message", (event) => got.push(event.data));
    socket.send(ask("r1", "resources.get"));
    socket.play(ack("r1", snapshot));
    socket.play(new Uint8Array([1]));
    const read = JSON.parse(String(got[0]));
    expect([socket.sent, read.data.memoryPauseAt, got[1] instanceof Uint8Array]).toEqual([
      [ask("r1", "resources.get")],
      0.9,
      true,
    ]);
  });

  test("the init script alone wraps the window's WebSocket", () => {
    const page = { WebSocket: FakeSocket as unknown as typeof WebSocket };
    new Function("window", holdsScript())(page);
    const socket = new page.WebSocket("ws://x") as unknown as FakeSocket;
    const got: unknown[] = [];
    socket.addEventListener("message", (event) => got.push(event.data));
    socket.send(ask("r1", "budget.list"));
    socket.play(ack("r1", { budgets: [notify] }));
    expect(JSON.parse(String(got[0])).data.budgets.length).toBe(2);
  });

  // From the review of #1418: a helper Bun's transpile puts outside a function would be missing in
  // the page, where only the functions' own source goes.
  test("the init script calls no transpile helper", () => {
    expect(holdsScript().match(/\b__\w+/g) ?? []).toEqual([]);
  });
});
