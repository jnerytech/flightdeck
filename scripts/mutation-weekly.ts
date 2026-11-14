#!/usr/bin/env bun
// Weekly mutation run (#1607): runs Stryker per domain of mutation-domains.json, writes
// reports/mutation/summary.json and the job summary. The logic is in scripts/lib/mutation/.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { MutationDomain, MutationReport } from "./lib/mutation/report.ts";
import { summaryMarkdown } from "./lib/mutation/report.ts";
import { exitCodeOf, runWeekly } from "./lib/mutation/weekly.ts";

const SURVIVOR_LIMIT = 40;

const domains = JSON.parse(readFileSync("mutation-domains.json", "utf8")) as MutationDomain[];
const base = JSON.parse(readFileSync("stryker.config.json", "utf8")) as Record<string, unknown>;

const outcome = runWeekly({
  domains,
  base,
  writeConfig: (path, text) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  },
  runStryker: (configPath) =>
    Bun.spawnSync(["bunx", "stryker", "run", configPath], { stdout: "inherit", stderr: "inherit" })
      .exitCode,
  readReport: (domain) => {
    const path = `reports/mutation/${domain.name}/mutation.json`;
    return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as MutationReport) : null;
  },
});

mkdirSync("reports/mutation", { recursive: true });
writeFileSync("reports/mutation/summary.json", `${JSON.stringify(outcome, null, 2)}\n`);
let text = summaryMarkdown(outcome.results, SURVIVOR_LIMIT);
if (outcome.failed.length > 0) text += `\nFailed runs: ${outcome.failed.join(", ")}\n`;
for (const b of outcome.belowBaseline) {
  const scored = b.score === null ? "no mutant counted" : `${b.score}%`;
  text += `\nBelow baseline: ${b.domain} scored ${scored}, minimum ${b.minScore}%\n`;
}
console.log(text);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
process.exit(exitCodeOf(outcome));
