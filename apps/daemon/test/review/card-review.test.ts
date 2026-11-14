import { afterEach, describe, expect, test } from "bun:test";
import type { CardDiff, DiffFile } from "@flightdeck/protocol";
import { FlightdeckError } from "../../src/kernel/errors.ts";
import {
  type CardReviewDeps,
  CardReviews,
  REVIEW_BUDGET_USD,
  reviewHold,
} from "../../src/review/card-review.ts";
import { REVIEW_SCHEMA } from "../../src/review/domain/second-opinion.ts";
import { CompleteCutShort } from "../../src/runtime/claude-sdk-runtime.ts";
import type { CompleteOptions, CompleteResult } from "../../src/runtime/types.ts";
import { EventStore } from "../../src/store/event-store.ts";

/** Issue #1439: a card's second-opinion review, with fakes for the board, the call and the comments. */

const stores: EventStore[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) s.close();
});

const tokens = {
  model: "m",
  speed: "standard",
  input: 100,
  output: 10,
  cacheRead: 0,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
};
const file = (added: string): DiffFile =>
  ({
    path: "src/a.ts",
    oldPath: null,
    status: "modified",
    additions: 1,
    deletions: 0,
    uncommitted: false,
    binary: false,
    hunks: [
      {
        header: "@@ -1,1 +1,2 @@",
        lines: [
          { op: " ", text: "keep" },
          { op: "+", text: added },
        ],
      },
    ],
  }) as DiffFile;
const answer = (findings: object[], summary = "Looked at it.") =>
  JSON.stringify({ summary, findings });
const finding = (line: number, severity = "high") => ({
  path: "src/a.ts",
  line,
  severity,
  body: "a problem",
});

function setup(
  over: Partial<CardReviewDeps> & {
    answers?: Array<CompleteResult | Error>;
    diffs?: CardDiff[];
  } = {},
) {
  const store = new EventStore(":memory:");
  stores.push(store);
  const calls: CompleteOptions[] = [];
  const added: object[] = [];
  const recorded: object[] = [];
  const answers = [
    ...(over.answers ?? [{ text: answer([finding(2)]), subtype: "success", tokens }]),
  ];
  const diffs = over.diffs ?? [{ base: "main", files: [file("SECRET123")] }];
  let reads = 0;
  const deps: CardReviewDeps = {
    db: store.db,
    card: () => ({
      id: "c1",
      projectId: "p1",
      title: "Fix",
      description: "it",
      worktreePath: "/w/c1",
      running: false,
    }),
    diff: async () => diffs[Math.min(reads++, diffs.length - 1)] as CardDiff,
    spec: async () => "the spec",
    hold: () => null,
    complete: async (opts) => {
      calls.push(opts);
      const next = answers.shift() ?? { text: answer([]), subtype: "success", tokens };
      if (next instanceof Error) throw next;
      return next;
    },
    comments: { add: async (input) => void added.push(input) },
    redact: (t) => t.replaceAll("SECRET123", "[redacted]"),
    persona: (language) => `You act as a senior code reviewer (${language}).`,
    model: "claude-sonnet-5-5",
    record: (cardId, worktree, t) => void recorded.push({ cardId, worktree, input: t.input }),
    now: () => Date.parse("2026-11-09T12:00:00Z"),
    ...over,
  };
  return { reviews: new CardReviews(deps), calls, added, recorded, store };
}

const reason = (e: unknown) =>
  e instanceof FlightdeckError ? [e.reason, e.params ?? {}] : String(e);

