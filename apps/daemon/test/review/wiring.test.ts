import { afterEach, describe, expect, test } from "bun:test";
import type { DiffFile } from "@flightdeck/protocol";
import { FlightdeckError } from "../../src/errors.ts";
import { createChanges, createReview, type ReviewDeps } from "../../src/review/wiring.ts";
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
    log: () => undefined,
    terminals: {} as ReviewDeps["terminals"],
    allowedRoots: ["/w"],
    scanner: { scan: () => [] },
    dataDir: "/data",
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
    heldValues: () => [],
    gates: { hostPause: { blocked: open }, quota: { blocked: open }, memory: { blocked: open } },
    usage: { record: (entry) => void recorded.push(entry) },
  };
  deps.gates = { ...deps.gates, ...over.gates };
  return { built: createReview(deps).review, recorded };
}

const refusal = async (run: Promise<unknown>) =>
  run.then(
    () => "started",
    (e: unknown) => (e instanceof FlightdeckError ? [e.reason, e.params ?? {}] : String(e)),
  );

describe("review-wiring: the card review the daemon builds (#1593)", () => {
  test("a runtime with no one-shot call has the comments and no card review", () => {
    const { built } = setup({ complete: undefined });
    expect([built.comments !== undefined, built.cardReview]).toEqual([true, undefined]);
  });

  test("each host gate holds the review under its own name, the budget last", async () => {
    const held = async (over: Parameters<typeof setup>[0]) =>
      refusal(setup(over).built.cardReview?.start("c1") ?? Promise.resolve());
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
      refusal(setup({ card }).built.cardReview?.start("c1") ?? Promise.resolve());
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
    await built.cardReview?.start("c1");
    expect(recorded.length).toBe(1);
    expect([
      recorded[0]?.origin,
      recorded[0]?.projectPath,
      recorded[0]?.model,
      String(recorded[0]?.messageId).startsWith("card-review-c1-"),
    ]).toEqual(["card", "/w/c1", "m", true]);
  });
});

describe("changes-wiring: the diffs, a plain session's commit and PR, and the files the daemon builds (#1593)", () => {
  function built() {
    const store = new EventStore(":memory:");
    stores.push(store);
    const scanner = { scan: () => [] };
    const projects: Record<string, { card: object | null; project: { prProvider: string } }> = {
      "/w/card": { card: { id: "c1" }, project: { prProvider: "azure-devops" } },
      "/w/plain": { card: null, project: { prProvider: "github" } },
    };
    const board = { projectForCwd: (cwd: string) => projects[cwd] ?? null } as never;
    const terminals = { cwdOf: () => null } as never;
    const made = createChanges({
      db: store.db,
      board,
      log: () => undefined,
      terminals,
      allowedRoots: ["/w"],
      scanner,
      dataDir: "/data",
    });
    return { ...made, scanner, board, terminals, db: store.db };
  }

  test("the diffs get the board, the terminals and the allowed roots a project checkout is held to", () => {
    const { changes, board, terminals, db } = built();
    expect([
      changes.opts.db === db,
      changes.opts.board === board,
      changes.opts.terminals === terminals,
      changes.opts.allowedRoots,
    ]).toEqual([true, true, true, ["/w"]]);
  });

  test("a card's worktree is the board's: neither the commit nor the PR takes it", () => {
    const { sessionCommits, sessionPrs } = built();
    const roots = ["/w/card", "/w/plain", "/elsewhere"];
    expect(roots.map((root) => sessionCommits.deps.isCardWorktree(root))).toEqual([
      true,
      false,
      false,
    ]);
    expect(roots.map((root) => sessionPrs.deps.isCardWorktree(root))).toEqual([true, false, false]);
  });

  test("a PR goes to its board project's provider, and to none outside a project", () => {
    const { sessionPrs } = built();
    expect(["/w/card", "/w/plain", "/elsewhere"].map(sessionPrs.deps.projectProvider)).toEqual([
      "azure-devops",
      "github",
      null,
    ]);
  });

  test("the commit and the PR share the diffs, the commits and the host's scanner", () => {
    const { changes, sessionCommits, sessionPrs, scanner } = built();
    expect([
      sessionCommits.deps.changes === changes,
      sessionPrs.deps.changes === changes,
      sessionPrs.deps.commits === sessionCommits,
      sessionCommits.deps.scanner === scanner,
      sessionPrs.deps.scanner === scanner,
    ]).toEqual([true, true, true, true, true]);
  });

  test("the files viewer reads the same diffs inside the allowed roots, its undo kept under the data folder", () => {
    const { changes, files, sessionFiles, db } = built();
    expect([
      files.opts.changes === changes,
      files.opts.allowedRoots,
      files.opts.dataDir,
      sessionFiles.opts.db === db,
    ]).toEqual([true, ["/w"], "/data", true]);
  });
});

describe("review-wiring: the review's part of the server (#1593)", () => {
  test("the module serves the group, and its comments, commits and PRs read the same diffs", () => {
    const store = new EventStore(":memory:");
    stores.push(store);
    const built = createReview({
      db: store.db,
      log: () => undefined,
      terminals: {} as ReviewDeps["terminals"],
      allowedRoots: ["/w"],
      scanner: { scan: () => [] },
      dataDir: "/data",
      manager: {} as ReviewDeps["manager"],
      board: {} as ReviewDeps["board"],
      central: undefined,
      complete: undefined,
      heldValues: () => [],
      gates: { hostPause: { blocked: open }, quota: { blocked: open }, memory: { blocked: open } },
      usage: { record: () => undefined },
    });
    const { review } = built;
    expect([
      built.modules.length,
      built.modules[0].server?.review === review,
      review.comments.opts.changes === review.changes,
      review.sessionCommits.deps.changes === review.changes,
      review.sessionPrs.deps.changes === review.changes,
      review.files.opts.changes === review.changes,
      review.sessionFiles.opts.db === store.db,
      "cardReview" in review,
    ]).toEqual([1, true, true, true, true, true, true, false]);
  });
});
