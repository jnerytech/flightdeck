import { describe, expect, test } from "bun:test";
import { planRelated } from "../lib/test-related.ts";

const HEAD = "f".repeat(40);
const ORIGIN = "0".repeat(40);
const LOCAL = "1".repeat(40);

describe("related-auto-base", () => {
  test("without --base, test:related compares with the audit base: the merge-base with origin/main first", () => {
    const calls: string[] = [];
    const plan = planRelated({
      platform: "linux",
      git: (args) => {
        const key = args.join(" ");
        calls.push(key);
        if (key === "rev-parse HEAD") return `${HEAD}\n`;
        if (key === "merge-base HEAD origin/main") return `${ORIGIN}\n`;
        if (key === "merge-base HEAD main") return `${LOCAL}\n`;
        if (args[0] === "diff") return "";
        if (args[0] === "ls-files") return "";
        return null;
      },
      readFile: () => "",
    });
    expect(calls).toContain(`diff --name-only ${ORIGIN}...HEAD`);
    expect(plan.output).toContain(`since ${ORIGIN.slice(0, 7)}`);
  });
});
