/** `bun scripts/migrate-esperas.ts`: swaps each desktop test file's own `settle` for the shared one. */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { migrate } from "./lib/migrate-esperas.ts";

const DIR = resolve(import.meta.dir, "../apps/desktop/test");
let changed = 0;
for (const file of readdirSync(DIR).filter((f) => /\.(ts|tsx)$/.test(f) && f !== "wait.ts")) {
  const path = join(DIR, file);
  const out = migrate(readFileSync(path, "utf8"));
  if (out === null) continue;
  writeFileSync(path, out);
  changed++;
}
console.log(`${changed} files migrated`);
