import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FILE_LIMIT_S,
  parseJunit,
  type SlowAllowlist,
  slowVerdict,
  TEST_LIMIT_S,
} from "../lib/slow-tests.ts";

/** A JUnit report as bun writes it: a suite per file, nested suites per describe. */
const junit = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<testsuites name="bun test" tests="4" time="70.5">',
  '  <testsuite name="apps/a.test.ts" file="apps/a.test.ts" tests="3" time="61.25">',
  '    <testsuite name="board &amp; cards" file="apps/a.test.ts" line="3" tests="2" time="7">',
  '      <testcase name="moves a card" classname="board &amp; cards" time="6.5" file="apps/a.test.ts" line="4" />',
  '      <testcase name="says &quot;no&quot; &lt;fast&gt;" classname="board &amp; cards" time="0.5" file="apps/a.test.ts" line="9">',
  '        <failure message="x" />',
  "      </testcase>",
  "    </testsuite>",
  '    <testcase name="at the top" classname="" time="5" file="apps/a.test.ts" line="20" />',
  "  </testsuite>",
  '  <testsuite name="apps/b.test.ts" file="apps/b.test.ts" tests="1" time="2">',
  '    <testcase name="quick" classname="" time="0.01" file="apps/b.test.ts" line="1" />',
  "  </testsuite>",
  "</testsuites>",
].join("\n");

describe("slow-tests (#1003)", () => {
  test("the limits are 5 s per test and 60 s per test file", () => {
    expect([TEST_LIMIT_S, FILE_LIMIT_S]).toEqual([5, 60]);
  });

  test("a JUnit report gives each file's time and each test's time, named file > describes > test", () => {
    expect(parseJunit(junit)).toEqual({
      files: [
        { file: "apps/a.test.ts", seconds: 61.25 },
        { file: "apps/b.test.ts", seconds: 2 },
      ],
      tests: [
        { id: "apps/a.test.ts > board & cards > moves a card", seconds: 6.5 },
        { id: 'apps/a.test.ts > board & cards > says "no" <fast>', seconds: 0.5 },
        { id: "apps/a.test.ts > at the top", seconds: 5 },
        { id: "apps/b.test.ts > quick", seconds: 0.01 },
      ],
    });
    expect(parseJunit("not xml")).toEqual({ files: [], tests: [] });
  });

  test("a test over 5 s or a file over 60 s fails unless the allowlist names it; 5 s itself passes", () => {
    const none: SlowAllowlist = { tests: {}, files: {} };
    expect(slowVerdict(parseJunit(junit), none)).toEqual({
      problems: [
        "apps/a.test.ts: the file took 61.3 s, over the 60 s limit",
        "apps/a.test.ts > board & cards > moves a card: 6.5 s, over the 5 s limit",
      ],
      allowed: [],
    });
    const listed: SlowAllowlist = {
      tests: { "apps/a.test.ts > board & cards > moves a card": "#1009 deletes it" },
      files: { "apps/a.test.ts": "#1009 cuts it" },
    };
    expect(slowVerdict(parseJunit(junit), listed)).toEqual({
      problems: [],
      allowed: [
        "apps/a.test.ts: 61.3 s (#1009 cuts it)",
        "apps/a.test.ts > board & cards > moves a card: 6.5 s (#1009 deletes it)",
      ],
    });
  });

  test("every allowlist entry names a test file and says why it is there", () => {
    const allow = JSON.parse(
      readFileSync(join(import.meta.dir, "../..", "slow-tests-allowlist.json"), "utf8"),
    ) as SlowAllowlist;
    const entries = [...Object.entries(allow.tests), ...Object.entries(allow.files)];
    expect(entries.length).toBeGreaterThan(0);
    for (const [id, why] of entries) {
      expect(`${id}: ${/^\S+\.test\.tsx?( > .+)?$/.test(id)} ${/#\d+/.test(why)}`).toBe(
        `${id}: true true`,
      );
    }
  });
});
