import { describe, expect, test } from "bun:test";
import { translator } from "../src/i18n/index.ts";
import { bulkSplit, holdLines, queueLine, queueSplit, runMany } from "../src/lib/board-bulk.ts";

/**
 * #1354 (docs/decisions/2026-11-09-board-bulk-actions.md): Start N and Stop N act on the selection.
 * Start takes the cards that are neither running nor queued; Stop takes the ones that are. Start
 * says how many start now and how many wait in the host's queue (at most `maxParallelRuns` at once).
 */
const card = (id: string, over: object = {}) =>
  ({ id, title: `card ${id}`, queued: false, sessionStatus: null, ...over }) as never;
const t = translator("en");
const tPt = translator("pt-BR");

describe("board-bulk: what Start and Stop take (#1354)", () => {
  test("Start takes the idle cards and names why the rest stay out; Stop takes the running and queued", () => {
    const split = bulkSplit(
      [
        card("a"),
        card("b", { sessionStatus: "running" }),
        card("c", { queued: true }),
        card("d", { sessionStatus: "idle" }),
      ],
      t,
    );
    expect({
      start: split.start.map((c: { id: string }) => c.id),
      skipStart: split.skipStart.map(
        (s: { card: { id: string }; reason: string }) => `${s.card.id}: ${s.reason}`,
      ),
      stop: split.stop.map((c: { id: string }) => c.id),
      skipStop: split.skipStop.map((c: { id: string }) => c.id),
    }).toEqual({
      start: ["a", "d"],
      skipStart: ["b: the card is already running", "c: the card is already queued"],
      stop: ["b", "c"],
      skipStop: ["a", "d"],
    });
  });
});

describe("board-bulk: the host's queue (#1354)", () => {
  test("as many start now as free places, the rest wait; none free means all wait", () => {
    expect([
      queueSplit(3, 2, 1),
      queueSplit(3, 4, 0),
      queueSplit(2, 2, 2),
      queueSplit(2, 1, 3),
    ]).toEqual([
      { now: 1, later: 2 },
      { now: 3, later: 0 },
      { now: 0, later: 2 },
      { now: 0, later: 2 },
    ]);
  });

  test("the line says it in one or many, in both languages, and without a known limit just says they queue", () => {
    expect([
      queueLine(t, { now: 1, later: 2 }, 2),
      queueLine(t, { now: 2, later: 1 }, 3),
      queueLine(t, { now: 3, later: 0 }, 4),
      queueLine(t, { now: 0, later: 2 }, 2),
      queueLine(t, { now: 1, later: 2 }, null),
      queueLine(tPt, { now: 1, later: 2 }, 2),
      queueLine(tPt, { now: 2, later: 1 }, 3),
    ]).toEqual([
      "1 starts now and 2 wait in the board's queue (at most 2 at once).",
      "2 start now and 1 waits in the board's queue (at most 3 at once).",
      "All of them start now.",
      "They join the board's queue.",
      "They join the board's queue.",
      "1 inicia agora e 2 esperam na fila do board (no máximo 2 ao mesmo tempo).",
      "2 iniciam agora e 1 espera na fila do board (no máximo 3 ao mesmo tempo).",
    ]);
  });
});

describe("board-bulk: one card at a time (#1354)", () => {
  test("each card is asked in order, one after the other, and a refused one comes back named", async () => {
    const order: string[] = [];
    let going = 0;
    let most = 0;
    const refused = await runMany([card("a"), card("b"), card("c")], async (c: { id: string }) => {
      going++;
      most = Math.max(most, going);
      order.push(c.id);
      // A yield: run in parallel, every request would count itself going before any came back.
      await Promise.resolve();
      going--;
      return c.id === "b" ? { ok: false, message: "no room", reason: "busy" } : { ok: true };
    });
    expect([order, most, refused.map((r) => `${r.card.id}: ${r.message} (${r.reason})`)]).toEqual([
      ["a", "b", "c"],
      1,
      ["b: no room (busy)"],
    ]);
  });
});

describe("board-bulk: what keeps new cards waiting (#1393)", () => {
  const budget = (over: object = {}) =>
    ({
      id: "b",
      scope: "host",
      projectKey: null,
      action: "queue",
      fraction: 1.2,
      ...over,
    }) as never;
  const none = { budgets: [], projectKey: "k1", cards: [] };

  test("a host budget that holds new cards and is at its limit says so; a notify-only or under-limit one does not", () => {
    const lines = (budgets: object[]) =>
      holdLines(t, "alfa", { ...none, budgets: budgets as never });
    expect([
      lines([budget()]),
      lines([budget({ action: "notify" })]),
      lines([budget({ fraction: 0.5 })]),
      lines([]),
    ]).toEqual([
      ["alfa reached a budget that holds new cards: they wait until its period resets."],
      [],
      [],
      [],
    ]);
  });

  test("a project budget counts only for its own project", () => {
    const own = holdLines(t, "alfa", {
      ...none,
      budgets: [budget({ scope: "project", projectKey: "k1" })],
    });
    const other = holdLines(t, "alfa", {
      ...none,
      budgets: [budget({ scope: "project", projectKey: "k2" })],
    });
    expect([own.length, other.length]).toEqual([1, 0]);
  });

  test("a queued card the host says waits for a budget or for memory names that hold, once", () => {
    const cards = [
      card("a", { queued: true, queueReason: "memory" }),
      card("b", { queued: true, queueReason: "memory" }),
      card("c", { queued: true, queueReason: "slot" }),
    ];
    const memory = holdLines(t, "alfa", { ...none, cards });
    const budget = holdLines(t, "alfa", {
      ...none,
      cards: [card("d", { queued: true, queueReason: "budget" })],
    });
    expect([memory, budget.length]).toEqual([
      ["alfa is short of memory: new cards wait until it frees up."],
      1,
    ]);
  });

  test("in pt-BR the lines are translated, and a host with both holds gets both", () => {
    const lines = holdLines(tPt, "alfa", {
      budgets: [budget()],
      projectKey: null,
      cards: [card("a", { queued: true, queueReason: "memory" })],
    });
    expect(lines).toEqual([
      "alfa chegou a um orçamento que segura cards novos: eles esperam o período renovar.",
      "alfa está sem memória: os cards novos esperam ela liberar.",
    ]);
  });
});
