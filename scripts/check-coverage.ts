#!/usr/bin/env bun
/** Fails unless every source file is loaded by the tests and 100% covered (run after `bun test`). */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  checkCoverage,
  hasRuntimeCode,
  isCoverageSource,
  parseLcov,
} from "./lib/coverage-check.ts";

const ROOT = resolve(import.meta.dir, "..");

const sources = [
  ...new Bun.Glob("{packages,apps}/*/src/**/*.{ts,tsx}").scanSync({ cwd: ROOT }),
  ...new Bun.Glob("scripts/lib/**/*.ts").scanSync({ cwd: ROOT }),
]
  .map((path) => path.replaceAll("\\", "/"))
  .filter(isCoverageSource)
  .filter((path) =>
    hasRuntimeCode(readFileSync(resolve(ROOT, path), "utf8"), path.endsWith(".tsx") ? "tsx" : "ts"),
  );

const report = parseLcov(readFileSync(resolve(ROOT, "coverage/lcov.info"), "utf8"));
const problems = checkCoverage(report, sources);
if (problems.length > 0) {
  console.error(`cobertura abaixo de 100% em ${problems.length} arquivo(s):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`cobertura 100% em ${sources.length} arquivos-fonte`);
