import { describe, expect, test } from "bun:test";
import { ciVerdict, pushTrigger, runHandoff, stampProblem, steps } from "../lib/handoff.ts";

const HEAD = "0123456789abcdef0123456789abcdef01234567";
const runs = (...list: { status: string; conclusion: string | null }[]) => JSON.stringify(list);

describe("handoff-ci", () => {
  test("a base goes to the audit and to test:related, for a branch made from an rc", () => {
    expect(Object.fromEntries(steps("origin/rc/0364"))).toEqual({
      typecheck: ["bun", "run", "typecheck"],
      lint: ["bun", "run", "lint"],
      audit: ["bun", "run", "tdd:audit", "--", "--since", "origin/rc/0364"],
      related: ["bun", "run", "test:related", "--", "--fast", "--base", "origin/rc/0364"],
    });
  });

  test("only a ci.yml that runs on a push to any branch counts", () => {
    expect(pushTrigger('on:\n  push:\n    branches: ["**"]\n  pull_request:\n')).toBe(true);
    expect(pushTrigger("on:\n  push:\n    branches: [main]\n  pull_request:\n")).toBe(false);
    expect(pushTrigger("on: [pull_request]\n")).toBe(false);
    expect(pushTrigger(null)).toBe(false);
    expect(pushTrigger("on: {{ not yaml")).toBe(false);
  });

  test("the CI state of HEAD: green, pending, failed, none or unknown", () => {
    expect(
      ciVerdict(
        runs(
          { status: "completed", conclusion: "failure" },
          { status: "completed", conclusion: "success" },
        ),
      ),
    ).toBe("0");
    expect(ciVerdict(runs({ status: "in_progress", conclusion: null }))).toBe("pending");
    expect(ciVerdict(runs({ status: "completed", conclusion: "failure" }))).toBe("failed");
    expect(ciVerdict(runs({ status: "completed", conclusion: "cancelled" }))).toBe("failed");
    expect(ciVerdict("[]")).toBe("none");
    expect(ciVerdict(null)).toBe("unknown");
    expect(ciVerdict("gh: not json")).toBe("unknown");
  });

  test("the CI state goes into the stamp, and only a green CI lets the hand-off pass", async () => {
    const base = { run: async () => 0, branch: "fix-x", head: HEAD, now: "t" };
    const green = await runHandoff({ ...base, ci: async () => "0" });
    expect(green).toEqual({
      code: 0,
      stamp: `HANDOFF fix-x ${HEAD} typecheck=0 lint=0 audit=0 related=0 ci=0 t`,
    });
    expect(stampProblem(green.stamp, HEAD)).toBeNull();
    const pending = await runHandoff({ ...base, ci: async () => "pending" });
    expect(pending.code).toBe(1);
    expect(stampProblem(pending.stamp, HEAD)).toBe("failed: ci=pending");
    const skipped = await runHandoff({ ...base, ci: async () => "skip" });
    expect(stampProblem(skipped.stamp, HEAD)).toBe("failed: ci=skip");
  });
});
