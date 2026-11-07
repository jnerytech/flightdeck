import { describe, expect, test } from "bun:test";
import { type FileChange, measureDrift, parseNumstat } from "../src/watch/drift.ts";

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
