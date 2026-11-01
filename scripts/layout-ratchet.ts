/**
 * `bun run layout:ratchet` lowers `apps/desktop/layout-baseline.json` to the screens' current
 * counts after a migration (it never raises one). `--init` writes the counts as they are.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { type LayoutBaseline, screenCounts, tightened } from "./lib/layout-ratchet.ts";

const DESKTOP = resolve(import.meta.dir, "../apps/desktop");
const FILE = resolve(DESKTOP, "layout-baseline.json");

const counts = screenCounts(resolve(DESKTOP, "src/ui"), DESKTOP);
const baseline: LayoutBaseline = existsSync(FILE)
  ? (JSON.parse(readFileSync(FILE, "utf8")) as LayoutBaseline)
  : {};
const next = process.argv.includes("--init") ? counts : tightened(counts, baseline);
const sorted = Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(FILE, `${JSON.stringify(sorted, null, 2)}\n`);
const total = Object.values(sorted).reduce((sum, n) => sum + n, 0);
console.log(`layout baseline: ${Object.keys(sorted).length} files, ${total} raw utilities`);
