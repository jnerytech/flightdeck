import { describe, expect, test } from "bun:test";
import {
  bulkRunOutcome,
  bulkSkipReason,
  bulkSplit,
  bulkTitle,
  holdLines,
  queueLine,
  queueSplit,
  refusalNotice,
  requestResult,
  runMany,
  startConfirmLines,
  startQuotaLines,
  updateMany,
  updateSummary,
} from "../../src/features/board/board-bulk.ts";
import { translator } from "../../src/i18n/index.ts";

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

/**
 * #1406: Update from the base for the selection. It takes the idle cards that have a branch, one
 * after the other: a card already on its base is left alone, a conflict stops only that card (the
 * host aborts the rebase), and the summary names each group.
 */
describe("board-bulk: Update from the base for many cards (#1406)", () => {
  const branched = (id: string, over: object = {}) =>
    card(id, { branch: `fd/${id}`, worktreePath: `/w/${id}`, ...over });

  test("it takes the idle cards with a branch; one with no branch yet, or running or queued, stays out, named", () => {
    const split = bulkSplit(
      [
        branched("a"),
        card("b", { branch: null, worktreePath: null }),
        branched("c", { sessionStatus: "running" }),
        branched("d", { queued: true }),
        branched("e", { sessionStatus: "idle" }),
      ],
      t,
    );
    expect({
      update: split.update.map((c: { id: string }) => c.id),
      skipUpdate: split.skipUpdate.map(
        (s: { card: { id: string }; reason: string }) => `${s.card.id}: ${s.reason}`,
      ),
    }).toEqual({
      update: ["a", "e"],
      skipUpdate: [
        "b: the card has no branch yet",
        "c: the card is already running",
        "d: the card is already queued",
      ],
    });
  });

  test("one card at a time, in order: a current one is not rebased, a conflict does not stop the next card", async () => {
    const asked: string[] = [];
    const progress: string[] = [];
    let going = 0;
    let most = 0;
    const behind: Record<string, number | null> = { a: 2, b: 0, c: 3, d: 1, e: null };
    const results = await updateMany(
      ["a", "b", "c", "d", "e"].map((id) => branched(id)),
      {
        behind: async (c: { id: string }) => {
          going++;
          most = Math.max(most, going);
          await Promise.resolve();
          going--;
          return behind[c.id] ?? null;
        },
        update: async (c: { id: string }) => {
          going++;
          most = Math.max(most, going);
          asked.push(c.id);
          await Promise.resolve();
          going--;
          if (c.id === "c") {
            return {
              ok: false,
              message: "conflict updating with main: src/a.ts",
              reason: "rebase_conflict",
              params: { base: "main", files: "src/a.ts" },
            };
          }
          if (c.id === "d")
            return { ok: false, message: "the card is running", reason: "card_running" };
          return { ok: true };
        },
        onProgress: (done, total) => progress.push(`${done}/${total}`),
      },
    );
    expect({
      // b is on its base already: no rebase is asked for it. e's count is unknown: it is tried.
      asked,
      most,
      outcomes: results.map((r) => `${r.card.id}: ${r.outcome}`),
      conflict: results.find((r) => r.outcome === "conflicted")?.reason ?? null,
      progress,
    }).toEqual({
      asked: ["a", "c", "d", "e"],
      most: 1,
      outcomes: ["a: updated", "b: current", "c: conflicted", "d: failed", "e: updated"],
      conflict: "rebase_conflict",
      progress: ["1/5", "2/5", "3/5", "4/5", "5/5"],
    });
  });

  const results = [
    { card: branched("a"), outcome: "updated" as const },
    { card: branched("b"), outcome: "updated" as const },
    { card: branched("c"), outcome: "current" as const },
    {
      card: branched("d"),
      outcome: "conflicted" as const,
      message: "conflict updating with main: src/a.ts",
      reason: "rebase_conflict",
      params: { base: "main", files: "src/a.ts" },
    },
    {
      card: branched("e"),
      outcome: "failed" as const,
      message: "the card is running",
      reason: "card_running",
    },
  ];

  test("the summary names the updated, already current, conflicted and not updated cards, with why", () => {
    expect(updateSummary(t, results)).toBe(
      "Updated: card a, card b. Already current: card c. Conflict, left as it was: card d (Updating with main conflicts in: src/a.ts). Not updated: card e (The card is running: wait for the agent to finish).",
    );
  });

  test("a group with no card is left out of the summary, and pt-BR says it too", () => {
    expect([
      updateSummary(t, [results[2] as never]),
      updateSummary(tPt, results.slice(0, 4) as never),
    ]).toEqual([
      "Already current: card c.",
      "Atualizados: card a, card b. Já em dia: card c. Conflito, ficou como estava: card d (Atualizar com main dá conflito em: src/a.ts).",
    ]);
  });
});