describe("card-review: a second opinion before Open PR (#1439)", () => {
  test("a review asks one capped, schema-bound call over the redacted diff and anchors its findings as reviewer drafts", async () => {
    const { reviews, calls, added, recorded } = setup({
      answers: [{ text: answer([finding(2), finding(1, "low")]), subtype: "success", tokens }],
    });
    const result = await reviews.start("c1");
    expect(result).toMatchObject({ state: "done", anchored: 1, cached: false, moved: false });
    expect(result.loose.map((f) => f.line)).toEqual([1]);
    expect([calls[0]?.budgetUsd, calls[0]?.schema, calls[0]?.cwd]).toEqual([
      REVIEW_BUDGET_USD,
      REVIEW_SCHEMA,
      "/w/c1",
    ]);
    expect([
      calls[0]?.prompt.includes("[redacted]"),
      calls[0]?.prompt.includes("SECRET123"),
      calls[0]?.prompt.includes("the spec"),
    ]).toEqual([true, false, true]);
    expect(added).toEqual([
      {
        target: "card:c1",
        path: "src/a.ts",
        side: "new",
        lineStart: 2,
        lineEnd: 2,
        body: "a problem",
        author: "reviewer",
        severity: "high",
      },
    ]);
    expect(recorded).toEqual([{ cardId: "c1", worktree: "/w/c1", input: 100 }]);
  });

  test("the same diff asks nothing again: its stored review answers", async () => {
    const { reviews, calls } = setup();
    await reviews.start("c1");
    const again = await reviews.start("c1");
    expect([again.cached, again.state, calls.length]).toEqual([true, "done", 1]);
  });

  test("a stored review whose loose findings are damaged reads as none, never as a wrong shape (#1609)", async () => {
    const { reviews, store } = setup({
      answers: [{ text: answer([finding(1, "low")]), subtype: "success", tokens }],
    });
    expect((await reviews.start("c1")).loose).toHaveLength(1);
    for (const damaged of ['{"a":1}', '[{"path":1}]', "not json"]) {
      store.db.query("UPDATE card_reviews SET loose = ?").run(damaged);
      const again = await reviews.start("c1");
      expect([damaged, again.cached, again.loose]).toEqual([damaged, true, []]);
    }
  });

  test("an answer that fails the schema is the diff's review, failed, and its cost counts", async () => {
    const { reviews, calls, added, recorded } = setup({
      answers: [{ text: "not json", subtype: "success", tokens }],
    });
    expect(await reviews.start("c1")).toMatchObject({ state: "failed", anchored: 0 });
    expect([added.length, recorded.length]).toEqual([0, 1]);
    expect((await reviews.start("c1")).cached).toBe(true);
    expect(calls).toHaveLength(1);
  });

  test("a call cut short at its budget fails, and what it used is recorded", async () => {
    const { reviews, recorded } = setup({
      answers: [new CompleteCutShort("error_max_budget_usd", tokens)],
    });
    expect(await reviews.start("c1")).toMatchObject({ state: "failed" });
    expect(recorded).toEqual([{ cardId: "c1", worktree: "/w/c1", input: 100 }]);
  });

  test("a call that never reached the model leaves no review, so the person can ask again", async () => {
    const down = new FlightdeckError("invalid_state", "down", "assistant_host_unavailable");
    const { reviews, calls } = setup({ answers: [down] });
    expect(reason(await reviews.start("c1").catch((e) => e))).toEqual([
      "assistant_host_unavailable",
      {},
    ]);
    expect((await reviews.start("c1")).state).toBe("done");
    expect(calls).toHaveLength(2);
  });

  test("a hold, a running card, an empty diff and a fourth review in a day are refused before any call", async () => {
    const held = setup({ hold: () => "paused" });
    expect(reason(await held.reviews.start("c1").catch((e) => e))).toEqual([
      "card_review_held",
      { hold: "paused" },
    ]);
    const busy = setup({
      card: () => ({
        id: "c1",
        projectId: "p1",
        title: "t",
        description: "",
        worktreePath: "/w",
        running: true,
      }),
    });
    expect(reason(await busy.reviews.start("c1").catch((e) => e))).toEqual([
      "card_review_running",
      {},
    ]);
    const empty = setup({ diffs: [{ base: "main", files: [] }] });
    expect(reason(await empty.reviews.start("c1").catch((e) => e))).toEqual([
      "card_review_no_diff",
      {},
    ]);
    const many = setup({
      diffs: [1, 1, 2, 2, 3, 3, 4].map((n) => ({ base: "main", files: [file(`line ${n}`)] })),
    });
    for (let i = 0; i < 3; i++) await many.reviews.start("c1");
    expect(reason(await many.reviews.start("c1").catch((e) => e))).toEqual([
      "card_review_limit",
      { max: "3" },
    ]);
    expect([held.calls.length, busy.calls.length, empty.calls.length, many.calls.length]).toEqual([
      0, 0, 0, 3,
    ]);
  });

  test("a diff that moved during the review anchors nothing: every finding goes to the summary", async () => {
    const { reviews, added } = setup({
      diffs: [
        { base: "main", files: [file("a")] },
        { base: "main", files: [file("b")] },
      ],
    });
    const result = await reviews.start("c1");
    expect([result.moved, result.anchored, result.loose.length, added.length]).toEqual([
      true,
      0,
      1,
      0,
    ]);
  });

  test("a second ask while one runs is refused", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const { reviews } = setup({
      complete: async () => {
        await gate;
        return { text: answer([]), subtype: "success", tokens };
      },
    });
    const first = reviews.start("c1");
    const second = await reviews.start("c1").catch((e) => e);
    release();
    await first;
    expect(reason(second)).toEqual(["card_review_running", {}]);
  });

  test("from the security review: a call that failed after it may have spent counts toward the day's limit, and can be asked again", async () => {
    const down = () => new FlightdeckError("invalid_state", "down", "assistant_host_unavailable");
    const { reviews, calls } = setup({ answers: [down(), down(), down(), down()] });
    for (let i = 0; i < 3; i++) await reviews.start("c1").catch(() => null);
    expect(reason(await reviews.start("c1").catch((e) => e))).toEqual([
      "card_review_limit",
      { max: "3" },
    ]);
    expect(calls).toHaveLength(3);
  });

  test("from the review: a throw outside the call (the spec read) leaves no running key, and asking again works", async () => {
    let fail = true;
    const { reviews, calls } = setup({
      spec: async () => {
        if (fail) throw new Error("git broke");
        return undefined;
      },
    });
    expect(String(await reviews.start("c1").catch((e) => e))).toContain("git broke");
    fail = false;
    expect((await reviews.start("c1")).state).toBe("done");
    expect(calls).toHaveLength(1);
  });

  test("from the review: a review left running by a restart is no longer running for the next daemon", async () => {
    const hang = setup({ complete: () => new Promise<CompleteResult>(() => {}) });
    void hang.reviews.start("c1");
    // timing: let the first start write its running key before the restart
    await Bun.sleep(0);
    const restarted = new CardReviews(hang.reviews.deps);
    let asked = 0;
    restarted.deps.complete = async () => {
      asked++;
      return { text: answer([]), subtype: "success", tokens };
    };
    expect((await restarted.start("c1")).state).toBe("done");
    expect(asked).toBe(1);
  });

  test("from the review: the key covers the card's text too, and a card without a worktree is refused", async () => {
    let title = "Fix";
    const card = () => ({
      id: "c1",
      projectId: "p1",
      title,
      description: "it",
      worktreePath: "/w/c1",
      running: false,
    });
    const { reviews, calls } = setup({ card });
    await reviews.start("c1");
    title = "Fix the login";
    expect((await reviews.start("c1")).cached).toBe(false);
    expect(calls).toHaveLength(2);
    const bare = setup({
      card: () => ({
        id: "c1",
        projectId: "p1",
        title: "t",
        description: "",
        worktreePath: null,
        running: false,
      }),
    });
    expect(reason(await bare.reviews.start("c1").catch((e) => e))).toEqual([
      "card_no_worktree",
      {},
    ]);
    expect(bare.calls).toHaveLength(0);
  });

  test("from the review: the review writes in the app's language", async () => {
    const { reviews, calls } = setup();
    await reviews.start("c1", "pt-BR");
    expect(calls[0]?.system).toContain("(pt-BR)");
    expect(calls[0]?.system).toContain(
      "Write the summary and the findings in Brazilian Portuguese.",
    );
  });

  test("from the review: the holds are named in order: paused, quota, memory, then budget", () => {
    expect(reviewHold({ paused: true, quota: true, memory: true, budget: true })).toBe("paused");
    expect(reviewHold({ paused: false, quota: true, memory: true, budget: true })).toBe("quota");
    expect(reviewHold({ paused: false, quota: false, memory: true, budget: true })).toBe("memory");
    expect(reviewHold({ paused: false, quota: false, memory: false, budget: true })).toBe("budget");
    expect(reviewHold({ paused: false, quota: false, memory: false, budget: false })).toBeNull();
  });

  test("from the second review: the day's limit counts attempts in the last 24 hours, not a diff's lifetime", async () => {
    let now = Date.parse("2026-11-09T12:00:00Z");
    const down = () => new FlightdeckError("invalid_state", "down", "assistant_host_unavailable");
    const { reviews, calls } = setup({ answers: [down(), down(), down(), down()], now: () => now });
    for (let i = 0; i < 3; i++) await reviews.start("c1").catch(() => null);
    now += 48 * 60 * 60 * 1000;
    // One more failed attempt two days later: the window holds one, not four.
    await reviews.start("c1").catch(() => null);
    expect((await reviews.start("c1")).state).toBe("done");
    expect(calls).toHaveLength(5);
  });

  test("from the second review: a second ask while the first still reads the diff is refused, even for a changed card", async () => {
    let title = "Fix";
    let release: () => void = () => {};
    const slow = new Promise<void>((r) => {
      release = r;
    });
    let reads = 0;
    const { reviews, calls } = setup({
      card: () => ({
        id: "c1",
        projectId: "p1",
        title,
        description: "it",
        worktreePath: "/w/c1",
        running: false,
      }),
      diff: async () => {
        if (reads++ === 0) await slow;
        return { base: "main", files: [file("a")] };
      },
    });
    const first = reviews.start("c1");
    title = "Fix the login";
    const second = await reviews.start("c1").catch((e) => e);
    release();
    await first;
    expect(reason(second)).toEqual(["card_review_running", {}]);
    expect(calls).toHaveLength(1);
  });
});
