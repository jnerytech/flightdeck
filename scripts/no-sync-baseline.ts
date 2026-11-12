/**
 * Rewrites `SYNC_BASELINE` in scripts/lib/ratchets/no-sync.ts from the sources as they are now:
 * `bun run no-sync:baseline`. Run it after a merge brings in or takes out blocking calls, and
 * read the diff: the baseline only ever goes down on purpose.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { syncCounts, withBaseline } from "./lib/ratchets/no-sync.ts";

const root = resolve(import.meta.dir, "..");
const file = join(root, "scripts/lib/ratchets/no-sync.ts");
const counts = syncCounts(root);
writeFileSync(file, withBaseline(readFileSync(file, "utf8"), counts));
console.log(`no-sync baseline: ${Object.keys(counts).length} files`);
