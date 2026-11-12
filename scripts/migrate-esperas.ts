/** `bun scripts/migrate-esperas.ts`: swaps each desktop test file's own `settle` for the shared one. */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isTarget, migrate, waitPathFor } from "./lib/tests/migrate-esperas.ts";

const DIR = resolve(import.meta.dir, "../apps/desktop/test");
let changed = 0;
for (const file of readdirSync(DIR, { recursive: true, encoding: "utf8" }).filter(isTarget)) {
  const rel = file.replaceAll("\\", "/");
  const path = join(DIR, rel);
  const out = migrate(readFileSync(path, "utf8"), waitPathFor(rel));
  if (out === null) continue;
  writeFileSync(path, out);
  changed++;
}
console.log(`${changed} files migrated`);
