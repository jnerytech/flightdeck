#!/usr/bin/env bun
/**
 * `bun run scripts/slow-tests.ts <junit.xml>`: fails when a test took over 5 s, or a test file over
 * 60 s, in the JUnit report of a test run, unless slow-tests-allowlist.json names it (#1003). CI
 * runs it after the PR's test run, which wrote the report; it runs no test itself.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseJunit, type SlowAllowlist, slowVerdict } from "./lib/slow-tests.ts";

const ROOT = resolve(import.meta.dir, "..");
const report = process.argv[2] ?? "";
let xml: string;
try {
  xml = readFileSync(report, "utf8");
} catch {
  // The test step failed before bun wrote it: that step is already red and says why.
  console.log(`slow-tests: no JUnit report at ${report}; nothing to check`);
  process.exit(0);
}
const allow = JSON.parse(
  readFileSync(resolve(ROOT, "slow-tests-allowlist.json"), "utf8"),
) as SlowAllowlist;
const times = parseJunit(xml);
const { problems, allowed } = slowVerdict(times, allow);
for (const line of allowed) console.log(`slow-tests: allowed ${line}`);
if (problems.length > 0) {
  console.error(`slow-tests: ${problems.length} too slow (#1003):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(
    "Make it faster, or delete it when a faster test checks the same thing (docs/TDD.md). A test fd-qa is still cutting goes in slow-tests-allowlist.json, with its issue.",
  );
  process.exit(1);
}
console.log(
  `slow-tests: ${times.tests.length} test(s) in ${times.files.length} file(s), none too slow`,
);
