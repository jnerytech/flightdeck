import { afterEach, describe, expect, spyOn, test } from "bun:test";
import {
  type AutomationsWiringDeps,
  automationsOptions,
  createBoardWork,
} from "../../src/automations/wiring.ts";
import type { CheckLoopSwitch } from "../../src/board/check-loop.ts";
import { AutoApprover } from "../../src/permissions/auto-approve.ts";
import { SecretScanner } from "../../src/snippets/domain/model.ts";
import { boundedCheckRunner } from "../../src/workflows/check-runner.ts";
import { newBoard } from "../support/board-helpers.ts";
import { tempDir } from "../support/helpers.ts";

/**
 * The automations as main.ts builds them (issue #1593): they share the board, the issues and the
 * automatic approval, search the issues at the config's interval, and leave a card whose PR is
 * watched to the watch's fixer (issue #77).
 */

/** Each dep, as a value told apart by identity. */
function deps(issuePollIntervalMs: number) {
  return {
    db: {},
    board: {},
    issues: {},
    autoApprove: {},
    config: { automations: { issuePollIntervalMs } },
    log: () => {},
    fixer: {},
  } as unknown as AutomationsWiringDeps;
}

describe("automationsOptions", () => {
  test("the watch's fixer decides which cards the automations leave alone", () => {
    const given = deps(1000);
    expect(automationsOptions(given).prWatch).toBe(given.fixer);
  });

  test("the issues are searched at the config's interval", () => {
    expect(automationsOptions(deps(1234)).pollMs).toBe(1234);
    expect(automationsOptions(deps(60_000)).pollMs).toBe(60_000);
  });

  // The database, the board and the issues are required options: a wiring that drops one fails
  // typecheck. The automatic approval and the log are optional ones, so dropping them compiles.
  test("they share the automatic approval and the log, optional options that a dropped wire would leave unset", () => {
    const given = deps(1000);
    const options = automationsOptions(given);
    expect(options.autoApprove).toBe(given.autoApprove);
    expect(options.log).toBe(given.log);
  });
});

describe("createBoardWork: the board's work around its cards, as the daemon builds it (#2094)", () => {
  const cleanups: Array<() => unknown> = [];
  afterEach(async () => {
    for (const fn of cleanups.splice(0).reverse()) await fn();
  });

  function boardWork() {
    const { board, manager, store, runtime } = newBoard({}, 1);
    cleanups.push(() => board.stop());
    const autoApprove = new AutoApprover({
      db: store.db,
      runtime,
      dataDir: tempDir("fd-board-work-"),
      context: () => null,
    });
    const checkLoop = { the: "check loop switch" } as unknown as CheckLoopSwitch;
    const loopWatchers: unknown[] = [];
    const built = createBoardWork({
      store,
      board,
      autoApprove,
      gh: async () => ({ code: 1, stdout: "", stderr: "no gh in tests" }),
      manager,
      costs: { sessions: () => ({}), card: () => null },
      snapshots: { list: () => [] },
      history: { search: () => [] },
      scanner: new SecretScanner(),
      checks: boundedCheckRunner(),
      config: { automations: { issuePollIntervalMs: 60_000 } },
      log: () => {},
      checkLoopOf: (watcher) => {
        loopWatchers.push(watcher);
        return checkLoop;
      },
    });
    const [module] = built.modules;
    cleanups.push(() => module.stop?.());
    return { ...built, module, checkLoop, loopWatchers };
  }

  test("its module serves the board sync, the PR watch with the check loop's switch, the issues and the automations", () => {
    const { module, boardSync, watch, watcher, issues, automations, checkLoop, loopWatchers } =
      boardWork();
    expect([
      loopWatchers.length === 1 && loopWatchers[0] === watcher,
      module.server?.boardsync === boardSync.service,
      module.server?.prWatch?.watch === watch,
      module.server?.prWatch?.checkLoop === checkLoop,
      module.server?.issues === issues,
      module.server?.automations === automations,
    ]).toEqual([true, true, true, true, true, true]);
  });

  test("its stop waits for a tick or an issue search in flight before it stops the watch and the board sync, so the board stops after them (5e36c5cbb)", async () => {
    const { module, automations, watch, boardSync } = boardWork();
    await module.start?.();
    let finish = () => {};
    const inFlight = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const idle = spyOn(automations, "idle").mockImplementation(() => inFlight);
    cleanups.push(() => idle.mockRestore());
    const watchStop = spyOn(watch, "stop");
    const loopStop = spyOn(boardSync.loop, "stop");
    cleanups.push(() => {
      watchStop.mockRestore();
      loopStop.mockRestore();
    });
    let stopped = false;
    const stopping = Promise.resolve(module.stop?.()).then(() => {
      stopped = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    const before = [stopped, watchStop.mock.calls.length, loopStop.mock.calls.length];
    finish();
    await stopping;
    expect([
      idle.mock.calls.length,
      before,
      [stopped, watchStop.mock.calls.length, loopStop.mock.calls.length],
    ]).toEqual([1, [false, 0, 0], [true, 1, 1]]);
  });
});
