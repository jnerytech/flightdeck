#!/usr/bin/env bun
/**
 * `bun run scripts/e2e-summary.ts`: prints the e2e journeys of a CI run (#1854), read from the
 * shards' Playwright JSON reports that the aggregate job downloaded into $RUNNER_TEMP/e2e-json
 * (one folder per shard), and adds them to the job summary. It gates nothing.
 */
import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { e2eSummary } from "./lib/e2e-summary.ts";

const dir = join(process.env.RUNNER_TEMP ?? tmpdir(), "e2e-json");
const reports = existsSync(dir)
  ? readdirSync(dir)
      .map((shard) => join(dir, shard, "e2e.json"))
      .filter((file) => existsSync(file))
      .map((file) => readFileSync(file, "utf8"))
  : [];
const markdown = e2eSummary(reports);
if (markdown) {
  console.log(markdown);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
} else {
  console.log("e2e summary: no shard report");
}
