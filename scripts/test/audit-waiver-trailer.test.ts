import { describe, expect, test } from "bun:test";
import { parseCommits, runAudit } from "../lib/tdd-audit.ts";

const HASH_A = "a".repeat(40);
const HASH_B = "b".repeat(40);
const FORMAT = "--format=%H%x1f%s%x1f%(trailers:key=TDD-Waiver,valueonly,separator=%x20)";

describe("audit-waiver-trailer", () => {
  test("parseCommits reads the TDD-Waiver trailer as the commit's waiver", () => {
    const [waived, plain] = parseCommits(
      `${HASH_A}\x1ffix(a): x\x1fmade in the rc merge\n${HASH_B}\x1ffeat(b): y\x1f`,
    );
    expect(waived?.waiver).toBe("made in the rc merge");
    expect(plain?.waiver).toBeUndefined();
  });

  test("a feat or fix with a TDD-Waiver trailer is waived and listed, without a JSON entry", () => {
    const calls: string[] = [];
    const result = runAudit({
      since: "v0.36.2",
      readFile: () => "",
      git: (args) => {
        calls.push(args.join(" "));
        if (args[0] === "rev-parse") return "abc";
        if (args[0] === "log" && args.includes(FORMAT)) {
          return [
            `${HASH_A}\x1ffix(a): x\x1fmade in the rc merge`,
            `${HASH_B}\x1ffeat(b): y\x1f`,
          ].join("\n");
        }
        return "";
      },
    });
    expect(calls).toContain(`log --reverse ${FORMAT} v0.36.2..HEAD`);
    expect(result.code).toBe(1);
    expect(result.output.split("\n")).toEqual([
      "TDD AUDIT FAIL: 1 violação(ões)",
      `  ${HASH_B}  b  feat sem commit test(b) anterior`,
      "1 waived:",
      `  waived  ${HASH_A}  a  trailer: made in the rc merge`,
    ]);
  });
});
