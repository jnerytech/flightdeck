import { describe, expect, test } from "bun:test";
import { confirmationHash } from "../../src/board/domain/check-loop-engine.ts";
import { FAIL, ok, PASS, rig } from "../support/check-loop-engine.ts";

describe("check-loop: a turn that passes its checks", () => {
  test("idle then the result: the slot is held, the checks pass, the card moves on and the slot goes back once", async () => {
    const r = rig();
    const decisions = [r.engine.onIdle("c"), r.engine.onTurnResult("c", ok)];
    await r.checksDone();
    expect([decisions, r.log, r.records.at(-1)?.reason]).toEqual([
      ["hold", "hold"],
      ["place", "release"],
      "passed",
    ]);
  });

  test("the result then idle ends the same way", async () => {
    const r = rig();
    const decisions = [r.engine.onTurnResult("c", ok), r.engine.onIdle("c")];
    await r.checksDone();
    expect([decisions, r.log]).toEqual([
      ["hold", "hold"],
      ["place", "release"],
    ]);
  });

  test("a card with the switch off, or a workflow or fixing run, is not the loop's", async () => {
    const off = rig({ card: { on: false } });
    const workflow = rig({ card: { plainRun: false } });
    expect([
      off.engine.onIdle("c"),
      off.engine.onTurnResult("c", ok),
      workflow.engine.onIdle("c"),
      workflow.engine.onTurnResult("c", ok),
      off.log,
    ]).toEqual(["release", "place", "release", "place", []]);
  });
});

describe("check-loop: rounds", () => {
  test("a failing check sends a round into the same session and keeps the slot; the next turn passes", async () => {
    const r = rig({ outcomes: [FAIL, PASS] });
    r.engine.onIdle("c");
    r.engine.onTurnResult("c", ok);
    await r.checksDone();
    const afterRound = [...r.log];
    // The round's turn: busy, then its result and idle again.
    const next = [r.engine.onTurnResult("c", ok), r.engine.onIdle("c")];
    await r.checksDone();
    expect([
      afterRound,
      next,
      r.log,
      r.records.map((x) => [x.n, x.status, x.reason ?? null]),
    ]).toEqual([
      ["send"],
      ["hold", "hold"],
      ["send", "place", "release"],
      [
        [1, "sent", null],
        [2, "ended", "passed"],
      ],
    ]);
  });

  test("after N rounds that still fail, the card moves on with rounds_spent; the card's own cap lowers N", async () => {
    const r = rig({ card: { rounds: 2 }, outcomes: [FAIL, FAIL, FAIL] });
    for (let i = 0; i < 3; i++) {
      r.engine.onTurnResult("c", ok);
      r.engine.onIdle("c");
      await r.checksDone();
    }
    expect([r.sent.length, r.log.slice(-2), r.records.at(-1)?.reason]).toEqual([
      2,
      ["place", "release"],
      "rounds_spent",
    ]);
  });

  test("a refused command stops at once, with no round sent", async () => {
    const r = rig({
      outcomes: [{ kind: "refused", command: "rm -rf /", refusal: "outside_worktree" }],
    });
    r.engine.onTurnResult("c", ok);
    await r.checksDone();
    expect([r.sent, r.log, r.records.at(-1)?.reason]).toEqual([
      [],
      ["place", "release"],
      "check_refused",
    ]);
  });
});

