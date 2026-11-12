import { describe, expect, test } from "bun:test";
import { type AutomationsWiringDeps, automationsOptions } from "../../src/automations/wiring.ts";

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
    expect(automationsOptions(given).prWatch === given.fixer).toBe(true);
  });

  test("the issues are searched at the config's interval", () => {
    expect(automationsOptions(deps(1234)).pollMs).toBe(1234);
    expect(automationsOptions(deps(60_000)).pollMs).toBe(60_000);
  });

  test("they share the database, board, issues, automatic approval and log", () => {
    const given = deps(1000);
    const options = automationsOptions(given);
    expect(options.db === given.db).toBe(true);
    expect(options.board === given.board).toBe(true);
    expect(options.issues === given.issues).toBe(true);
    expect(options.autoApprove === given.autoApprove).toBe(true);
    expect(options.log === given.log).toBe(true);
  });
});
