#!/usr/bin/env bun
/**
 * `bun run spec:lint <spec.md>...`: checks a phase spec against docs/templates/SPEC.md
 * (scripts/lib/spec-lint.ts). It checks the file it is given, linted or not; the suite checks
 * every spec from phase 40 on.
 */
import { readFileSync } from "node:fs";
import { lintSpec } from "./lib/spec-lint.ts";

const files = process.argv.slice(2).filter((a) => a !== "--");
if (files.length === 0) {
  console.error("usage: bun run spec:lint <docs/SPEC-fase-N.md>...");
  process.exit(2);
}
let bad = 0;
for (const file of files) {
  const problems = lintSpec(readFileSync(file, "utf8"));
  bad += problems.length;
  console.log(
    problems.length === 0 ? `${file}: SPEC OK` : problems.map((p) => `${file}: ${p}`).join("\n"),
  );
}
process.exit(bad > 0 ? 1 : 0);
