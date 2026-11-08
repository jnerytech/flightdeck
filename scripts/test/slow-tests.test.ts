import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FILE_LIMIT_S,
  missingReport,
  parseJunit,
  readAllowlist,
  reportPath,
  type SlowAllowlist,
  slowReport,
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

  test("#1022 review: a report bun 1.4.4 really wrote parses, odd names and all", () => {
    // Written by `bun test --reporter=junit` on a file with these test names (fixture).
    const real = readFileSync(join(import.meta.dir, "fixtures/slow-tests-junit.xml"), "utf8");
    expect(parseJunit(real).tests.map((t) => t.id)).toEqual([
      `names.test.ts > odd => names > it's a <tag> & "quote"`,
      "names.test.ts > odd => names > ação não é 🚀",
      "names.test.ts > top level",
    ]);
    expect(parseJunit(real).files).toEqual([{ file: "names.test.ts", seconds: 0.00320771 }]);
  });

  test("#1022 review: numeric entities are read, an unknown one stays as written, and a Windows path uses /", () => {
    const xml = [
      '<testsuite name="apps\\c.test.ts" file="apps\\c.test.ts" time="1">',
      '  <testcase name="it&#39;s &#x1F680; &bogus;" time="0.1" />',
      "</testsuite>",
    ].join("\n");
    expect(parseJunit(xml)).toEqual({
      files: [{ file: "apps/c.test.ts", seconds: 1 }],
      tests: [{ id: "apps/c.test.ts > it's 🚀 &bogus;", seconds: 0.1 }],
    });
  });

  test("#1022 review: the report lists the slowest tests and names runner noise on a fail, and warns on stale entries", () => {
    const times = parseJunit(junit);
    const allow: SlowAllowlist = {
      tests: {
        "apps/a.test.ts > at the top": "#1 cut",
        "apps/a.test.ts > gone": "#2 deleted",
        "apps/z.test.ts > elsewhere": "#3 not in this run",
      },
      files: { "apps/b.test.ts": "#4 cut" },
    };
    const report = slowReport(times, allow);
    expect(report.code).toBe(1);
    expect(report.lines).toEqual([
      "slow-tests: stale allowlist entry apps/b.test.ts: 2.0 s now, under the 60 s limit",
      "slow-tests: stale allowlist entry apps/a.test.ts > at the top: 5.0 s now, under the 5 s limit",
      "slow-tests: stale allowlist entry apps/a.test.ts > gone: its file ran without it",
      "slow-tests: 2 too slow (#1003):",
      "  - apps/a.test.ts: the file took 61.3 s, over the 60 s limit",
      "  - apps/a.test.ts > board & cards > moves a card: 6.5 s, over the 5 s limit",
      "The slowest tests of this run:",
      "  6.5 s  apps/a.test.ts > board & cards > moves a card",
      "  5.0 s  apps/a.test.ts > at the top",
      '  0.5 s  apps/a.test.ts > board & cards > says "no" <fast>',
      "  0.0 s  apps/b.test.ts > quick",
      "Make it faster, or delete it when a faster test checks the same thing (docs/TDD.md). A test fd-qa is still cutting goes in slow-tests-allowlist.json, with its issue. Within 10% of a limit it may be runner noise: rerun the job once before cutting it.",
    ]);
    const fine = slowReport(
      parseJunit('<testsuite name="x.test.ts" time="1"><testcase name="t" time="1" /></testsuite>'),
      {
        tests: {},
        files: {},
      },
    );
    expect(fine).toEqual({ code: 0, lines: ["slow-tests: 1 test(s) in 1 file(s), none too slow"] });
  });

  test("#1022 Sonar: the report is read only from under the repository or a temp folder", () => {
    const roots = ["/r/flightdeck", "/tmp", "/runner/_temp"];
    expect(reportPath("/runner/_temp/junit.xml", roots)).toBe("/runner/_temp/junit.xml");
    expect(reportPath("/tmp/x/../junit.xml", roots)).toBe("/tmp/junit.xml");
    expect(reportPath("/r/flightdeck/coverage/junit.xml", roots)).toBe(
      "/r/flightdeck/coverage/junit.xml",
    );
    for (const outside of [
      "/etc/passwd",
      "/tmp/../etc/passwd",
      "/r/flightdeck-other/j.xml",
      "",
      undefined,
    ]) {
      expect(`${outside}: ${reportPath(outside, roots)}`).toBe(`${outside}: null`);
    }
  });

  test("#1022 review: a broken allowlist is named, not a stack trace", () => {
    expect(readAllowlist('{"tests": {}, "files": {}}')).toEqual({ tests: {}, files: {} });
    expect(readAllowlist("{ nope")).toBe("slow-tests: slow-tests-allowlist.json is not valid JSON");
    expect(readAllowlist('{"tests": []}')).toBe(
      "slow-tests: slow-tests-allowlist.json needs a tests and a files map",
    );
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

  test("#1022 review: a test or file whose time cannot be read fails, never reads as 0 s", () => {
    const broken = parseJunit(
      [
        '<testsuite name="apps/c.test.ts" file="apps/c.test.ts" time="">',
        '  <testcase name="no time" file="apps/c.test.ts" />',
        '  <testcase name="odd time" time="soon" file="apps/c.test.ts" />',
        "</testsuite>",
      ].join("\n"),
    );
    expect(slowVerdict(broken, { tests: {}, files: {} }).problems).toEqual([
      "apps/c.test.ts: the report gives no time for the file",
      "apps/c.test.ts > no time: the report gives no time",
      "apps/c.test.ts > odd time: the report gives no time",
    ]);
  });

  test("#1022 review: a missing report fails when the test step passed, and is left to that step when it failed", () => {
    expect(missingReport("success", "/t/j.xml")).toEqual({
      code: 1,
      line: "slow-tests: the test step passed but left no JUnit report at /t/j.xml",
    });
    for (const outcome of ["failure", "cancelled", undefined]) {
      expect(missingReport(outcome, "/t/j.xml")).toEqual({
        code: 0,
        line: "slow-tests: no JUnit report at /t/j.xml; the test step did not pass, and says why",
      });
    }
  });

  test("every allowlist entry names a test file and says why it is there", () => {
    const allow = JSON.parse(
      readFileSync(join(import.meta.dir, "../..", "slow-tests-allowlist.json"), "utf8"),
    ) as SlowAllowlist;
    // Empty is the goal (#1003): the file still has both maps, and every entry the rule's shape.
    expect([typeof allow.tests, typeof allow.files]).toEqual(["object", "object"]);
    const entries = [...Object.entries(allow.tests), ...Object.entries(allow.files)];
    for (const [id, why] of entries) {
      expect(`${id}: ${/^\S+\.test\.tsx?( > .+)?$/.test(id)} ${/#\d+/.test(why)}`).toBe(
        `${id}: true true`,
      );
    }
  });
});
