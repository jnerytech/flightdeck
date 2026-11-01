/**
 * `bun run bundle:budget` checks the built app (`bun run build:desktop` first) against the entry
 * chunk's budget and prints the chunks, largest first. It exits with 1 over the budget.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ENTRY_GZIP_LIMIT, overBudget } from "./lib/bundle-budget.ts";
import { bundleChunks, entryFile } from "./lib/perf-baseline.ts";

const DIST = resolve(import.meta.dir, "../apps/desktop/dist");
const chunks = bundleChunks(DIST);
const entry = entryFile(readFileSync(join(DIST, "index.html"), "utf8"));
for (const chunk of chunks) {
  const mark = chunk.file === entry ? " (entry)" : "";
  console.log(`${chunk.file}${mark}: ${chunk.bytes} bytes, ${chunk.gzip} gzip`);
}
const problems = overBudget(chunks, entry);
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  process.exit(1);
}
console.log(`bundle budget OK (entry gzip limit ${ENTRY_GZIP_LIMIT})`);
