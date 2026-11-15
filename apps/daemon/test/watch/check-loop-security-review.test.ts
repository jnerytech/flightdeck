import { describe, expect, test } from "bun:test";
import { confirmationHash, roundsCap } from "../../src/board/domain/check-loop-engine.ts";
import { FAIL, ok, PASS, rig } from "../support/check-loop-engine.ts";

describe("check-loop: the security review's cases", () => {
  test("the gate comes before the checks: an untrusted project, a stale confirmation or plan runs nothing", async () => {
    const calls: number[] = [];
    for (const over of [
      { trusted: false },
      { mode: "default" as const },
      { mode: "plan" as const },
    ]) {
      const r = rig({ ...over, outcomes: [FAIL] });
      r.engine.onTurnResult("c", ok);
      await r.checksDone();
      calls.push(r.signals.length);
    }
    expect(calls).toEqual([0, 0, 0]);
  });

  test("a second result while the checks run aborts the first run: one round, not two", async () => {
    const r = rig({ outcomes: [FAIL, FAIL] });
    const open = r.hold();
    r.engine.onTurnResult("c", ok);
    r.engine.onTurnResult("c", ok);
    open();
    await r.checksDone();
    await Promise.resolve();
    expect([r.signals[0]?.aborted, r.sent.length]).toEqual([true, 1]);
  });

  test("checks that throw end the loop with check_error, and the slot goes back", async () => {
    const r = rig();
    const failing = r.engineWith({
      runChecks: async () => {
        throw new Error("spawn failed");
      },
    });
    failing.onIdle("c");
    failing.onTurnResult("c", ok);
    // Before the fix the error escapes the engine; the assertion below says what it should do.
    await failing.idle("c").catch(() => {});
    await Promise.resolve();
    expect([r.log, r.records.at(-1)?.reason]).toEqual([["place", "release"], "check_error"]);
  });

  test("even when recording the end throws, the slot goes back", async () => {
    const r = rig();
    const failing = r.engineWith({
      runChecks: async () => {
        throw new Error("spawn failed");
      },
      record: () => {
        throw new Error("disk full");
      },
    });
    failing.onIdle("c");
    failing.onTurnResult("c", ok);
    await failing.idle("c").catch(() => {});
    await Promise.resolve();
    expect(r.log.filter((entry) => entry === "release")).toEqual(["release"]);
  });

  test("a placement that throws still releases the slot, once", async () => {
    const r = rig();
    const engine = r.engineWith({
      place: () => {
        throw new Error("board write failed");
      },
    });
    engine.onIdle("c");
    engine.onTurnResult("c", ok);
    await engine.idle("c").catch(() => {});
    await Promise.resolve();
    expect(r.log.filter((entry) => entry === "release")).toEqual(["release"]);
  });

  test("a record that throws on a stop, a dead session or the result timer still closes the loop and releases once", () => {
    const releases: number[] = [];
    for (const end of ["stop", "gone", "timer"] as const) {
      const r = rig();
      const engine = r.engineWith({
        record: () => {
          throw new Error("disk full");
        },
      });
      engine.onIdle("c");
      try {
        if (end === "stop") void engine.onStop("c");
        if (end === "gone") engine.onSessionGone("c");
        if (end === "timer") r.timers[0]?.fn();
      } catch {
        // Before the fix the error escapes; the count below says what must happen.
      }
      // A second way out finds no loop: nothing is released twice.
      try {
        void engine.onStop("c");
      } catch {
        // As above.
      }
      releases.push(r.log.filter((entry) => entry === "release").length);
    }
    expect(releases).toEqual([1, 1, 1]);
  });

  test("a switch turned off mid-loop: the engine releases the slot it held, the board only places", async () => {
    const r = rig({ outcomes: [FAIL] });
    r.engine.onTurnResult("c", ok);
    await r.checksDone();
    r.engine.onIdle("c");
    r.card.on = false;
    const decision = r.engine.onTurnResult("c", ok);
    expect([decision, r.log]).toEqual(["place", ["send", "release"]]);
  });

  test("a replaced run is not counted: the next record's n is the run that was used", async () => {
    const r = rig({ outcomes: [PASS, FAIL] });
    const open = r.hold();
    r.engine.onTurnResult("c", ok);
    r.engine.onTurnResult("c", ok);
    open();
    await r.checksDone();
    await Promise.resolve();
    expect(r.records.map((x) => x.n)).toEqual([1]);
  });

  test("a turn that errs or is interrupted closes a loop with its own end line", async () => {
    const reasons: Array<string | undefined> = [];
    for (const turn of [
      { isError: true, interrupted: false },
      { isError: false, interrupted: true },
    ]) {
      const r = rig();
      r.engine.onIdle("c");
      r.engine.onTurnResult("c", turn);
      reasons.push(r.records.at(-1)?.reason);
    }
    expect(reasons).toEqual(["turn_error", "person_turn"]);
  });

  test("a switch turned off while the checks run sends no round: the gate reads the card again", async () => {
    const r = rig({ outcomes: [FAIL] });
    const open = r.hold();
    r.engine.onTurnResult("c", ok);
    r.card.on = false;
    open();
    await r.checksDone();
    await Promise.resolve();
    expect([r.sent.length, r.records.at(-1)?.reason, r.log]).toEqual([
      0,
      "stopped_by_you",
      ["place", "release"],
    ]);
  });

  test("a slot the board released at idle is never the loop's: a switch turned on before the result starts nothing", async () => {
    const r = rig({ card: { on: false } });
    const idle = r.engine.onIdle("c");
    r.card.on = true;
    const result = r.engine.onTurnResult("c", ok);
    await r.checksDone();
    // The next turn: busy again, so the slot is the run's once more and the loop may hold it.
    r.engine.onBusy("c");
    const next = [r.engine.onTurnResult("c", ok), r.engine.onIdle("c")];
    await r.checksDone();
    expect([idle, result, r.signals.length, next, r.log]).toEqual([
      "release",
      "place",
      1,
      ["hold", "hold"],
      ["place", "release"],
    ]);
  });

  test("settings changed while the checks run are read before the round: a confirmation of the old checks no longer counts", async () => {
    const r = rig({
      mode: "default",
      card: { confirmedHash: confirmationHash(["bun test"], [], "default") },
      outcomes: [FAIL],
    });
    const open = r.hold();
    r.engine.onTurnResult("c", ok);
    r.settings.checks = ["bun test", "bun run lint"];
    open();
    await r.checksDone();
    await Promise.resolve();
    expect([r.sent.length, r.records.at(-1)?.reason]).toEqual([0, "check_loop_confirm"]);
  });

  test("an idle that comes after the round was sent does not end it: the session going busy clears the wait", async () => {
    const r = rig({ outcomes: [FAIL, PASS] });
    r.engine.onTurnResult("c", ok);
    await r.checksDone();
    r.engine.onIdle("c");
    const armed = r.timers.at(-1);
    r.engine.onBusy("c");
    const clearedByBusy = armed?.cleared;
    r.engine.onTurnResult("c", ok);
    r.engine.onIdle("c");
    await r.checksDone();
    expect([clearedByBusy, r.log, r.records.at(-1)?.reason]).toEqual([
      true,
      ["send", "place", "release"],
      "passed",
    ]);
  });

  test("an idle after the loop already ended neither holds nor releases the slot again", async () => {
    const r = rig();
    r.engine.onTurnResult("c", ok);
    await r.checksDone();
    const late = r.engine.onIdle("c");
    expect([late, r.log, r.timers.length]).toEqual(["released", ["place", "release"], 0]);
  });

  test("a card gone while its checks start is placed and released", async () => {
    const r = rig({ vanishAfter: 1 });
    r.engine.onTurnResult("c", ok);
    await r.checksDone();
    expect(r.log).toEqual(["place", "release"]);
  });

  test("the card's own cap changed during the checks counts before the round", async () => {
    const r = rig({ outcomes: [FAIL, FAIL] });
    r.engine.onTurnResult("c", ok);
    await r.checksDone();
    const open = r.hold();
    r.engine.onTurnResult("c", ok);
    r.card.rounds = 1;
    open();
    await r.checksDone();
    await Promise.resolve();
    expect([r.sent.length, r.records.at(-1)?.reason]).toEqual([1, "rounds_spent"]);
  });

  test("a round that never starts a turn is not waited on forever: the watchdog ends it, busy clears it", async () => {
    const stuck = rig({ outcomes: [FAIL] });
    stuck.engine.onTurnResult("c", ok);
    await stuck.checksDone();
    const watchdog = stuck.timers.at(-1);
    watchdog?.fn();
    const started = rig({ outcomes: [FAIL] });
    started.engine.onTurnResult("c", ok);
    await started.checksDone();
    started.engine.onBusy("c");
    expect([
      watchdog !== undefined,
      stuck.log,
      stuck.records.at(-1)?.reason,
      started.timers.at(-1)?.cleared,
    ]).toEqual([true, ["send", "release"], "no_result", true]);
  });

  test("a result that passed before idle is not waited on again: the later idle releases at once", () => {
    const failed = rig();
    const placed = failed.engine.onTurnResult("c", { isError: true, interrupted: false });
    const idle = failed.engine.onIdle("c");
    const switched = rig({ card: { on: false } });
    switched.engine.onTurnResult("c", ok);
    switched.card.on = true;
    const later = switched.engine.onIdle("c");
    expect([placed, idle, failed.timers.length, later, switched.timers.length]).toEqual([
      "place",
      "release",
      0,
      "release",
      0,
    ]);
  });

  test("a release that throws never escapes: not from the checks' end, not from a timer", async () => {
    const r = rig();
    const engine = r.engineWith({
      release: () => {
        throw new Error("slot table locked");
      },
    });
    engine.onTurnResult("c", ok);
    const ended = await engine.idle("c").then(
      () => "settled",
      () => "rejected",
    );
    const other = r.engineWith({
      release: () => {
        throw new Error("slot table locked");
      },
    });
    other.onIdle("c");
    let fromTimer = "quiet";
    try {
      r.timers.at(-1)?.fn();
    } catch {
      fromTimer = "threw";
    }
    expect([ended, fromTimer]).toEqual(["settled", "quiet"]);
  });

  test("onSessionGone says whether the loop had the slot, so the board releases it only when not", () => {
    const held = rig();
    held.engine.onIdle("c");
    const none = rig({ card: { on: false } });
    expect([held.engine.onSessionGone("c"), none.engine.onSessionGone("c")]).toEqual([true, false]);
  });

  test("the round's own echo is not the person's input; any other user message is", async () => {
    const r = rig({ outcomes: [FAIL, FAIL] });
    r.duringSend(() => {
      r.engine.onBusy("c");
      r.engine.onUserMessage("c", r.sent.at(-1) ?? "");
    });
    r.engine.onTurnResult("c", ok);
    await r.checksDone();
    const afterEcho = r.records.at(-1)?.status;
    r.engine.onUserMessage("c", "outra coisa");
    expect([afterEcho, r.records.at(-1)?.reason]).toEqual(["sent", "person_turn"]);
  });

  test("an outside message that comes before the queued round's echo is the person's, not the echo", async () => {
    const r = rig({ outcomes: [FAIL] });
    r.engine.onTurnResult("c", ok);
    await r.checksDone();
    // The round waits behind a turn; the person's message reaches the session first.
    r.engine.onUserMessage("c", "deixa que eu faço");
    expect(r.records.at(-1)?.reason).toBe("person_turn");
  });

  test("a stop waits for every check still exiting on the card: one of a loop already ended, one replaced", async () => {
    const r = rig({ outcomes: [FAIL, FAIL] });
    const open = r.hold();
    r.engine.onTurnResult("c", ok);
    // Replaced while running, then the loop ends by the person's turn: both checks are still out.
    r.engine.onTurnResult("c", ok);
    r.engine.onPersonTurn("c");
    let stopped = false;
    const stopping = r.engine.onStop("c").then(() => {
      stopped = true;
    });
    await Promise.resolve();
    const early = stopped;
    open();
    await stopping;
    expect([r.signals.length, early, stopped]).toEqual([2, false, true]);
  });

  test("a stop on a card with no loop and no check running settles at once and touches nothing", async () => {
    const r = rig();
    let stopped = false;
    const stopping = r.engine.onStop("c").then(() => {
      stopped = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    const early = stopped;
    await stopping;
    expect([early, r.signals.length, r.log, r.records.length]).toEqual([true, 0, [], 0]);
  });

  test("a notify that throws when the checks start leaves the loop running, and it ends normally", async () => {
    const r = rig();
    const engine = r.engineWith({
      notify: () => {
        throw new Error("card gone");
      },
    });
    let thrown = "none";
    try {
      engine.onTurnResult("c", ok);
    } catch (error) {
      thrown = (error as Error).message;
    }
    await engine.idle("c");
    expect([thrown, r.log, r.records.at(-1)?.reason]).toEqual([
      "none",
      ["place", "release"],
      "passed",
    ]);
  });

  test("the rounds cap is the card's own when lower, else the project's", () => {
    expect([roundsCap(2, 3), roundsCap(null, 3), roundsCap(5, 3)]).toEqual([2, 3, 3]);
  });

  test("the watchdog is armed before the send, so the busy the send itself causes clears it", async () => {
    const r = rig({ outcomes: [FAIL] });
    r.duringSend(() => r.engine.onBusy("c"));
    r.engine.onTurnResult("c", ok);
    await r.checksDone();
    expect(r.timers.at(-1)?.cleared).toBe(true);
  });
});
