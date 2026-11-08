#!/usr/bin/env bun
/**
 * `bun run scripts/slow-tests.ts <junit.xml>`: fails when a test took over 5 s, or a test file over
 * 60 s, in the JUnit report of a test run, unless slow-tests-allowlist.json names it (#1003). CI
 * runs it after the PR's test run, which wrote the report; it runs no test itself.
 */
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  missingReport,
  parseJunit,
  readAllowlist,
  reportPath,
  slowReport,
} from "./lib/slow-tests.ts";

const ROOT = resolve(import.meta.dir, "..");
// Only a report under the repository or a temp folder is read (#1022 Sonar S8707).
const roots = [ROOT, tmpdir(), process.env.RUNNER_TEMP].filter((root): root is string => !!root);
const path = reportPath(process.argv[2], roots);
if (path === null) {
  console.error("slow-tests: give the JUnit report's path, under the repository or a temp folder");
  process.exit(2);
}
let xml: string;
try {
  xml = readFileSync(path, "utf8"); // NOSONAR: reportPath keeps it under the repository, tmpdir or RUNNER_TEMP; read only (security-reviewed, #1022)
} catch {
  // CI passes the test step's outcome: a passing step that wrote no report is a failure here.
  const missing = missingReport(process.env.TESTS_OUTCOME, path);
  (missing.code === 0 ? console.log : console.error)(missing.line);
  process.exit(missing.code);
}
const allow = readAllowlist(readFileSync(resolve(ROOT, "slow-tests-allowlist.json"), "utf8"));
if (typeof allow === "string") {
  console.error(allow);
  process.exit(1);
}
const report = slowReport(parseJunit(xml), allow);
for (const line of report.lines) (report.code === 0 ? console.log : console.error)(line);
process.exit(report.code);