/** #1125: the confirm's pieces left BoardView for pure functions; each is checked on its own. */
describe("board-bulk: the Start and Stop confirm's pieces (#1125)", () => {
  test("the title says how many cards the action takes, one or many, for Start and for Stop", () => {
    const counts = { start: 3, stop: 1 };
    expect([
      bulkTitle(t, "start", counts),
      bulkTitle(t, "start", { start: 1, stop: 1 }),
      bulkTitle(t, "stop", counts),
      bulkTitle(t, "stop", { start: 3, stop: 2 }),
    ]).toEqual([
      t("board.startTitle", { n: 3 }),
      t("board.startTitleOne"),
      t("board.stopTitleOne"),
      t("board.stopTitle", { n: 2 }),
    ]);
  });

  test("a card left out says why: running or queued for Start, needing inputs, or not running for Stop", () => {
    const split = bulkSplit([card("a"), card("b", { sessionStatus: "running" })], t);
    const a = card("a");
    const b = card("b", { sessionStatus: "running" });
    expect([
      bulkSkipReason(t, "start", split, b, false),
      bulkSkipReason(t, "start", split, a, true),
      bulkSkipReason(t, "start", split, a, false),
      bulkSkipReason(t, "stop", split, a, false),
      bulkSkipReason(t, "stop", split, b, false),
    ]).toEqual([
      t("board.startRunning"),
      t("board.needsInputs"),
      undefined,
      t("board.notRunning"),
      undefined,
    ]);
  });

  test("a host's answer is a went, or a refusal that keeps its reason and values", () => {
    expect([
      requestResult({ ok: true }),
      requestResult({ ok: false, message: "No", reason: "card_pr_conflict", params: { n: 2 } }),
      requestResult({ ok: false, message: "Plain" }),
    ]).toEqual([
      { ok: true },
      { ok: false, message: "No", reason: "card_pr_conflict", params: { n: 2 } },
      { ok: false, message: "Plain" },
    ]);
  });

  test("the refused cards are named in the one or many wording, and none says nothing", () => {
    const refused = [{ card: card("a"), message: "no" }] as never;
    const two = [...(refused as never[]), ...(refused as never[])] as never;
    const keys = { one: "board.stayedOne", many: "board.stayed" } as const;
    expect([
      refusalNotice(t, [], "x", keys),
      refusalNotice(t, refused, "A (no)", keys),
      refusalNotice(t, two, "A (no), A (no)", keys),
      bulkRunOutcome(t, "start", refused, "A (no)"),
      bulkRunOutcome(t, "stop", two, "A, B"),
      bulkRunOutcome(t, "stop", [], ""),
    ]).toEqual([
      null,
      t("board.stayedOne", { names: "A (no)" }),
      t("board.stayed", { count: 2, names: "A (no), A (no)" }),
      t("board.startFailedOne", { names: "A (no)" }),
      t("board.stopFailed", { count: 2, names: "A, B" }),
      null,
    ]);
  });

  test("a paused host is a hold line, after the budget and memory ones", () => {
    const lines = holdLines(t, "pi", { budgets: [], projectKey: null, cards: [], paused: true });
    expect([lines, holdLines(t, "pi", { budgets: [], projectKey: null, cards: [] })]).toEqual([
      [t("board.startPausedHold", { host: "pi" })],
      [],
    ]);
  });

  test("the quota lines say the 5-hour reading, and a hot window is a hold", () => {
    const reading = (used: number) => ({
      windows: [
        {
          window: "five_hour",
          utilization: used,
          status: "allowed",
          resetsAt: "2026-11-09T15:00:00Z",
          readAt: new Date().toISOString(),
        },
      ],
      pauseAt: 0.9,
    });
    const at = (quota: unknown, account: unknown) =>
      startQuotaLines(t, "pi", {
        quota: quota as never,
        account: account as never,
        now: Date.now(),
        formatTime: () => "15:00",
      });
    const cool = at(reading(0.42), undefined);
    const hot = at(reading(0.95), undefined);
    expect([
      at(undefined, undefined),
      at(undefined, { status: "signed_in" }).holds,
      cool.lines.length,
      cool.lines[0]?.includes("42"),
      cool.holds,
      hot.holds,
    ]).toEqual([
      { lines: [], holds: [] },
      [],
      1,
      true,
      [],
      [t("board.startQuotaHold", { host: "pi" })],
    ]);
  });

  test("the Start lines: the queue, then the holds, the other host and the cards with no criteria", () => {
    const base = {
      workflowsFailed: false,
      queueMax: 2,
      startable: [card("a"), card("b"), card("c")],
      runningOnHost: 0,
      quotaLines: ["quota line"],
      holds: [] as string[],
      waitingElsewhere: 0,
      contracts: {},
    };
    const plain = startConfirmLines(t, base);
    const held = startConfirmLines(t, { ...base, holds: ["a hold"], waitingElsewhere: 1 });
    const many = startConfirmLines(t, { ...base, waitingElsewhere: 3, workflowsFailed: true });
    expect([
      plain[0],
      plain.includes("quota line"),
      held[0],
      held.includes("a hold"),
      held.includes(t("board.startOnHintOne")),
      many[0],
      many.includes(t("board.startOnHint", { n: 3 })),
      startConfirmLines(t, { ...base, queueMax: undefined }).some((l) => l.includes("2")),
    ]).toEqual([
      queueLine(t, queueSplit(3, 2, 0), 2),
      true,
      queueLine(t, { now: 0, later: 3 }, 2),
      true,
      true,
      t("board.workflowsUnread"),
      true,
      false,
    ]);
  });
});
