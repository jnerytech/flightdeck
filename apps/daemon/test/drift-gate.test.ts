import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { type FileChange, measureDrift, parseNumstat } from "../src/watch/drift.ts";
import { PrWatch } from "../src/watch/service.ts";
import { git } from "./board-helpers.ts";
import { cleanups, fixture, work } from "./watch-helpers.ts";

afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const change = (path: string, added = 1, removed = 0): FileChange => ({ path, added, removed });

const ALLOW = ["bun.lock", "*.snap"];

/** Issue #77, slice D3: a round that leaves its PR's footprint is held, measured with git alone. */
describe("drift-gate: whether a fixing round drifted from its PR (#77)", () => {
  test("the numstat of git reads each file with its lines, a binary file as 0 and 0", () => {
    expect(
      parseNumstat("3\t1\tsrc/login.ts\0-\t-\tlogo.png\0" + "0\t12\tsrc/old name.ts\0"),
    ).toEqual([
      change("src/login.ts", 3, 1),
      change("logo.png", 0, 0),
      change("src/old name.ts", 0, 12),
    ]);
    expect(parseNumstat("")).toEqual([]);
  });

  test("a round inside the PR's files, or the files its trigger names, stays in scope", () => {
    expect(
      measureDrift({
        footprint: [change("src/login.ts", 40, 2)],
        round: [change("src/login.ts", 5, 1), change("src/named.ts", 2, 0)],
        named: ["src/named.ts"],
        allow: ALLOW,
      }),
    ).toBeNull();
  });

  test("a file outside the footprint drifts; the allowed ones never count, nested ones by name", () => {
    expect(
      measureDrift({
        footprint: [change("src/login.ts")],
        round: [
          change("src/login.ts"),
          change("src/billing.ts", 3, 3),
          change("bun.lock", 900, 900),
          change("test/__snapshots__/login.test.ts.snap", 50, 0),
        ],
        named: [],
        allow: ALLOW,
      }),
    ).toEqual({ outside: ["src/billing.ts"], churn: 7, limit: 200 });
  });

  test("a rewrite inside the PR's own files drifts past max(200, the footprint's churn)", () => {
    const footprint = [change("src/login.ts", 250, 50)];
    expect([
      measureDrift({ footprint, round: [change("src/login.ts", 200, 100)], named: [], allow: [] }),
      measureDrift({ footprint, round: [change("src/login.ts", 200, 101)], named: [], allow: [] }),
      measureDrift({
        footprint: [change("src/login.ts", 10, 0)],
        round: [change("src/login.ts", 150, 51)],
        named: [],
        allow: [],
      }),
    ]).toEqual([
      null,
      { outside: [], churn: 301, limit: 300 },
      { outside: [], churn: 201, limit: 200 },
    ]);
  });
});

type Fixture = Awaited<ReturnType<typeof fixture>>;

/** A watched card that drift is measured for: nothing outside its PR is allowed. */
const strict = () => fixture({ settings: { driftAllow: [] } });

const service = (f: Fixture) =>
  new PrWatch({ board: f.board, watcher: f.watcher, fixer: f.fixer, traces: {} as never });

/** One round of fixing a review comment, to its end. */
async function round(f: Fixture) {
  await f.fixer.onTrigger(f.trigger({ comments: [work()] }));
  await f.fixer.idle();
  return f.fixer.rounds(f.card.id).at(-1);
}

/** Why a call was refused: its reason, or null when it went through. */
async function refusal(call: Promise<unknown>): Promise<string | null> {
  try {
    await call;
    return null;
  } catch (error) {
    return (error as { reason?: string }).reason ?? String(error);
  }
}

const head = (f: Fixture, ref = "HEAD") => git(f.worktree, "rev-parse", ref);

describe("drift-gate: a round that leaves its PR is held, not pushed (#77)", () => {
  test("a round that changes only the PR's own files is pushed", async () => {
    const f = await strict();
    // The PR already changes fake-1.txt, the file the fake session's commit writes.
    writeFileSync(join(f.worktree, "fake-1.txt"), "the PR's own line\n");
    git(f.worktree, "add", "fake-1.txt");
    git(f.worktree, "commit", "-q", "-m", "the card's work");
    git(f.worktree, "push", "-q", "origin", `HEAD:refs/heads/${f.branch}`);
    const r = await round(f);
    expect([r?.status, r?.drift ?? null, f.commitsAhead()]).toEqual(["pushed", null, "3"]);
  });

  test("a round that adds a file outside the PR is held: nothing is pushed, and the card needs you", async () => {
    const f = await strict();
    const r = await round(f);
    const status = f.watcher.status(f.card.id);
    expect([
      r?.status,
      r?.drift,
      f.gitCalls.some((args) => args[0] === "push"),
      f.commitsAhead(),
      status.status,
      status.reason?.includes("fake-1.txt") ?? false,
      f.board.getCard(f.card.id).column,
    ]).toEqual([
      "held",
      { outside: ["fake-1.txt"], churn: 1, limit: 200 },
      false,
      "1",
      "needs_you",
      true,
      "waiting",
    ]);
  });

  test("a round whose drift cannot be measured is held with the reason, not pushed", async () => {
    const f = await strict();
    git(f.worktree, "update-ref", "-d", "refs/remotes/origin/main");
    const r = await round(f);
    expect([
      r?.status,
      r?.drift ?? null,
      r?.summary?.includes("could not be measured") ?? false,
      f.commitsAhead(),
    ]).toEqual(["held", null, true, "1"]);
  });

  test("push anyway pushes the held commits as they are, and the card is watched again", async () => {
    const f = await strict();
    const r = await round(f);
    const held = r?.status;
    const info = await service(f).resolveHeld(f.card.id, r?.id ?? "", "push");
    expect([
      held,
      info.rounds.at(-1)?.status,
      f.commitsAhead(),
      info.status,
      f.board.getCard(f.card.id).column,
    ]).toEqual(["held", "pushed", "2", "watching", "review"]);
  });

  test("drop puts the branch back where it was pushed, and the card is watched again", async () => {
    const f = await strict();
    const r = await round(f);
    const info = await service(f).resolveHeld(f.card.id, r?.id ?? "", "drop");
    expect([
      info.rounds.at(-1)?.status,
      head(f) === head(f, `origin/${f.branch}`),
      f.commitsAhead(),
      info.status,
    ]).toEqual(["stopped", true, "1", "watching"]);
  });

  test("a branch with new commits since the hold is refused: nothing is pushed or dropped", async () => {
    const f = await strict();
    const r = await round(f);
    git(f.worktree, "commit", "-q", "--allow-empty", "-m", "made after the hold");
    const moved = head(f);
    expect([
      await refusal(service(f).resolveHeld(f.card.id, r?.id ?? "", "push")),
      await refusal(service(f).resolveHeld(f.card.id, r?.id ?? "", "drop")),
      f.commitsAhead(),
      head(f) === moved,
    ]).toEqual(["watch_held_moved", "watch_held_moved", "1", true]);
  });

  test("a round that is not held is refused", async () => {
    const f = await fixture();
    const r = await round(f);
    expect([
      r?.status,
      await refusal(service(f).resolveHeld(f.card.id, r?.id ?? "", "push")),
      await refusal(service(f).resolveHeld(f.card.id, "nope", "drop")),
    ]).toEqual(["pushed", "watch_round_not_held", "watch_round_not_held"]);
  });
});