describe("check-loop: the gate before every round (#1361, tracked)", () => {
  test("switched on in bypassPermissions, then a session in default with no confirmation: no round, check_loop_confirm", async () => {
    const r = rig({ mode: "bypassPermissions", outcomes: [FAIL] });
    r.setMode("default");
    r.engine.onTurnResult("c", ok);
    await r.checksDone();
    expect([r.sent, r.log, r.records.at(-1)?.reason]).toEqual([
      [],
      ["place", "release"],
      "check_loop_confirm",
    ]);
  });

  test("a confirmation whose checks, checkEnv or mode changed no longer counts; a matching one does", async () => {
    const stale = rig({
      mode: "default",
      card: { confirmedHash: confirmationHash(["old"], [], "default") },
      outcomes: [FAIL],
    });
    stale.engine.onTurnResult("c", ok);
    await stale.checksDone();
    const fresh = rig({
      mode: "acceptEdits",
      card: { confirmedHash: confirmationHash(["bun test"], [], "acceptEdits") },
      outcomes: [FAIL],
    });
    fresh.engine.onTurnResult("c", ok);
    await fresh.checksDone();
    expect([stale.records.at(-1)?.reason, fresh.sent.length]).toEqual(["check_loop_confirm", 1]);
    // Each of the other two things the hash covers, changed alone: no round, the loop ends asking again.
    const otherEnv = rig({
      mode: "default",
      checkEnv: ["JAVA_HOME"],
      card: { confirmedHash: confirmationHash(["bun test"], [], "default") },
      outcomes: [FAIL],
    });
    otherEnv.engine.onTurnResult("c", ok);
    await otherEnv.checksDone();
    const otherMode = rig({
      mode: "default",
      card: { confirmedHash: confirmationHash(["bun test"], [], "acceptEdits") },
      outcomes: [FAIL],
    });
    otherMode.engine.onTurnResult("c", ok);
    await otherMode.checksDone();
    expect([
      otherEnv.records.at(-1)?.reason,
      otherEnv.sent.length,
      otherMode.records.at(-1)?.reason,
      otherMode.sent.length,
    ]).toEqual(["check_loop_confirm", 0, "check_loop_confirm", 0]);
  });

  test("the checks run in the card's worktree, for the project's timeout, with the project's extra environment", async () => {
    const r = rig({ checkEnv: ["JAVA_HOME"], outcomes: [PASS] });
    r.engine.onTurnResult("c", ok);
    await r.checksDone();
    expect(r.inputs).toEqual([
      { checks: ["bun test"], worktree: "/w/tree", timeoutMin: 10, envNames: ["JAVA_HOME"] },
    ]);
  });

  test("an untrusted project, plan mode, and each limit stop the loop with their own reason", async () => {
    const reasons: Array<string | undefined> = [];
    for (const over of [
      { trusted: false },
      { mode: "plan" as const },
      { limit: "budget" as const },
      { limit: "quota" as const },
      { limit: "memory" as const },
    ]) {
      const r = rig({ ...over, outcomes: [FAIL] });
      r.engine.onTurnResult("c", ok);
      await r.checksDone();
      reasons.push(r.records.at(-1)?.reason);
    }
    expect(reasons).toEqual([
      "check_loop_untrusted",
      "check_loop_mode",
      "budget",
      "quota",
      "memory",
    ]);
  });
});

describe("check-loop: what ends a loop early", () => {
  test("the person's turn aborts the running check, sends nothing, keeps the slot with the session, and starts the count again", async () => {
    const r = rig({ outcomes: [FAIL, FAIL, FAIL] });
    r.engine.onTurnResult("c", ok);
    await r.checksDone();
    const open = r.hold();
    r.engine.onTurnResult("c", ok);
    r.engine.onPersonTurn("c");
    open();
    await r.checksDone();
    const aborted = r.signals.at(-1)?.aborted;
    r.engine.onTurnResult("c", ok);
    await r.checksDone();
    expect([aborted, r.sent.length, r.log.includes("release"), r.records.at(-1)?.n]).toEqual([
      true,
      2,
      false,
      1,
    ]);
  });

  test("a session that dies, or a stop by the person, releases the slot once and says why", async () => {
    const gone = rig();
    gone.engine.onIdle("c");
    gone.engine.onSessionGone("c");
    const stopped = rig({ outcomes: [FAIL] });
    stopped.engine.onIdle("c");
    stopped.engine.onTurnResult("c", ok);
    void stopped.engine.onStop("c");
    await stopped.checksDone();
    expect([
      gone.log,
      gone.records.at(-1)?.reason,
      stopped.log,
      stopped.records.at(-1)?.reason,
      stopped.signals.at(-1)?.aborted,
    ]).toEqual([["release"], "session_ended", ["release"], "stopped_by_you", true]);
  });

  test("a held idle with no result in 30 s lets the slot go with no_result; an error or interrupted turn lets it go at once", async () => {
    const r = rig();
    r.engine.onIdle("c");
    const wait = r.timers[0];
    wait?.fn();
    const failed = rig();
    failed.engine.onIdle("c");
    const decision = failed.engine.onTurnResult("c", { isError: true, interrupted: false });
    expect([
      wait?.ms,
      r.log,
      r.records.at(-1)?.reason,
      decision,
      failed.log,
      failed.timers[0]?.cleared,
    ]).toEqual([30_000, ["release"], "no_result", "place", ["release"], true]);
  });
});
