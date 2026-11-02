import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { overBaseline } from "../lib/layout-ratchet.ts";
import { reasonlessRefusals, refusalCounts } from "../lib/refusal-ratchet.ts";

const ROOT = resolve(import.meta.dir, "../..");
const BASELINE = resolve(ROOT, "refusal-baseline.json");

describe("refusal-ratchet: the daemon's refusals that carry no reason only go down", () => {
  test("a direct FlightdeckError counts unless it has a reason (the third argument)", () => {
    const source = `
      throw new FlightdeckError("bad_request", "x");
      throw new FlightdeckError("bad_request", \`a \${(1 + 2)} b, c\`);
      throw new FlightdeckError("not_found", "x", "thing_missing", { id });
      throw new FlightdeckError(
        "invalid_state",
        message(a, b),
        "reason_here",
      );
    `;
    expect(reasonlessRefusals(source)).toBe(2);
  });

  test("source cut off inside a call or a template still counts, and ends", () => {
    expect(reasonlessRefusals('throw new FlightdeckError("bad_request", "x"')).toBe(1);
    expect(reasonlessRefusals('throw new FlightdeckError("bad_request", `a ${ { b')).toBe(1);
  });

  test("a local helper that builds the error without a reason counts at every call, not at its definition", () => {
    const source = `
      const bad = (message: string) => new FlightdeckError("bad_request", message);
      const refuse = (message: string, reason: string) =>
        new FlightdeckError("invalid_state", message, reason);
      function one() { throw bad("a"); }
      function two() { throw bad(\`b \${x}\`); }
      function three() { throw refuse("c", "why"); }
      const word = abad("d");
    `;
    expect(reasonlessRefusals(source)).toBe(2);
  });

  test("comments and strings that only look like refusals are skipped", () => {
    const source = `
      // throw new FlightdeckError("bad_request", "x");
      /* new FlightdeckError("bad_request", "y") */
      const text = 'new FlightdeckError("bad_request", "z")';
    `;
    expect(reasonlessRefusals(source)).toBe(0);
  });

  test("no daemon source has more reasonless refusals than the baseline allows", () => {
    const baseline = existsSync(BASELINE)
      ? (JSON.parse(readFileSync(BASELINE, "utf8")) as Record<string, number>)
      : {};
    expect(overBaseline(refusalCounts(resolve(ROOT, "apps/daemon/src"), ROOT), baseline)).toEqual(
      [],
    );
  });
});
