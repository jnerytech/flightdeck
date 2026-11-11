import { afterEach, describe, expect, test } from "bun:test";
import type { DiffFile } from "@flightdeck/protocol";
import { FlightdeckError } from "../../src/errors.ts";
import { createReview, type ReviewDeps } from "../../src/review/wiring.ts";
import { EventStore } from "../../src/store/event-store.ts";

/**
 * The review as main.ts builds it (issue #1593): the board's card, the host's gates and the usage
 * record reach the card review the way the daemon wires them.
 */

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
const file = {
  path: "src/a.ts",
  oldPath: null,
  status: "modified",
  additions: 1,
  deletions: 0,
  uncommitted: false,
  binary: false,
  hunks: [{ header: "@@ -1,1 +1,2 @@", lines: [{ op: "+", text: "new" }] }],
} as DiffFile;

const open = () => null;
const shut = () => ({ held: true });

function setup(
  over: {
    gates?: Partial<ReviewDeps["gates"]>;
    budget?: boolean;
    card?: { queued?: boolean; sessionStatus?: string | null };
    complete?: ReviewDeps["complete"] | undefined;
  } = {},
) {
  const store = new EventStore(":memory:");
  stores.push(store);
  const recorded: Array<Record<string, unknown>> = [];
  const board = {
    getCard: (id: string) => ({
      id,
      projectId: "p1",
      title: "Fix",
      description: "it",
      worktreePath: "/w/c1",
      queued: over.card?.queued ?? false,
      sessionStatus: over.card?.sessionStatus ?? null,
    }),
    diff: async () => ({ base: "main", files: [file] }),
    budgetHeld: () => over.budget ?? false,
  } as unknown as ReviewDeps["board"];
  const deps: ReviewDeps = {
    db: store.db,
    changes: {} as ReviewDeps["changes"],
    manager: {} as ReviewDeps["manager"],
    board,
    central: undefined,
    complete:
      "complete" in over
        ? over.complete
        : async () => ({
            text: JSON.stringify({ summary: "Looked at it.", findings: [] }),
            subtype: "success",
            tokens,
          }),
    spec: async () => undefined,
    redact: (t) => t,
    persona: () => "You review code.",
    gates: { hostPause: { blocked: open }, quota: { blocked: open }, memory: { blocked: open } },
    usage: { record: (entry) => void recorded.push(entry) },
  };
  deps.gates = { ...deps.gates, ...over.gates };
  return { built: createReview(deps), recorded };
}

const refusal = async (run: Promise<unknown>) =>
  run.then(
    () => "started",
    (e: unknown) => (e instanceof FlightdeckError ? [e.reason, e.params ?? {}] : String(e)),
  );

describe("review-wiring: the card review the daemon builds (#1593)", () => {
  test("a runtime with no one-shot call has the comments and no card review", () => {
    const { built } = setup({ complete: undefined });
    expect([built.reviewComments !== undefined, built.cardReviews]).toEqual([true, undefined]);
  });

  test("each host gate holds the review under its own name, the budget last", async () => {
    const held = async (over: Parameters<typeof setup>[0]) =>
      refusal(setup(over).built.cardReviews?.start("c1") ?? Promise.resolve());
    expect(await held({ gates: { hostPause: { blocked: shut } } })).toEqual([
      "card_review_held",
      { hold: "paused" },
    ]);
    expect(await held({ gates: { quota: { blocked: shut } } })).toEqual([
      "card_review_held",
      { hold: "quota" },
    ]);
    expect(await held({ gates: { memory: { blocked: shut } } })).toEqual([
      "card_review_held",
      { hold: "memory" },
    ]);
    expect(await held({ budget: true })).toEqual(["card_review_held", { hold: "budget" }]);
  });

  test("a queued card, or one whose session starts, runs or waits on a permission, is busy", async () => {
    const busy = async (card: { queued?: boolean; sessionStatus?: string | null }) =>
      refusal(setup({ card }).built.cardReviews?.start("c1") ?? Promise.resolve());
    const asked = [
      { queued: true },
      { sessionStatus: "starting" },
      { sessionStatus: "running" },
      { sessionStatus: "awaiting_permission" },
    ];
    for (const card of asked) {
      expect(await busy(card)).toEqual(["card_review_running", {}]);
    }
    expect(await busy({ sessionStatus: "idle" })).toBe("started");
  });

  test("a review's call is recorded against the card's worktree as a card call", async () => {
    const { built, recorded } = setup();
    await built.cardReviews?.start("c1");
    expect(recorded.length).toBe(1);
    expect([
      recorded[0]?.origin,
      recorded[0]?.projectPath,
      recorded[0]?.model,
      String(recorded[0]?.messageId).startsWith("card-review-c1-"),
    ]).toEqual(["card", "/w/c1", "m", true]);
  });
});
